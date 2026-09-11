import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import os from "os";

export interface SectionState {
  /** Current draft/content text (narrative sections), or a JSON-serialized table edit, etc. */
  content?: string;
  /** For photo-select sections: the reviewer-confirmed selection. */
  selectedPhotoPaths?: string[];
  /** For the I&A Summary narrative section only: whether to embed APG's standard 7FA
   * modification-reference diagram (a fixed illustration, not one of the job's own photos --
   * every 7FA I&A report includes it, showing the six standard modification callouts against a
   * generic bucket drawing) below the summary text. Defaults to on for any job whose turbine
   * model is a 7FA variant (see renderReportHtml.ts's renderStandardDiagram) -- set to false here
   * to leave it out for a specific job; there's no per-job photo picker for this, since it's the
   * same fixed reference image on every 7FA job, not something to select per job. */
  includeStandardDiagram?: boolean;
  /** For the cover section: reviewer overrides/fill-ins for fields with no reliable auto-source
   * (Tech Rep, Customer PO, Prior Repair, Coating, ...), keyed the same as JobMetadata. */
  fields?: Record<string, string>;
  /** True once a human has looked at this section and accepted it, even if status was
   * "needs-attention" or "missing" — lets "Generate Report" proceed deliberately. */
  acknowledged?: boolean;
  lastGeneratedAt?: string;
  /** Set when automatic draft generation (on job-folder scan) couldn't produce content for this
   * section — missing source data, a missing API key, a failed request, etc. Surfaced in the UI
   * as an explicit "needs human review" flag instead of silently leaving the section blank.
   * Cleared as soon as content is successfully generated or edited. */
  draftError?: string;
  /** For attach-as-is sections (chem test, crack map, met report) where more than one file
   * matched the naming pattern: the tech rep's own pick of which one is actually the real
   * exhibit, by relativePath. Overrides the auto-picked candidate for report generation. */
  selectedAttachmentPath?: string;
  /** For table-from-source sections (Serial Number List, Height Dim Form, Dovetail Dimension,
   * Wall Thickness): manual corrections to individual cells of the freshly-parsed table -- a
   * typo'd serial number, a re-measured value, etc. Keyed "<row index>:<column name>" against
   * that table's own row order (see applyTableEdits), and applied on top of the parse on every
   * render, in both the review screen and the generated PDF -- never written back to the source
   * spreadsheet itself. */
  tableEdits?: Record<string, string>;
  /** Freeform text for the real form's own blank "NOTES:" box under the table -- a reviewer's
   * typed remarks standing in for what would be handwritten on the paper form, not one of this
   * app's own automated notes (which live in ParsedTable.notes instead). */
  tableNotes?: string;
}

export interface JobState {
  jobRoot: string;
  sections: Record<string, SectionState>;
}

function stateDir(): string {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  return path.join(base, "TechRepReportApp", "jobs");
}

function stateFilePath(jobRoot: string): string {
  const hash = crypto.createHash("sha256").update(jobRoot).digest("hex").slice(0, 16);
  return path.join(stateDir(), `${hash}.json`);
}

export async function loadJobState(jobRoot: string): Promise<JobState> {
  const filePath = stateFilePath(jobRoot);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as JobState;
  } catch {
    return { jobRoot, sections: {} };
  }
}

export async function saveJobState(state: JobState): Promise<void> {
  const filePath = stateFilePath(state.jobRoot);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(state, null, 2), "utf-8");
}

export async function updateSectionState(jobRoot: string, sectionId: string, patch: Partial<SectionState>): Promise<JobState> {
  const state = await loadJobState(jobRoot);
  state.sections[sectionId] = { ...state.sections[sectionId], ...patch };
  await saveJobState(state);
  return state;
}

/** Applies patches for several sections in one read-modify-write. Calling `updateSectionState`
 * concurrently for different sections is a lost-update race — each call reads the whole file,
 * so whichever write lands last wins and silently drops the others. Anything that patches more
 * than one section around the same time (e.g. drafting several sections in parallel) must batch
 * through here instead. */
export async function updateSectionStates(jobRoot: string, patches: Record<string, Partial<SectionState>>): Promise<JobState> {
  const state = await loadJobState(jobRoot);
  for (const [sectionId, patch] of Object.entries(patches)) {
    state.sections[sectionId] = { ...state.sections[sectionId], ...patch };
  }
  await saveJobState(state);
  return state;
}
