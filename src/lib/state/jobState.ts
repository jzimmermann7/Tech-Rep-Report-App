import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import os from "os";

export interface SectionState {
  /** Current draft/content text (narrative sections), or a JSON-serialized table edit, etc. */
  content?: string;
  /** For photo-select sections: the reviewer-confirmed selection. */
  selectedPhotoPaths?: string[];
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
