import { promises as fs } from "fs";
import path from "path";
import type { JobScanResult, SectionScanResult } from "../ingest/scanJobFolder";
import { COVER_FIELD_ORDER } from "../ingest/jobMetadata";
import type { JobState, SectionState } from "../state/jobState";
import type { ParsedTable } from "../ingest/parsers/types";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderTable(table: ParsedTable): string {
  const headerRow = `<tr>${table.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr>`;
  const bodyRows = table.rows
    .map((row) => `<tr>${table.columns.map((c) => `<td class="${row[c]?.includes("OUT OF SPEC") ? "fail" : ""}">${escapeHtml(row[c] ?? "")}</td>`).join("")}</tr>`)
    .join("");
  const summaryRows = (table.summaryRows ?? [])
    .map((row) => `<tr class="summary">${table.columns.map((c) => `<td>${escapeHtml(row[c] ?? "")}</td>`).join("")}</tr>`)
    .join("");
  const notes = table.notes.length ? `<p class="table-notes">${table.notes.map(escapeHtml).join("<br/>")}</p>` : "";
  return `<table>${headerRow}${bodyRows}${summaryRows}</table>${notes}`;
}

function renderNarrative(text: string | undefined): string {
  if (!text) return `<p class="missing">No draft generated yet for this section.</p>`;
  return text
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, "<br/>")}</p>`)
    .join("");
}

async function imageToDataUri(absolutePath: string): Promise<string> {
  const buffer = await fs.readFile(absolutePath);
  const ext = path.extname(absolutePath).toLowerCase();
  const mime = ext === ".png" ? "image/png" : "image/jpeg";
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

async function renderPhotoSet(section: SectionScanResult, jobRoot: string, sectionState: SectionState | undefined): Promise<string> {
  const selectedPaths = sectionState?.selectedPhotoPaths;
  const paths = selectedPaths && selectedPaths.length > 0 ? selectedPaths : section.matchedFiles.slice(0, 6).map((f) => f.relativePath);
  if (paths.length === 0) return `<p class="missing">No photos selected.</p>`;
  const images = await Promise.all(
    paths.map(async (relativePath) => {
      try {
        const dataUri = await imageToDataUri(path.join(jobRoot, relativePath));
        return `<figure><img src="${dataUri}" /><figcaption>${escapeHtml(relativePath)}</figcaption></figure>`;
      } catch {
        return "";
      }
    })
  );
  return `<div class="photo-grid">${images.join("")}</div>`;
}

export async function renderReportHtml(scan: JobScanResult, state: JobState): Promise<string> {
  const sectionsById = new Map(scan.sections.map((s) => [s.id, s]));
  const contentFor = (id: string) => state.sections[id]?.content;

  const bodyParts: string[] = [];

  const coverOverrides = state.sections["cover"]?.fields ?? {};
  const coverRows = COVER_FIELD_ORDER.map(({ key, label }) => {
    const raw = (coverOverrides[key as string] ?? (scan.metadata[key] as string) ?? "").toString();
    const value = key === "date" ? raw.split("T")[0] : raw;
    return `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`;
  }).join("");

  bodyParts.push(`
    <section class="cover">
      <h1>${escapeHtml(scan.reportType)}</h1>
      <table class="cover-table">${coverRows}</table>
    </section>`);

  const narrativeSectionIds = ["iaSummary", "fpiVisual", "dimensionalSummary", "recommendedRepairs"];
  for (const id of narrativeSectionIds) {
    const section = sectionsById.get(id);
    if (!section) continue;
    bodyParts.push(`<section><h2>${escapeHtml(section.title)}</h2>${renderNarrative(contentFor(id))}</section>`);
  }

  const tableSectionIds = ["serialNumberList", "heightDimForm", "dovetailDimension", "wallThickness"];
  for (const id of tableSectionIds) {
    const section = sectionsById.get(id);
    if (!section) continue;
    const body = section.parsedTable ? renderTable(section.parsedTable) : `<p class="missing">No data available.</p>`;
    bodyParts.push(`<section class="table-section"><h2>${escapeHtml(section.title)}</h2>${body}</section>`);
  }

  const photoSection = sectionsById.get("photoSet");
  if (photoSection) {
    const photoHtml = await renderPhotoSet(photoSection, scan.jobRoot, state.sections["photoSet"]);
    bodyParts.push(`<section><h2>${escapeHtml(photoSection.title)}</h2>${photoHtml}</section>`);
  }

  const crackMapSection = sectionsById.get("crackMap");
  if (crackMapSection && crackMapSection.status === "missing") {
    bodyParts.push(`<section><h2>${escapeHtml(crackMapSection.title)}</h2><p class="missing">No crack map was found for this job.</p></section>`);
  }

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #1a1a1a; }
  h1 { font-size: 22px; }
  h2 { font-size: 15px; border-bottom: 2px solid #0b3d91; padding-bottom: 4px; margin-top: 28px; }
  section { page-break-inside: avoid; margin-bottom: 16px; }
  section.table-section { page-break-inside: auto; }
  .cover { text-align: center; margin-top: 120px; }
  .cover-table { margin: 24px auto; border-collapse: collapse; }
  .cover-table th, .cover-table td { border: 1px solid #ccc; padding: 6px 12px; text-align: left; }
  table { border-collapse: collapse; width: 100%; margin-top: 8px; }
  th, td { border: 1px solid #ccc; padding: 3px 6px; font-size: 9px; }
  th { background: #0b3d91; color: white; }
  tr.summary td { font-weight: bold; background: #f0f0f0; }
  td.fail { color: #b00020; font-weight: bold; }
  .missing { color: #b00020; font-style: italic; }
  .table-notes { font-size: 9px; color: #555; margin-top: 4px; }
  .photo-grid { display: flex; flex-wrap: wrap; gap: 8px; }
  .photo-grid figure { width: 30%; margin: 0; }
  .photo-grid img { width: 100%; height: auto; border: 1px solid #ccc; }
  .photo-grid figcaption { font-size: 8px; color: #555; word-break: break-all; }
</style>
</head>
<body>
${bodyParts.join("\n")}
</body>
</html>`;
}
