import path from "path";
import type { AutomationConfidence, GenerationStrategy, ReportTemplate, SectionConfig } from "../report-templates/types";
import { walkJobFolder, type JobFile } from "./fileWalk";
import { findCandidates } from "./matchSource";
import { resolveJobMetadata, type JobMetadata } from "./jobMetadata";
import { parseSerialNumberList } from "./parsers/serialNumberList";
import { parseHeightDimForm, HEIGHT_DIM_FORM_SHEET_PATTERN } from "./parsers/heightDimForm";
import { parseDovetailDimension, DOVETAIL_SHEET_PATTERN } from "./parsers/dovetailDimension";
import { parseWallThickness, WALL_THICKNESS_SHEET_PATTERN } from "./parsers/wallThickness";
import { parseRouter, type ParsedRouter } from "./parsers/router";
import { extractEmbeddedPhotos } from "./parsers/photoTemplatePdf";
import { xlsxHasEmbeddedImages, renderXlsxSheetToPdf } from "./parsers/xlsxToPdf";
import type { ParsedTable } from "./parsers/types";

export type SectionStatus = "ready" | "needs-attention" | "missing";

export interface SectionScanResult {
  id: string;
  title: string;
  generation: GenerationStrategy;
  automationConfidence: AutomationConfidence;
  alwaysReview?: boolean;
  confidenceNote?: string;
  dependsOnSections?: string[];
  status: SectionStatus;
  statusReason: string;
  matchedFiles: JobFile[];
  parsedTable?: ParsedTable;
  parsedRouter?: ParsedRouter;
  /** A print-ready PDF of the same completed form (see PRINT_PDF_SECTIONS) -- when one exists,
   * the report embeds this verbatim instead of our own re-rendered table, since the original
   * carries formatting, diagrams, and small details a re-parsed data table can't reproduce. */
  printPdfFile?: JobFile;
}

export interface JobScanResult {
  jobRoot: string;
  reportType: string;
  metadata: JobMetadata;
  fileCount: number;
  sections: SectionScanResult[];
}

const TABLE_PARSERS: Record<string, (path: string) => Promise<ParsedTable | null>> = {
  serialNumberList: parseSerialNumberList,
  heightDimForm: parseHeightDimForm,
  dovetailDimension: parseDovetailDimension,
  wallThickness: parseWallThickness,
};

const ROUTER_SECTIONS = new Set(["fpiVisual", "recommendedRepairs"]);
const ATTACH_AS_IS_NO_PARSE = new Set(["chemTest", "crackMap", "metallurgicalReport"]);

/** These forms exist on disk twice: an .xlsx we parse for data (dimensional pass/fail, the
 * sample size other narrative sections reference) and a completed, print-ready PDF of the exact
 * same form -- diagrams, colored callouts, and all. Serial Number List is deliberately excluded:
 * that one's report presentation is this app's own header/notes-box layout, not a PDF swap. */
const PRINT_PDF_SECTIONS = new Set(["heightDimForm", "dovetailDimension", "wallThickness"]);

/** Which worksheet to render for each of PRINT_PDF_SECTIONS, when falling back to rendering the
 * data spreadsheet itself via Excel (see renderXlsxSheetToPdf) because no standalone PDF exists.
 * Matches each parser's own sheet-selection pattern so it's the same sheet either way. */
const PRINT_PDF_SHEET_PATTERNS: Record<string, RegExp> = {
  heightDimForm: HEIGHT_DIM_FORM_SHEET_PATTERN,
  dovetailDimension: DOVETAIL_SHEET_PATTERN,
  wallThickness: WALL_THICKNESS_SHEET_PATTERN,
};

// Shared with the /api/manual-attachment route, which is the only writer of this convention: a
// file the tech rep manually attached (because the automatic file-matching found nothing, or
// found the wrong thing) lives at "<jobRoot>/_Manual Attachments/<sectionId>/<filename>" -- a
// real file inside the job folder like any other, picked up by the normal walk below and
// associated with its section by folder path rather than by filename pattern. No separate
// storage or job-state field needed; a rescan is all it takes to pick one up.
const MANUAL_ATTACHMENTS_DIR = "_Manual Attachments";

function manualAttachmentsFor(sectionId: string, files: JobFile[]): JobFile[] {
  const prefix = `${MANUAL_ATTACHMENTS_DIR}/${sectionId}`;
  return files.filter((f) => f.folderPath === prefix);
}

/** Re-runs a section's own filename-pattern sourceRules but requiring a .pdf instead of its
 * usual spreadsheet extension, to find the completed print-ready form alongside the data
 * spreadsheet the app actually parses (see PRINT_PDF_SECTIONS). */
function findPrintPdf(section: SectionConfig, files: JobFile[]): JobFile | undefined {
  const pdfRules = section.sourceRules
    .filter((r): r is Extract<typeof r, { kind: "filenamePattern" }> => r.kind === "filenamePattern")
    .map((r) => ({ ...r, requiredExtensions: [".pdf"] }));
  const matches = findCandidates(pdfRules, files);
  return matches[0]?.candidates[0];
}

/** Some jobs never had a standalone print-ready PDF made at all -- the completed form (with its
 * measurement diagrams, callouts, etc.) exists only as pictures embedded directly in the data
 * spreadsheet itself. ExcelJS can read that sheet's cell values but has no rendering capability,
 * so when that's the only source available, this renders the sheet to a cached PDF via a real
 * Excel install instead of silently dropping those pictures and showing our own bare data table. */
async function renderEmbeddedXlsxAsPrintPdf(section: SectionConfig, xlsxPath: string, jobRoot: string): Promise<JobFile | undefined> {
  const sheetPattern = PRINT_PDF_SHEET_PATTERNS[section.id];
  if (!sheetPattern) return undefined;
  if (!(await xlsxHasEmbeddedImages(xlsxPath))) return undefined;
  const cacheDir = path.join(path.dirname(xlsxPath), "_Rendered PDFs");
  const rendered = await renderXlsxSheetToPdf(xlsxPath, sheetPattern, cacheDir);
  return rendered ? jobFileFromAbsolutePath(rendered, jobRoot) : undefined;
}

/** Builds a JobFile for a file that isn't a real member of the job folder walk — e.g. a photo
 * extracted from a template PDF into a cache folder alongside it. Mirrors fileWalk.ts's own
 * field conventions (forward-slash relative path, etc.) so it behaves like any other JobFile to
 * the rest of the pipeline (the photo-file API route, the PDF renderer, photo selection). */
function jobFileFromAbsolutePath(absolutePath: string, jobRoot: string): JobFile {
  const relativePath = path.relative(jobRoot, absolutePath).split(path.sep).join("/");
  const folderPath = path.dirname(relativePath) === "." ? "" : path.dirname(relativePath).split(path.sep).join("/");
  return { absolutePath, relativePath, baseName: path.basename(absolutePath), ext: path.extname(absolutePath).toLowerCase(), folderPath };
}

async function scanFileBackedSection(section: SectionConfig, files: JobFile[], jobRoot: string): Promise<SectionScanResult> {
  const base = {
    id: section.id,
    title: section.title,
    generation: section.generation,
    automationConfidence: section.automationConfidence,
    alwaysReview: section.alwaysReview,
    confidenceNote: section.confidenceNote,
  };

  if (section.generation === "llm-vision-select") {
    const folderRules = section.sourceRules.filter((r) => r.kind === "folderPattern");
    const folderMatches = findCandidates(folderRules, files);
    let photoFiles = folderMatches.flatMap((m) => m.candidates);
    let extractedFromTemplate = false;

    if (photoFiles.length === 0) {
      // No raw photo folder — fall back to a "photo template" PDF some tech reps paste incoming
      // photos into directly, instead of keeping loose image files.
      const templateRules = section.sourceRules.filter((r) => r.kind === "filenamePattern");
      const templateMatches = findCandidates(templateRules, files);
      const templateFile = templateMatches[0]?.candidates[0];
      if (templateFile) {
        const outDir = path.join(path.dirname(templateFile.absolutePath), "_Extracted Photos", path.basename(templateFile.baseName, templateFile.ext));
        try {
          const extractedPaths = await extractEmbeddedPhotos(templateFile.absolutePath, outDir);
          photoFiles = extractedPaths.map((p) => jobFileFromAbsolutePath(p, jobRoot));
          extractedFromTemplate = photoFiles.length > 0;
        } catch {
          // Malformed/encrypted PDF, etc. — fall through to "missing" below.
        }
      }
    }

    if (photoFiles.length === 0) {
      return { ...base, status: "missing", statusReason: "No photo folder or photo-template PDF found for this job.", matchedFiles: [] };
    }
    return {
      ...base,
      status: "ready",
      statusReason: `${photoFiles.length} candidate photo(s) found${extractedFromTemplate ? " (extracted from the photo-template PDF)" : ""}; selection always needs human confirmation.`,
      matchedFiles: photoFiles,
    };
  }

  // A file the tech rep manually attached because the automatic match found nothing (or found
  // the wrong thing) -- see manualAttachmentsFor's own comment. Treated as the highest-priority
  // candidate below, ahead of anything the filename/folder pattern rules turned up on their own,
  // since a human explicitly chose it.
  const manualFiles = manualAttachmentsFor(section.id, files);
  const manualPdf = manualFiles.find((f) => f.ext === ".pdf");

  // Computed once, up front, regardless of whether the section's usual data spreadsheet is even
  // present -- a job can have the completed print-ready PDF (see PRINT_PDF_SECTIONS) without a
  // matching .xlsx at all (e.g. Wall Thickness data that only ever existed as a PDF for a given
  // job), and that PDF is still strictly better than showing "missing" or a table we made up.
  const printPdfFile = PRINT_PDF_SECTIONS.has(section.id) ? (findPrintPdf(section, files) ?? manualPdf) : undefined;

  const ruleMatches = findCandidates(section.sourceRules, files);
  if (manualFiles.length > 0) {
    // A manually-attached file can coincidentally also satisfy the section's own filename/folder
    // pattern (e.g. a tech rep sensibly naming it "... Met Report.pdf" for metallurgicalReport,
    // whose own pattern is exactly /met.*report/i) -- dedupe by relativePath so it doesn't show
    // up twice, once from each source, as the identical candidate.
    const manualPaths = new Set(manualFiles.map((f) => f.relativePath));
    if (ruleMatches.length > 0) {
      ruleMatches[0] = { ...ruleMatches[0], candidates: [...manualFiles, ...ruleMatches[0].candidates.filter((f) => !manualPaths.has(f.relativePath))] };
    } else {
      ruleMatches.push({ rule: section.sourceRules[0], candidates: manualFiles });
    }
  }
  if (ruleMatches.length === 0) {
    if (printPdfFile) {
      return {
        ...base,
        status: "ready",
        statusReason: `No data spreadsheet was found, but the completed form "${printPdfFile.relativePath}" was and will be embedded in the report as-is.`,
        matchedFiles: [printPdfFile],
        printPdfFile,
      };
    }
    return { ...base, status: "missing", statusReason: "No matching source file found in the job folder.", matchedFiles: [] };
  }

  if (ROUTER_SECTIONS.has(section.id)) {
    for (const match of ruleMatches) {
      for (const candidate of match.candidates) {
        try {
          const parsed = await parseRouter(candidate.absolutePath);
          if (parsed && parsed.operations.length > 0) {
            const activeCount = parsed.operations.filter((o) => o.active).length;
            return {
              ...base,
              status: "ready",
              statusReason: `${activeCount} of ${parsed.operations.length} router operations are in scope for this job.`,
              matchedFiles: [candidate],
              parsedRouter: parsed,
            };
          }
        } catch {
          // try the next candidate
        }
      }
    }
    return {
      ...base,
      status: "needs-attention",
      statusReason: "Found a router file but could not read any operations from its Master sheet.",
      matchedFiles: ruleMatches[0].candidates.slice(0, 1),
    };
  }

  if (ATTACH_AS_IS_NO_PARSE.has(section.id)) {
    const candidates = ruleMatches[0].candidates;
    const candidate = candidates[0];
    const ambiguous = candidates.length > 1;
    return {
      ...base,
      status: ambiguous ? "needs-attention" : "ready",
      statusReason: ambiguous
        ? `${candidates.length} candidate files matched; using "${candidate.relativePath}" by default — pick the right one below.`
        : `Matched "${candidate.relativePath}".`,
      // All of them, not just the auto-pick -- the review screen lets the tech rep choose among
      // these directly (see AttachAsIs / selectedAttachmentPath) instead of only ever seeing
      // whichever one this heuristic happened to land on.
      matchedFiles: candidates,
    };
  }

  const parser = TABLE_PARSERS[section.id];
  if (parser) {
    for (const match of ruleMatches) {
      for (const candidate of match.candidates) {
        try {
          const parsed = await parser(candidate.absolutePath);
          if (parsed && parsed.rows.length > 0) {
            // No standalone print-ready PDF on disk -- if this same spreadsheet has its own
            // embedded pictures (measurement diagrams, callouts), render that sheet to a PDF via
            // Excel rather than dropping those pictures and showing just our own data table.
            const resolvedPrintPdf = printPdfFile ?? (await renderEmbeddedXlsxAsPrintPdf(section, candidate.absolutePath, jobRoot));
            return {
              ...base,
              status: "ready",
              statusReason: resolvedPrintPdf
                ? `Parsed ${parsed.rows.length} row(s) from "${candidate.relativePath}"; the completed form "${resolvedPrintPdf.relativePath}" will be embedded in the report as-is.`
                : `Parsed ${parsed.rows.length} row(s) from "${candidate.relativePath}".`,
              matchedFiles: [candidate],
              parsedTable: parsed,
              printPdfFile: resolvedPrintPdf,
            };
          }
        } catch {
          // try the next candidate — e.g. a same-named blank template
        }
      }
    }
    // The spreadsheet exists but every candidate was blank/unreadable -- if the completed PDF is
    // still there, use that rather than reporting "needs attention" over a form the report was
    // never going to need data out of anyway.
    if (printPdfFile) {
      return {
        ...base,
        status: "ready",
        statusReason: `The data spreadsheet appears blank or unreadable, but the completed form "${printPdfFile.relativePath}" was found and will be embedded in the report as-is.`,
        matchedFiles: [printPdfFile],
        printPdfFile,
      };
    }
    return {
      ...base,
      status: "needs-attention",
      statusReason: "Found a matching file, but it appears to be blank or in an unexpected format.",
      matchedFiles: ruleMatches[0].candidates.slice(0, 1),
    };
  }

  // Fallback for any section without a bespoke parser or special-case above.
  const candidate = ruleMatches[0].candidates[0];
  return { ...base, status: "ready", statusReason: `Matched "${candidate.relativePath}".`, matchedFiles: [candidate] };
}

function scanDependentSection(section: SectionConfig, resolved: Map<string, SectionScanResult>): SectionScanResult {
  const base = {
    id: section.id,
    title: section.title,
    generation: section.generation,
    automationConfidence: section.automationConfidence,
    alwaysReview: section.alwaysReview,
    confidenceNote: section.confidenceNote,
    dependsOnSections: section.dependsOnSections,
    matchedFiles: [] as JobFile[],
  };
  const deps = (section.dependsOnSections ?? []).map((id) => resolved.get(id)).filter(Boolean) as SectionScanResult[];
  if (deps.length === 0) {
    return { ...base, status: "missing", statusReason: "No dependent sections were resolved." };
  }
  if (deps.every((d) => d.status === "ready")) {
    return { ...base, status: "ready", statusReason: "All source sections are ready to synthesize from." };
  }
  if (deps.some((d) => d.status !== "missing")) {
    return {
      ...base,
      status: "needs-attention",
      statusReason: `Can draft a partial summary, but ${deps.filter((d) => d.status !== "ready").map((d) => d.title).join(", ")} need attention first.`,
    };
  }
  return { ...base, status: "missing", statusReason: "None of the source sections this depends on are available." };
}

export async function scanJobFolder(jobRoot: string, template: ReportTemplate): Promise<JobScanResult> {
  const files = await walkJobFolder(jobRoot);
  const metadata = await resolveJobMetadata(jobRoot, files);

  const resolved = new Map<string, SectionScanResult>();

  // Pass 1: sections backed directly by files (or job metadata).
  for (const section of template.sections) {
    if (section.generation === "template") {
      resolved.set(section.id, {
        id: section.id,
        title: section.title,
        generation: section.generation,
        automationConfidence: section.automationConfidence,
        status: "ready",
        statusReason: `From ${metadata.source}.`,
        matchedFiles: [],
      });
      continue;
    }
    if (section.dependsOnSections) continue; // pass 2
    resolved.set(section.id, await scanFileBackedSection(section, files, jobRoot));
  }

  // Pass 2: sections synthesized from other sections' results.
  for (const section of template.sections) {
    if (!section.dependsOnSections) continue;
    resolved.set(section.id, scanDependentSection(section, resolved));
  }

  // Preserve the template's declared section order in the result.
  const sections = template.sections.map((s) => resolved.get(s.id)!);

  return { jobRoot, reportType: template.reportType, metadata, fileCount: files.length, sections };
}
