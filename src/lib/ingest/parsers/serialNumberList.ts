import path from "path";
import { loadWorkbook, cellText } from "../excel";
import type { ParsedTable } from "./types";

/**
 * DS-0554 "Serial Number List". Layout (confirmed against Job 20443):
 * sheet name contains "serial number sheet"; header row 7; three parallel
 * column-blocks of [APG#, Serial#, Comment] starting at columns A, E, I,
 * each covering a third of the population. Data starts row 8.
 */
/** DS-0554's own header block (confirmed against Job 20443): row 3 = Customer:/Date:/Page:,
 * row 4 = APG Job #:/Insp:/Cast P/N:, row 5 = Unit/Frame:/Row/Stg:/Mach P/N:, each label in
 * column B or F or H with its value one or two columns to the right. */
function parseFormHeader(sheet: import("exceljs").Worksheet): Array<{ label: string; value: string }> {
  const cellPairs: Array<[number, number, number]> = [
    [3, 2, 3], // Customer: (B3 -> C3)
    [3, 6, 7], // Date: (F3 -> G3)
    [3, 8, 10], // Page: (H3 -> J3)
    [4, 2, 3], // APG Job #: (B4 -> C4)
    [4, 6, 7], // Insp: (F4 -> G4)
    [4, 8, 10], // Cast P/N: (H4 -> J4)
    [5, 2, 3], // Unit/Frame: (B5 -> C5)
    [5, 6, 7], // Row/Stg: (F5 -> G5)
    [5, 8, 10], // Mach P/N: (H5 -> J5)
  ];
  const header: Array<{ label: string; value: string }> = [];
  for (const [row, labelCol, valueCol] of cellPairs) {
    const label = cellText(sheet.getRow(row).getCell(labelCol)).trim();
    let value = cellText(sheet.getRow(row).getCell(valueCol)).trim();
    if (label.toLowerCase().startsWith("date") && value) {
      // The Date cell reads as a full JS Date string when the source cell is date-typed
      // rather than plain text -- reduce it to the same short date format the form prints.
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) value = parsed.toLocaleDateString("en-US");
    }
    if (label) header.push({ label, value });
  }
  return header;
}

export async function parseSerialNumberList(absolutePath: string): Promise<ParsedTable | null> {
  const workbook = await loadWorkbook(absolutePath);
  const sheet = workbook.worksheets.find((s) => /serial number sheet/i.test(s.name));
  if (!sheet) return null;

  const formHeader = parseFormHeader(sheet);
  const blockStartCols = [1, 5, 9]; // A, E, I
  const rows: Array<Record<string, string>> = [];

  for (const startCol of blockStartCols) {
    for (let r = 8; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const apgNum = cellText(row.getCell(startCol));
      if (!/^\d+$/.test(apgNum)) continue; // skips gaps and trailing footer/notes text
      const serial = cellText(row.getCell(startCol + 1));
      const comment = cellText(row.getCell(startCol + 2));
      rows.push({ "APG #": apgNum, "Serial #": serial, Comment: comment });
    }
  }

  rows.sort((a, b) => Number(a["APG #"]) - Number(b["APG #"]));

  // Each of the 3 parallel blocks is sized to a fixed capacity, not the job's real bucket
  // count, so the tail of the last block is often unused (numbered, but blank) padding rather
  // than real data. Drop rows past the highest APG # that actually has a serial recorded.
  const notes: string[] = [];
  const realRows = rows.filter((r) => r["Serial #"] !== "");
  const maxRealApgNum = realRows.length > 0 ? Math.max(...realRows.map((r) => Number(r["APG #"]))) : 0;
  const trimmedRows = rows.filter((r) => Number(r["APG #"]) <= maxRealApgNum);

  const stillBlank = trimmedRows.filter((r) => r["Serial #"] === "");
  if (stillBlank.length > 0) {
    notes.push(`APG #(s) ${stillBlank.map((r) => r["APG #"]).join(", ")} have no serial number recorded.`);
  }

  return {
    sourceFile: path.basename(absolutePath),
    sheetName: sheet.name,
    columns: ["APG #", "Serial #", "Comment"],
    rows: trimmedRows,
    sampleSize: trimmedRows.length,
    populationSize: trimmedRows.length,
    notes,
    formHeader,
    hasNotesBox: true,
  };
}
