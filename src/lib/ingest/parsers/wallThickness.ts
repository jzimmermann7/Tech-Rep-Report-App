import path from "path";
import { loadWorkbook, cellText, cellNumber } from "../excel";
import type { ParsedTable } from "./types";

/**
 * DS-0002 / "UT" wall-thickness form. Layout (confirmed against Job 20443): sheet name
 * contains "wall thickness"; row 9 holds the minimum-limit value for each of six measurement
 * columns (E-J: LECC, LECV, 1CC, 2CC, 1CV, 2CV), row 10 holds those column headers plus APG #
 * (col B) and Height % (col C); data rows from 11, three rows per bucket (measured at 90%,
 * 50%, 10% span height), until a row whose Height-% column reads "MIN" (the source file's own
 * summary row, kept separately — do not treat it as a data row).
 */
export async function parseWallThickness(absolutePath: string): Promise<ParsedTable | null> {
  const workbook = await loadWorkbook(absolutePath);
  const sheet = workbook.worksheets.find((s) => /wall thickness|ds-?0002/i.test(s.name));
  if (!sheet) return null;

  const measureCols = [5, 6, 7, 8, 9, 10]; // E..J
  const columnNames = measureCols.map((c) => cellText(sheet.getRow(10).getCell(c)));
  const limits = measureCols.map((c) => cellNumber(sheet.getRow(9).getCell(c)));

  const rows: Array<Record<string, string>> = [];
  const bucketNumbers = new Set<string>();
  let outOfSpecCount = 0;
  const bucketFailed = new Set<string>();

  let r = 11;
  while (r <= sheet.rowCount) {
    const heightLabel = cellText(sheet.getRow(r).getCell(3));
    if (/^min$/i.test(heightLabel)) break;
    const apgNum = cellText(sheet.getRow(r).getCell(2));
    if (apgNum === "" && heightLabel === "") {
      r++;
      continue;
    }
    bucketNumbers.add(apgNum);
    const row: Record<string, string> = { "APG #": apgNum, "Height %": heightLabel };
    measureCols.forEach((c, i) => {
      const value = cellNumber(sheet.getRow(r).getCell(c));
      const limit = limits[i];
      if (value === null) {
        row[columnNames[i]] = "";
        return;
      }
      const pass = limit !== null ? value >= limit : null;
      row[columnNames[i]] = pass === null ? String(value) : `${value}${pass ? "" : " (OUT OF SPEC)"}`;
      if (pass === false) bucketFailed.add(apgNum);
    });
    rows.push(row);
    r++;
  }
  outOfSpecCount = bucketFailed.size;

  const summaryRows: Array<Record<string, string>> = [
    {
      "APG #": "Spec minimum",
      "Height %": "",
      ...Object.fromEntries(columnNames.map((name, i) => [name, limits[i] === null ? "" : String(limits[i])])),
    },
  ];

  return {
    sourceFile: path.basename(absolutePath),
    sheetName: sheet.name,
    columns: ["APG #", "Height %", ...columnNames],
    rows,
    summaryRows,
    sampleSize: bucketNumbers.size,
    outOfSpecCount,
    notes: [`${bucketFailed.size} of ${bucketNumbers.size} bucket(s) have at least one reading below the printed minimum limit.`],
  };
}
