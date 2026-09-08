import path from "path";
import { loadWorkbook, cellText, cellNumber } from "../excel";
import type { ParsedTable } from "./types";

/**
 * DS-1017 "Dovetail Dimension Inspection". Layout (confirmed against Job 20443): sheet named
 * "DS-1017". Header row 8: bucket APG# appears (duplicated across a pair of columns) starting
 * at columns C, E, G, I, K, M, with an AVG column at O. Data rows 9-26: each of 9 measurement
 * rows (3 dimension letters x 3 positions LE/Mid/TE) is itself duplicated across two physical
 * rows with identical values, so only every other row is read. Column A holds the dimension
 * letter and its spec min/max embedded as text (e.g. "A\n0.795\" 0.815\""); column B holds the
 * position label.
 */
/** Exported so scanJobFolder.ts's Excel-COM PDF fallback can select a matching sheet when it
 * needs to render (not just read) this workbook -- see PRINT_PDF_SECTIONS. A looser combined
 * form of the two-part check just below (good enough for that fallback; falls back to the
 * workbook's first sheet if nothing matches at all). */
export const DOVETAIL_SHEET_PATTERN = /dovetail|ds-?1017/i;

export async function parseDovetailDimension(absolutePath: string): Promise<ParsedTable | null> {
  const workbook = await loadWorkbook(absolutePath);
  const sheet = workbook.worksheets.find((s) => /^ds-?1017$/i.test(s.name.trim()) || /dovetail/i.test(s.name));
  if (!sheet) return null;

  const bucketCols = [3, 5, 7, 9, 11, 13]; // C, E, G, I, K, M
  const avgCol = 15; // O
  const headerRow = sheet.getRow(8);
  const bucketLabels = bucketCols.map((c) => cellText(headerRow.getCell(c)));

  const rows: Array<Record<string, string>> = [];
  const notes: string[] = [];
  let outOfSpecCount = 0;

  for (let r = 9; r <= 26; r += 2) {
    const specText = cellText(sheet.getRow(r).getCell(1));
    if (specText === "") continue;
    const position = cellText(sheet.getRow(r).getCell(2));
    const letterMatch = specText.match(/^([A-Z])/);
    const numbers = specText.match(/[\d.]+/g);
    const letter = letterMatch ? letterMatch[1] : "?";
    const min = numbers && numbers.length >= 1 ? Number(numbers[0]) : null;
    const max = numbers && numbers.length >= 2 ? Number(numbers[1]) : null;

    const row: Record<string, string> = {
      Dimension: `${letter} (${min ?? "?"}"–${max ?? "?"}")`,
      Position: position,
    };
    let rowHasFailure = false;
    bucketCols.forEach((c, i) => {
      const value = cellNumber(sheet.getRow(r).getCell(c));
      const label = bucketLabels[i];
      if (value === null) {
        row[`Bucket ${label}`] = "";
        return;
      }
      const pass = min !== null && max !== null ? value >= min && value <= max : null;
      row[`Bucket ${label}`] = pass === null ? String(value) : `${value}${pass ? "" : " (OUT OF SPEC)"}`;
      if (pass === false) rowHasFailure = true;
    });
    const avgValue = cellNumber(sheet.getRow(r).getCell(avgCol));
    row["AVG"] = avgValue === null ? "" : String(avgValue);
    if (rowHasFailure) outOfSpecCount++;
    rows.push(row);
  }

  const sampledBuckets = new Set(bucketLabels).size;
  notes.push(
    `This form samples ${sampledBuckets} bucket(s) (APG # ${bucketLabels.join(", ")}), not the full population — treat this as a spot-check, not a 100% inspection.`
  );

  return {
    sourceFile: path.basename(absolutePath),
    sheetName: sheet.name,
    columns: ["Dimension", "Position", ...bucketLabels.map((l) => `Bucket ${l}`), "AVG"],
    rows,
    sampleSize: sampledBuckets,
    outOfSpecCount,
    notes,
  };
}
