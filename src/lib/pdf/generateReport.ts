import { promises as fs } from "fs";
import path from "path";
import { PDFDocument } from "pdf-lib";
import { scanJobFolder } from "../ingest/scanJobFolder";
import { iaReportTemplate } from "../report-templates/ia-report";
import { loadJobState } from "../state/jobState";
import { renderReportSegments } from "./renderReportHtml";
import { htmlToPdf } from "./htmlToPdf";

const ATTACH_AS_IS_ORDER = ["metallurgicalReport", "chemTest", "crackMap"];

/** Copies every page of a source PDF onto `doc`, in order. Used both for the real completed
 * forms (Height Dim Form, Dovetail, Wall Thickness) interleaved at their natural position via
 * renderReportSegments' "pdf" segments, and for the true after-the-fact exhibits (chem test,
 * crack map, met report) appended at the very end. */
async function appendPdfPages(doc: PDFDocument, sourcePath: string): Promise<void> {
  const bytes = await fs.readFile(sourcePath);
  // pdf-lib's load() rejects a Node Buffer outright ("provide binary data as Uint8Array, rather
  // than Buffer") despite Buffer being a Uint8Array subclass -- normalize explicitly.
  const srcDoc = await PDFDocument.load(new Uint8Array(bytes));
  const pages = await doc.copyPages(srcDoc, srcDoc.getPageIndices());
  pages.forEach((p) => doc.addPage(p));
}

export async function generateReportPdf(jobRoot: string): Promise<{ buffer: Buffer; skippedAttachments: string[] }> {
  const scan = await scanJobFolder(jobRoot, iaReportTemplate);
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
    const file = section?.matchedFiles[0];
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
