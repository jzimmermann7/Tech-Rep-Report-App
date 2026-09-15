import { promises as fs } from "fs";
import path from "path";
import { PDFDocument } from "pdf-lib";
import { scanJobFolder } from "../ingest/scanJobFolder";
import { resolveReportTemplate } from "../report-templates";
import { loadJobState } from "../state/jobState";
import { renderReportSegments } from "./renderReportHtml";
import { htmlToPdf } from "./htmlToPdf";

const ATTACH_AS_IS_ORDER = ["metallurgicalReport", "chemTest", "crackMap"];

const READ_RETRY_ATTEMPTS = 3;
const READ_RETRY_DELAY_MS = 500;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Reads a file with a couple of short retries before giving up. Every source file this generates
 * from lives on the tech reps' mapped T:\ network share, which periodically drops or stales out an
 * idle connection -- Node then surfaces that as a bare `UNKNOWN: unknown error, read` with no
 * indication of which file it was even trying to read (seen firsthand generating Job 18664's Final
 * Report). A stale connection like that typically clears itself within a second, so a short retry
 * turns most of these into a non-event instead of failing the whole report; if it's still failing
 * after retrying, the rethrown error at least names the file so it's actually actionable. */
async function readFileWithRetry(sourcePath: string): Promise<Buffer> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= READ_RETRY_ATTEMPTS; attempt++) {
    try {
      return await fs.readFile(sourcePath);
    } catch (err) {
      lastErr = err;
      if (attempt < READ_RETRY_ATTEMPTS) await delay(READ_RETRY_DELAY_MS * attempt);
    }
  }
  const reason = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new Error(`Couldn't read "${sourcePath}" after ${READ_RETRY_ATTEMPTS} attempts (${reason}). This is usually a dropped connection to a network drive -- browse to the file in File Explorer to reconnect it, then try generating the report again.`);
}

/** Copies every page of a source PDF onto `doc`, in order. Used both for the real completed
 * forms (Height Dim Form, Dovetail, Wall Thickness) interleaved at their natural position via
 * renderReportSegments' "pdf" segments, and for the true after-the-fact exhibits (chem test,
 * crack map, met report) appended at the very end. */
async function appendPdfPages(doc: PDFDocument, sourcePath: string): Promise<void> {
  const bytes = await readFileWithRetry(sourcePath);
  // pdf-lib's load() rejects a Node Buffer outright ("provide binary data as Uint8Array, rather
  // than Buffer") despite Buffer being a Uint8Array subclass -- normalize explicitly.
  const srcDoc = await PDFDocument.load(new Uint8Array(bytes));
  const pages = await doc.copyPages(srcDoc, srcDoc.getPageIndices());
  pages.forEach((p) => doc.addPage(p));
}

export async function generateReportPdf(jobRoot: string, reportType?: string): Promise<{ buffer: Buffer; skippedAttachments: string[] }> {
  const scan = await scanJobFolder(jobRoot, resolveReportTemplate(reportType));
  const state = await loadJobState(jobRoot);
  const segments = await renderReportSegments(scan, state);

  // Build the main body of the report by rendering each HTML segment to its own small PDF (via
  // puppeteer) and copying in each "pdf" segment's real pages verbatim, in order -- so a
  // completed source form's pages land exactly where our own table would have gone, by
  // construction, with no need to locate anything in an already-rendered PDF afterward.
  const finalDoc = await PDFDocument.create();
  for (const segment of segments) {
    if (segment.kind === "html") {
      const pageBytes = await htmlToPdf(segment.html);
      const pageDoc = await PDFDocument.load(new Uint8Array(pageBytes));
      const pages = await finalDoc.copyPages(pageDoc, pageDoc.getPageIndices());
      pages.forEach((p) => finalDoc.addPage(p));
    } else {
      await appendPdfPages(finalDoc, segment.path);
    }
  }

  const skippedAttachments: string[] = [];
  const sectionsById = new Map(scan.sections.map((s) => [s.id, s]));
  for (const id of ATTACH_AS_IS_ORDER) {
    const section = sectionsById.get(id);
    if (!section) continue;
    // Multiple files can match a section's naming pattern; the review screen lets the tech rep
    // pick which one is actually the real exhibit (persisted as selectedAttachmentPath). Honor
    // that pick when present, falling back to the auto-selected first match otherwise.
    const selectedPath = state.sections[id]?.selectedAttachmentPath;
    const file = (selectedPath && section.matchedFiles.find((f) => f.relativePath === selectedPath)) || section.matchedFiles[0];
    if (!file) continue;
    if (path.extname(file.absolutePath).toLowerCase() !== ".pdf") {
      skippedAttachments.push(file.relativePath);
      continue;
    }
    await appendPdfPages(finalDoc, file.absolutePath);
  }

  const finalBytes = await finalDoc.save();
  return { buffer: Buffer.from(finalBytes), skippedAttachments };
}
