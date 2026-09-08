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
  /** The form's own header block (e.g. DS-0554's Customer/Date/Page/Insp/Cast P/N row), read
   * straight from the same source cells the real form prints — shown above the table so the
   * report matches the original form's layout instead of just the data grid. */
  formHeader?: Array<{ label: string; value: string }>;
  /** Freeform "NOTES:" box the real form prints under the table, for a reviewer's handwritten
   * remarks — kept as its own box (even when empty) rather than folded into `notes`, which are
   * this app's own automated caveats, not part of the original form. */
  hasNotesBox?: boolean;
}
