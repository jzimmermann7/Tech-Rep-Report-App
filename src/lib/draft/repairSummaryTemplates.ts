import type { JobMetadata } from "../ingest/jobMetadata";

// The Final Report's Repair Summary: APG's own standard past-tense list of what was done to the set,
// one per bucket stage. NOT built from the repair router -- the router lists the planned scope in
// work-instruction wording (with consumables, weld wire, pins and powders as their own rows), while
// every completed Final Report prints this customer-facing list instead (confirmed across completed
// Final Reports for stage 1, 2 and 3 jobs). It's only a starting point: the tech rep removes the
// steps that didn't apply to the job and adds any that did, in the review screen.
//
// Weld wire is deliberately never named -- a weld step just says the weld repair was done.
//
// Stages 1 and 2 are APG's approved standards, word for word (stage 1 is the F7EA list). Stage 3 is
// drafted from the completed F7FA Final Reports and still needs APG's sign-off.

export type RepairSummaryStage = 1 | 2 | 3;

const STAGE_1 = [
  "Defects Prepped As Required",
  "Platform Edge Break Performed",
  "Tips Prepped For Height Restoration Weld Repair",
  "Cooling Holes Checked For Blockage",
  "Pre-Weld Heat Treat",
  "FPI & Report",
  "Defects Welded As Required",
  "Squealer Tips Weld Repaired To Restore Heights",
  "Welds Blended To Contour",
  "Dust Blast Clean",
  "Cooling Holes Checked For Blockage",
  "FPI & Report",
  "Touch-Up As Required",
  "Post-Weld Solution Heat Treat",
  "FPI & Report",
  "Touch-Up As Required",
  "Performed Trailing Edge Cut-Back",
  "Machine Bucket Tip To APG Specification",
  "Thermal Clean",
  "Deburr Machined Tips",
  "TE Cutback Performed To Accommodate For TBC Coating",
  "Local FPI / Visual Inspect Machined Squealer Tips",
  "Touch-Up As Required",
  "Wall Thickness Final Inspected (As Required)",
  "Dimensional Heights Pre-Coat Inspected (20 Buckets)",
  "Airfoil HVOF MCrAlY Coated",
  "Diffusion + Final Age Heat Treat",
  "Airfoil HD TBC Topcoat Applied",
  "Coating Hand Sanded For Surface Finish",
  "Cooling Holes Checked For Blockage",
  "Root Serrations Shot Peened",
  "Root Serrations Aluminium Seal Strip Applied",
  "Final Visual Inspect",
  "Damper Pin Rock Check Inspection ({TIL}) Performed",
  "Dimensional Heights Final Inspected",
  "Cooling Holes Rod Checked For Blockage",
  "Moment Weigh, Sequence And Sticker",
  "Final Ship / Moment Weigh SN Cross Check Performed",
  "Final Photograph",
  "Final Report",
];

const STAGE_2 = [
  "Defects Prepped As Required",
  "Cutter Tooth Removal Modification Performed",
  "Shroud Lift Modification Performed",
  "Z-Notch Thickness Modification Performed",
  "Z-Notches Prepped For Welding",
  "Cooling Holes Checked For Blockage",
  "Pre-Weld Heat Treat",
  "FPI & Report",
  "Defects Welded & Blended To Contour",
  "Z-Notches Welded Using Stellite 694",
  "Dust Blast Clean",
  "Cooling Holes Checked For Blockage",
  "FPI & Report",
  "Touch-Up As Required",
  "Post-Weld Heat Treat",
  "Z-Notches Machined To APG Specifications",
  "Thermal Degrease",
  "Deburred Machined Surfaces",
  "Z-Fillet Relief Cutback Incorporated",
  "Platform Edge Break Performed",
  "Pre-Coat Dimensional Inspect:",
  "Dimensional Inspect Z-Notch 100%",
  "Dimensional Inspect Heights 20 Buckets",
  "Load Buckets In Wheel For Fit-up Checks",
  "Dust Blast Clean",
  "Cooling Holes Checked For Blockage",
  "FPI & Report",
  "Wall Thickness Inspected (As Required)",
  "Touch-Up As Required",
  "Apply Rail AL/OX Coating",
  "Check Cooling Holes For Blockage",
  "Inspect For Coating Defects",
  "Root Serrations Shot-Peened",
  "Applied Root Serration Aluminum Seal Strip",
  "Final Visual Inspection",
  "Rod Check Cooling Holes",
  "Damper Pin Rock Inspection {TIL}",
  "Final Dimensional Rail Heights 100%",
  "Final Dimensional Inspect Z-Notches 20 Buckets",
  "Moment Weigh, Sequence And Sticker",
  "Bucket Final Ship S/N Cross Checked With Final Moment Weigh S/N",
  "Final Photograph",
  "Final Report",
];

const STAGE_3 = [
  "Shroud Weight Reduction Modification Performed",
  "Defects Prepped As Required",
  "Platform Edge Break Performed",
  "Z-Notches Prepped For Weld Repair",
  "Pre-Weld Heat Treat",
  "FPI & Report",
  "Defects Welded And Blended As Required",
  "Z-Notch Faces Weld Repaired",
  "Rail Cutter Tooth Removal Modification Performed",
  "Dust Blast Clean",
  "FPI & Report",
  "Touch-Up As Required",
  "Post-Weld Heat Treat",
  "Dust Blast Clean",
  "FPI / Visual Inspect And Report",
  "Touch-Up As Required",
  "Pre-Coat Dimensional Heights Inspected (20 Buckets)",
  "Airfoil Coating Applied",
  "Post-Coat Diffusion + Age Heat Treat",
  "Z-Notches CNC Machined To Specification",
  "Z-Notches Deburred",
  "Z-Notches Local FPI Inspected",
  "Z-Fillet Relief Cutback Modification Performed",
  "Touch-Up As Required",
  "Final Dimensional Inspect Z-Notches (100%)",
  "Full Wheel Fit-Up Check Performed",
  "Dust Blast Clean",
  "Rails AL/OX Abrasive Coated",
  "Roots Shot Peened",
  "Final Visual Inspect",
  "Damper Pin Rock Check Inspection ({TIL}) Performed",
  "Final Dimensional Inspect Rail Heights (20 Buckets)",
  "Moment Weigh, Sequence And Sticker",
  "Final Ship / Moment Weigh SN Cross Check Performed",
  "Final Photograph",
  "Final Report",
];

const TEMPLATES: Record<RepairSummaryStage, string[]> = { 1: STAGE_1, 2: STAGE_2, 3: STAGE_3 };

/** Which bucket stage a job is, read from its own part/component text ("F7EA 2ND STAGE BUCKETS"). */
export function repairSummaryStage(metadata: Pick<JobMetadata, "component" | "part">): RepairSummaryStage | null {
  const match = `${metadata.component} ${metadata.part}`.match(/\b(\d)(?:st|nd|rd|th)\s*stage/i);
  const stage = match ? Number(match[1]) : 0;
  return stage === 1 || stage === 2 || stage === 3 ? stage : null;
}

/** The Damper Pin Rock Check's TIL number depends on the frame: TIL-2377 on the 7FA, TIL-2365 on
 * everything else seen in the completed reports (7EA, 6B, 9E, 5-frame). */
function damperPinTil(metadata: Pick<JobMetadata, "turbineModel" | "component" | "part">): string {
  return /7FA/i.test(`${metadata.turbineModel} ${metadata.component} ${metadata.part}`) ? "TIL-2377" : "TIL-2365";
}

/** The standard Repair Summary for this job's stage, as the app's bullet markup ("- " per line).
 * Empty when the stage can't be read from the job. */
export function buildRepairSummaryDraft(metadata: Pick<JobMetadata, "turbineModel" | "component" | "part">): string {
  const stage = repairSummaryStage(metadata);
  if (!stage) return "";
  const til = damperPinTil(metadata);
  return TEMPLATES[stage].map((line) => `- ${line.replace("{TIL}", til)}`).join("\n");
}
