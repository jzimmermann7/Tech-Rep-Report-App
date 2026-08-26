import ExcelJS from "exceljs";

/** Load a workbook from disk. Works for .xlsx and .xlsm (macros are ignored, we only read cells). */
export async function loadWorkbook(absolutePath: string): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(absolutePath);
  return workbook;
}

/** Coerce a cell value to a plain string, resolving formula results and rich text. */
export function cellText(cell: ExcelJS.Cell | undefined): string {
  if (!cell) return "";
  const v = cell.value as unknown;
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    const anyV = v as { richText?: { text: string }[]; result?: unknown; text?: string; error?: string };
    if (anyV.richText) return anyV.richText.map((r) => r.text).join("");
    if (anyV.error) return "";
    if (typeof anyV.result === "number" || typeof anyV.result === "string") return String(anyV.result);
    if (typeof anyV.text === "string") return anyV.text;
    if (v instanceof Date) return v.toISOString();
    return "";
  }
  return String(v).trim();
}

/** Coerce a cell value to a number if possible, else null. Resolves formula results. */
export function cellNumber(cell: ExcelJS.Cell | undefined): number | null {
  if (!cell) return null;
  const v = cell.value as unknown;
  if (typeof v === "number") return v;
  if (typeof v === "object" && v !== null) {
    const anyV = v as { result?: unknown };
    if (typeof anyV.result === "number") return anyV.result;
  }
  const text = cellText(cell);
  if (text === "") return null;
  const n = Number(text.replace(/[^0-9.+-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * True if a cell's raw XML-level value looks like a bare shared-string index that never got
 * resolved to text (the router-workbook macro/external-link caching artifact) — a plain
 * integer sitting where a multi-word phrase is expected. Heuristic: exceljs already resolves
 * shared strings correctly in the vast majority of cases; this catches the residual case where
 * a cell that should be a note (given its neighbor is a real label) evaluates as a short numeric
 * string instead of prose.
 */
export function looksLikeUnresolvedPlaceholder(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === "") return false;
  return /^\d+$/.test(trimmed) && trimmed.length <= 6;
}
