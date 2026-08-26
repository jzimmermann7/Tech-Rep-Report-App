import path from "path";
import { loadWorkbook, cellText } from "../excel";
import type { ParsedTable } from "./types";

/**
 * DS-0554 "Serial Number List". Layout (confirmed against Job 20443):
 * sheet name contains "serial number sheet"; header row 7; three parallel
 * column-blocks of [APG#, Serial#, Comment] starting at columns A, E, I,
 * each covering a third of the population. Data starts row 8.
 */
export async function parseSerialNumberList(absolutePath: string): Promise<ParsedTable | null> {
  const workbook = await loadWorkbook(absolutePath);
  const sheet = workbook.worksheets.find((s) => /serial number sheet/i.test(s.name));
  if (!sheet) return null;

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
  };
}
