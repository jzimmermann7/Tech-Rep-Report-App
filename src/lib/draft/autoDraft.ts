import type { JobScanResult } from "../ingest/scanJobFolder";
import { loadJobState, updateSectionStates, type SectionState } from "../state/jobState";
import { buildFpiVisualDraft, buildRecommendedRepairsDraft, buildDimensionalSummaryDraft, buildIaSummaryDraft } from "./narrative";
import { selectBestPhotos } from "./photoSelect";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Automatic draft generation failed.";
}

/**
 * Runs once per job-folder scan to build the best-supported initial draft for every section, so
 * the tech rep opens the app to a completed draft to review instead of a row of buttons to click
 * through. All four narrative sections (I&A Summary, FPI/Visual, Dimensional Summary, Recommended
 * Repairs) are deterministic — built straight from job metadata and parsed source data, no LLM
 * call and no API key dependency at all — since what each of them actually says turned out to be
 * a fixed template with facts slotted in, not free writing. Only Photo Set still calls out to a
 * (best-effort, optional) vision model, purely to screen duplicates/blur; it degrades to "include
 * everything" if that call isn't available. Every section is independently best-effort: a failure
 * (missing source data, a failed request) is recorded on that section alone via `draftError` and
 * never stops the rest of the job from drafting. Never overwrites a section a human has already
 * touched — has content, a photo selection, or was explicitly acknowledged — so re-running this
 * on a rescan is safe and won't clobber review work in progress.
 *
 * The sections drafted here run concurrently and each writes its own patch — they're collected
 * and applied in a single batched write (via `updateSectionStates`) rather than each calling the
 * single-section update, since concurrent read-modify-write calls against the same state file
 * would race and silently drop all but the last writer.
 */
export async function autoDraftJob(scan: JobScanResult): Promise<void> {
  const jobRoot = scan.jobRoot;
  const bySectionId = new Map(scan.sections.map((s) => [s.id, s]));
  // Snapshot taken once, up front — every "should I touch this section" check below reads from
  // this, not from state written during this same run, so sections don't race each other.
  const existingState = await loadJobState(jobRoot);

  const isUntouched = (id: string): boolean => {
    const s = existingState.sections[id];
    return !s?.content && !(s?.selectedPhotoPaths && s.selectedPhotoPaths.length > 0) && !s?.acknowledged;
  };

  const ctx = { metadata: scan.metadata };
  const stamp = () => new Date().toISOString();

  type PatchEntry = [string, Partial<SectionState>] | null;

  const missingDataStep = (id: string, reason: string): PatchEntry => (isUntouched(id) ? [id, { draftError: reason }] : null);

  const jobs: Array<Promise<PatchEntry> | PatchEntry> = [];

  const crackMapAvailable = bySectionId.get("crackMap")?.status !== "missing";

  const fpi = bySectionId.get("fpiVisual");
  if (fpi?.parsedRouter) {
    if (isUntouched("fpiVisual")) {
      jobs.push(["fpiVisual", { content: buildFpiVisualDraft(fpi.parsedRouter, ctx, crackMapAvailable), draftError: undefined, lastGeneratedAt: stamp() }] satisfies PatchEntry);
    }
  } else {
    jobs.push(missingDataStep("fpiVisual", "No router file with FPI/visual operations was found for this job — draft this section manually."));
  }

  const repairs = bySectionId.get("recommendedRepairs");
  if (repairs?.parsedRouter) {
    if (isUntouched("recommendedRepairs")) {
      jobs.push(["recommendedRepairs", { content: buildRecommendedRepairsDraft(repairs.parsedRouter), draftError: undefined, lastGeneratedAt: stamp() }] satisfies PatchEntry);
    }
  } else {
    jobs.push(missingDataStep("recommendedRepairs", "No repair-router file was found for this job — draft this section manually."));
  }

  const dimTables = {
    heightDimForm: bySectionId.get("heightDimForm")?.parsedTable,
    dovetailDimension: bySectionId.get("dovetailDimension")?.parsedTable,
    wallThickness: bySectionId.get("wallThickness")?.parsedTable,
  };
  if (dimTables.heightDimForm || dimTables.dovetailDimension || dimTables.wallThickness) {
    // Runs on whatever tables exist, even just one of the three, and says so in the draft itself
    // rather than waiting for all of them.
    if (isUntouched("dimensionalSummary")) {
      jobs.push(["dimensionalSummary", { content: buildDimensionalSummaryDraft(dimTables), draftError: undefined, lastGeneratedAt: stamp() }] satisfies PatchEntry);
    }
  } else {
    jobs.push(
      missingDataStep("dimensionalSummary", "No dimensional inspection data (heights, dovetail, or wall thickness) was found for this job — draft this section manually.")
    );
  }

  // I&A Summary is a fill-in-the-blank synthesis of job metadata plus whichever dimensional data
  // and exhibits (met sample, crack map) are on hand — it doesn't need the other three sections'
  // drafted *text*, just the same underlying facts, so it can run independently of them and
  // still produce a correct summary even if, say, the repair router is missing.
  if (isUntouched("iaSummary") && scan.metadata.jobNumber) {
    const metSampleAvailable = bySectionId.get("metallurgicalReport")?.status !== "missing";
    jobs.push([
      "iaSummary",
      { content: buildIaSummaryDraft({ metadata: scan.metadata, dimTables, metSampleAvailable, crackMapAvailable }), draftError: undefined, lastGeneratedAt: stamp() },
    ] satisfies PatchEntry);
  } else if (!scan.metadata.jobNumber) {
    jobs.push(missingDataStep("iaSummary", "No job number could be resolved for this folder — draft this section manually."));
  }

  const photoSection = bySectionId.get("photoSet");
  if (photoSection && photoSection.matchedFiles.length > 0) {
    if (isUntouched("photoSet")) {
      jobs.push(
        selectBestPhotos(photoSection.matchedFiles)
          .then((result): PatchEntry => [
            "photoSet",
            { selectedPhotoPaths: result.includedPaths, content: result.raw, draftError: undefined, lastGeneratedAt: stamp() },
          ])
          .catch((err): PatchEntry => ["photoSet", { draftError: errorMessage(err) }])
      );
    }
  } else {
    jobs.push(missingDataStep("photoSet", "No photo folder was found for this job."));
  }

  const results = await Promise.all(jobs);
  const patches = Object.fromEntries(results.filter((e): e is [string, Partial<SectionState>] => e !== null));
  if (Object.keys(patches).length > 0) {
    await updateSectionStates(jobRoot, patches);
  }
}
