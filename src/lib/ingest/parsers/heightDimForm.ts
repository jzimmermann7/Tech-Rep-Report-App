import path from "path";
import { loadWorkbook, cellText, cellNumber } from "../excel";
import type { ParsedTable } from "./types";

/**
 * DS-0004 "Tip & Angel Wing Height" form. Layout (confirmed against Job 20443, via the
 * job's actual data source "HEIGHTS - INCOMING.xlsx" — see the ingestion source rules for
 * why that file, not the blank same-named DS-0004 template, is preferred):
 *
 * sheet name contains "1st stg heights"; row 5 = dimension group label per column (with the
 * tolerance note "All Dims +/- 0.025"" in column A); row 6 = spec text per column; row 7 =
 * sub-header (MID/LE/TE/Min/Max); data rows from 8 until a row labelled MIN/AVG/MAX in column A.
 * Columns B-G are nominal-with-tolerance dimensions; columns H-I are direct Min/Max bounds for
 * squealer tip thickness. "MM" in a data cell means not measured.
 */
/** Exported so scanJobFolder.ts's Excel-COM PDF fallback can select the same sheet this parser
 * would, when it needs to render (not just read) this workbook -- see PRINT_PDF_SECTIONS. */
export const HEIGHT_DIM_FORM_SHEET_PATTERN = /1st stg heights|ds-?0004/i;

export async function parseHeightDimForm(absolutePath: string): Promise<ParsedTable | null> {
  const workbook = await loadWorkbook(absolutePath);
  const sheet = workbook.worksheets.find((s) => HEIGHT_DIM_FORM_SHEET_PATTERN.test(s.name));
  if (!sheet) return null;

  const toleranceMatch = cellText(sheet.getRow(5).getCell(1)).match(/\+\/-\s*([\d.]+)/);
  const tolerance = toleranceMatch ? Number(toleranceMatch[1]) : null;

  const dataCols = [2, 3, 4, 5, 6, 7, 8, 9]; // B..I
  const groupLabels = dataCols.map((c) => cellText(sheet.getRow(5).getCell(c)));
  const subLabels = dataCols.map((c) => cellText(sheet.getRow(7).getCell(c)));
  const specText = dataCols.map((c) => cellText(sheet.getRow(6).getCell(c)));

  const columnNames = dataCols.map((c, i) => {
    const group = groupLabels[i].replace(/\s+/g, " ").trim();
    const sub = subLabels[i].trim();
    return group ? `${group} (${sub})` : sub;
  });

  // Columns H/I (indices 6,7 in dataCols) are direct min/max bounds; B-G use nominal +/- tolerance.
  const specNominal = specText.map((t) => {
    const m = t.match(/([\d.]+)/);
    return m ? Number(m[1]) : null;
  });

  const rows: Array<Record<string, string>> = [];
  let outOfSpecCount = 0;
  const notes: string[] = [];
  if (tolerance === null) notes.push("Could not parse the +/- tolerance note; pass/fail was skipped.");

  let r = 8;
  while (r <= sheet.rowCount) {
    const label = cellText(sheet.getRow(r).getCell(1));
    if (/^(min|avg|max)$/i.test(label)) break;
    if (label === "") {
      r++;
      continue;
    }
    const row: Record<string, string> = { "APG #": label };
    let rowHasFailure = false;
    dataCols.forEach((c, i) => {
      const raw = cellText(sheet.getRow(r).getCell(c));
      const colName = columnNames[i];
      if (raw === "" || /^mm$/i.test(raw)) {
        row[colName] = "Not measured";
        return;
      }
      const value = cellNumber(sheet.getRow(r).getCell(c));
      if (value === null) {
        row[colName] = raw;
        return;
      }
      let pass: boolean | null = null;
      if (i === 6) pass = specNominal[6] !== null ? value >= specNominal[6]! : null; // Min bound
      else if (i === 7) pass = specNominal[7] !== null ? value <= specNominal[7]! : null; // Max bound
      else if (tolerance !== null && specNominal[i] !== null) {
        pass = Math.abs(value - specNominal[i]!) <= tolerance;
      }
      row[colName] = pass === null ? String(value) : `${value}${pass ? "" : " (OUT OF SPEC)"}`;
      if (pass === false) rowHasFailure = true;
    });
    if (rowHasFailure) outOfSpecCount++;
    rows.push(row);
    r++;
  }

  // Capture any MIN/AVG/MAX summary rows the source file already computed.
  const summaryRows: Array<Record<string, string>> = [];
  while (r <= sheet.rowCount) {
    const label = cellText(sheet.getRow(r).getCell(1));
    if (!/^(min|avg|max)$/i.test(label)) break;
    const summaryRow: Record<string, string> = { "APG #": label };
    dataCols.forEach((c, i) => {
      summaryRow[columnNames[i]] = cellText(sheet.getRow(r).getCell(c));
    });
    summaryRows.push(summaryRow);
    r++;
  }

  notes.push(
    `Pass/fail for angel-wing and tip-height columns assumes a nominal +/- ${tolerance ?? "?"}" tolerance parsed from the sheet header; squealer tip thickness (Min/Max columns) is checked against the printed bounds directly.`
  );

  return {
    sourceFile: path.basename(absolutePath),
    sheetName: sheet.name,
    columns: ["APG #", ...columnNames],
    rows,
    summaryRows,
    sampleSize: rows.length,
    outOfSpecCount,
    notes,
  };
}
