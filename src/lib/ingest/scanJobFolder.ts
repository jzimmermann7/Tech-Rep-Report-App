import type { AutomationConfidence, GenerationStrategy, ReportTemplate, SectionConfig } from "../report-templates/types";
import { walkJobFolder, type JobFile } from "./fileWalk";
import { findCandidates } from "./matchSource";
import { resolveJobMetadata, type JobMetadata } from "./jobMetadata";
import { parseSerialNumberList } from "./parsers/serialNumberList";
import { parseHeightDimForm } from "./parsers/heightDimForm";
import { parseDovetailDimension } from "./parsers/dovetailDimension";
import { parseWallThickness } from "./parsers/wallThickness";
import { parseRouter, type ParsedRouter } from "./parsers/router";
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

async function scanFileBackedSection(section: SectionConfig, files: JobFile[]): Promise<SectionScanResult> {
  const base = {
    id: section.id,
    title: section.title,
    generation: section.generation,
    automationConfidence: section.automationConfidence,
    alwaysReview: section.alwaysReview,
    confidenceNote: section.confidenceNote,
  };

  if (section.generation === "llm-vision-select") {
    const matches = findCandidates(section.sourceRules, files);
    const photoFiles = matches.flatMap((m) => m.candidates);
    if (photoFiles.length === 0) {
      return { ...base, status: "missing", statusReason: "No photo folder found for this job.", matchedFiles: [] };
    }
    return {
      ...base,
      status: "ready",
      statusReason: `${photoFiles.length} candidate photo(s) found; selection always needs human confirmation.`,
      matchedFiles: photoFiles,
    };
  }

  const ruleMatches = findCandidates(section.sourceRules, files);
  if (ruleMatches.length === 0) {
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
    const candidate = ruleMatches[0].candidates[0];
    const ambiguous = ruleMatches[0].candidates.length > 1;
    return {
      ...base,
      status: ambiguous ? "needs-attention" : "ready",
      statusReason: ambiguous
        ? `${ruleMatches[0].candidates.length} candidate files matched; using "${candidate.relativePath}" — confirm this is the right one.`
        : `Matched "${candidate.relativePath}".`,
      matchedFiles: [candidate],
    };
  }

  const parser = TABLE_PARSERS[section.id];
  if (parser) {
    for (const match of ruleMatches) {
      for (const candidate of match.candidates) {
        try {
          const parsed = await parser(candidate.absolutePath);
          if (parsed && parsed.rows.length > 0) {
            return {
              ...base,
              status: "ready",
              statusReason: `Parsed ${parsed.rows.length} row(s) from "${candidate.relativePath}".`,
              matchedFiles: [candidate],
              parsedTable: parsed,
            };
          }
        } catch {
          // try the next candidate — e.g. a same-named blank template
        }
      }
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
    resolved.set(section.id, await scanFileBackedSection(section, files));
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
