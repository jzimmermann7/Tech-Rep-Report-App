export interface ParsedTable {
  sourceFile: string;
  sheetName: string;
  columns: string[];
  rows: Array<Record<string, string>>;
  /** Pre-computed or derived summary row(s) (label -> value per column). */
  summaryRows?: Array<Record<string, string>>;
  /** How many distinct buckets/serials actually have data in this table. */
  sampleSize: number;
  /** Total population for the job, when known (e.g. from the serial number list), for
   * comparison against sampleSize so a partial sample is visible, not silently implied full. */
  populationSize?: number;
  /** How many rows/buckets have at least one out-of-spec reading, if pass/fail was computed. */
  outOfSpecCount?: number;
  /** Assumptions, caveats, anything a reviewer should know before trusting this table. */
  notes: string[];
}
