import { promises as fs } from "fs";
import path from "path";
import { PDFDocument } from "pdf-lib";
import { scanJobFolder } from "../ingest/scanJobFolder";
import { iaReportTemplate } from "../report-templates/ia-report";
import { loadJobState } from "../state/jobState";
import { renderReportHtml } from "./renderReportHtml";
import { htmlToPdf } from "./htmlToPdf";

const ATTACH_AS_IS_ORDER = ["metallurgicalReport", "chemTest", "crackMap"];

/** Appends every page of `sourcePath` (a PDF) onto `doc`. Non-PDF attachments (an image crack
 * map, say) are skipped here — the review UI still shows them, but only PDF exhibits get
 * folded into the single output file for this prototype. */
async function appendPdf(doc: PDFDocument, sourcePath: string): Promise<boolean> {
  if (path.extname(sourcePath).toLowerCase() !== ".pdf") return false;
  const bytes = await fs.readFile(sourcePath);
  const srcDoc = await PDFDocument.load(bytes);
  const pages = await doc.copyPages(srcDoc, srcDoc.getPageIndices());
  pages.forEach((p) => doc.addPage(p));
  return true;
}

export async function generateReportPdf(jobRoot: string): Promise<{ buffer: Buffer; skippedAttachments: string[] }> {
  const scan = await scanJobFolder(jobRoot, iaReportTemplate);
  const state = await loadJobState(jobRoot);
  const html = await renderReportHtml(scan, state);
  const generatedPdfBytes = await htmlToPdf(html);

  const finalDoc = await PDFDocument.load(generatedPdfBytes);
  const skippedAttachments: string[] = [];

  const sectionsById = new Map(scan.sections.map((s) => [s.id, s]));
  for (const id of ATTACH_AS_IS_ORDER) {
    const section = sectionsById.get(id);
    const file = section?.matchedFiles[0];
    if (!file) continue;
    const appended = await appendPdf(finalDoc, file.absolutePath);
    if (!appended) skippedAttachments.push(file.relativePath);
  }

  const finalBytes = await finalDoc.save();
  return { buffer: Buffer.from(finalBytes), skippedAttachments };
}
