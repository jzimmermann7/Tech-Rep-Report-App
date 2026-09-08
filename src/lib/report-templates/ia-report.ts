import type { ReportTemplate } from "./types";

// Section order, source rules, and generation strategy for the I&A Report.
// Reverse-engineered from a real completed job (APG Job 20443) plus the
// company's own "TR Summary" tracker tab (Claudability ratings carried over
// into `automationConfidence` / `confidenceNote`).
export const iaReportTemplate: ReportTemplate = {
  reportType: "I&A Report",
  sections: [
    {
      id: "cover",
      title: "Title / Cover",
      sourceRules: [{ kind: "jobMetadata" }],
      generation: "template",
      automationConfidence: "high",
    },
    {
      id: "iaSummary",
      title: "I&A Summary",
      sourceRules: [],
      dependsOnSections: ["fpiVisual", "dimensionalSummary", "recommendedRepairs"],
      generation: "llm-narrative",
      automationConfidence: "high",
      confidenceNote:
        "Built entirely from job metadata and whichever dimensional/exhibit data is on hand — no AI call, so no API key dependency. It's a fixed sentence template (received → visual → seal-strip/root-galling → dimensional → met-sample → airfoil-cleaning → FPI/visual) with facts slotted in, confirmed against a real completed report; optional bullets and clauses only appear when that data actually exists, rather than being invented.",
    },
    {
      id: "fpiVisual",
      title: "FPI & Visual Inspection Summary",
      sourceRules: [
        {
          kind: "filenamePattern",
          pattern: /(^|[^a-z])ia[_ -]?router/i,
          excludePattern: /^copy of/i,
          requiredExtensions: [".xlsm", ".xlsx"],
        },
      ],
      generation: "llm-narrative",
      automationConfidence: "high",
      confidenceNote:
        "Built directly from the router data — no AI call at all, so it never depends on an API key. Procedure/form numbers are pulled straight out of the router's own note text. The router's FPI note is procedural (what to inspect), never the actual zone-by-zone findings — those live only in the crack map, so the draft never tries to derive them: it defers to the crack map as its own exhibit when one's found, and explicitly states when findings aren't available rather than inventing them.",
    },
    {
      id: "dimensionalSummary",
      title: "Dimensional Inspection Summary",
      sourceRules: [],
      dependsOnSections: ["heightDimForm", "dovetailDimension", "wallThickness"],
      generation: "llm-narrative",
      automationConfidence: "high",
      alwaysReview: true,
      confidenceNote:
        "Built entirely from the computed pass/fail tables — no AI call at all, so it never depends on an API key. Drafts from whichever of Height Dim Form, Dovetail, and Wall Thickness are actually present, even if not all three are, and says plainly in the draft which ones are still missing. The overall repairability call is intentionally left for the tech rep to confirm, not asserted automatically.",
    },
    {
      id: "recommendedRepairs",
      title: "Recommended Repairs",
      sourceRules: [
        {
          kind: "filenamePattern",
          pattern: /repair[_ -]?router/i,
          excludePattern: /^copy of/i,
          requiredExtensions: [".xlsm", ".xlsx"],
        },
      ],
      generation: "llm-narrative",
      automationConfidence: "high",
      confidenceNote:
        "Built directly from the router's own active step labels — no AI call, so no API key dependency; the earlier concern that this needed AI (and so couldn't run without sending the router to a model) no longer applies, since it's now pure code reading the file. Confirmed against a real completed report that APG's own convention is exactly this — the router's step labels in sequence, repeats and all — with only the \"(Opt)\" suffix and a handful of internal admin checkpoints (Foreman/Quality Review, QC hold point, Consumables) dropped.",
    },
    {
      id: "chemTest",
      title: "Chem Test",
      sourceRules: [
        {
          kind: "filenamePattern",
          pattern: /chem.*(strip|test)/i,
          requiredExtensions: [".pdf"],
          preferFolder: /reports/i,
        },
      ],
      generation: "attach-as-is",
      automationConfidence: "high",
      confidenceNote: "Sent directly from the 3rd-party vendor; attached as-is, no drafting needed.",
    },
    {
      id: "photoSet",
      title: "Photo Set",
      sourceRules: [
        {
          kind: "folderPattern",
          pattern: /pictures/i,
          fileExtensions: [".jpg", ".jpeg", ".png"],
        },
        {
          // Fallback for jobs that paste incoming photos directly into a template document
          // instead of keeping loose files in a Pictures folder — only used when the folder
          // rule above finds nothing; see scanFileBackedSection's llm-vision-select branch.
          kind: "filenamePattern",
          pattern: /photo.*template/i,
          requiredExtensions: [".pdf"],
        },
      ],
      generation: "llm-vision-select",
      automationConfidence: "medium",
      alwaysReview: true,
      confidenceNote:
        "Preselects Incoming/NDT photos automatically — tech reps aren't picky about volume within that set, so the only screening is flagging exact/near-duplicates and shots too blurry to use. In-process/final-stage photos are still browsable but not preselected, since this is an incoming-inspection report. Falls back to extracting photos from a \"Photos Template\" PDF when there's no raw photo folder. Still flagged for human confirmation since it's an image-judgment call.",
    },
    {
      id: "crackMap",
      title: "Crack Map",
      sourceRules: [
        {
          kind: "filenamePattern",
          pattern: /crack[_ -]?map/i,
          requiredExtensions: [".pdf", ".jpg", ".jpeg", ".png"],
        },
      ],
      generation: "attach-as-is",
      automationConfidence: "high",
      alwaysReview: true,
      confidenceNote:
        "Same mechanism as Chem Test / Metallurgical Report: found by filename pattern and attached as-is, no drafting. Still flagged for human confirmation since this prototype never auto-interprets the markings — that's on the tech rep.",
    },
    {
      id: "serialNumberList",
      title: "Serial Number List",
      sourceRules: [
        {
          kind: "filenamePattern",
          pattern: /ds-?0554.*incoming/i,
          requiredExtensions: [".xlsx"],
        },
        {
          kind: "filenamePattern",
          pattern: /ds-?0554/i,
          excludePattern: /in.?process|final/i,
          requiredExtensions: [".xlsx"],
        },
      ],
      generation: "table-from-source",
      automationConfidence: "high",
      confidenceNote: "Transcribed directly from Form DS-0554; the three parallel column blocks are un-pivoted into one table.",
    },
    {
      id: "heightDimForm",
      title: "Height Dim Form",
      sourceRules: [
        {
          kind: "filenamePattern",
          pattern: /heights.*incoming/i,
          requiredExtensions: [".xlsx"],
        },
        {
          kind: "filenamePattern",
          pattern: /ds-?0004/i,
          excludePattern: /in.?process|final/i,
          requiredExtensions: [".xlsx"],
        },
      ],
      generation: "table-from-source",
      automationConfidence: "high",
      confidenceNote:
        "Tip & angel-wing heights from Form DS-0004. Some jobs keep the real data in a differently-named workbook next to a blank DS-0004 template — both are tried, and a blank match is skipped. When a completed, print-ready PDF of this exact form also exists on disk, the report embeds that PDF verbatim instead of a re-rendered table, so its diagrams and formatting come through intact — the spreadsheet is still what this review screen shows and what other sections' narratives draw from.",
    },
    {
      id: "dovetailDimension",
      title: "Dovetail Dimension Inspection",
      sourceRules: [
        {
          kind: "filenamePattern",
          pattern: /ds-?1017.*incoming/i,
          requiredExtensions: [".xlsx"],
        },
        {
          kind: "filenamePattern",
          pattern: /ds-?1017/i,
          excludePattern: /in.?process|final/i,
          requiredExtensions: [".xlsx"],
        },
      ],
      generation: "table-from-source",
      automationConfidence: "high",
      confidenceNote:
        "Root/dovetail measurements from Form DS-1017. Often a sampled subset of the full population, not every serial number — the draft states the sample size explicitly. When a completed, print-ready PDF of this exact form also exists on disk, the report embeds that PDF verbatim instead of a re-rendered table.",
    },
    {
      id: "wallThickness",
      title: "Wall Thickness",
      sourceRules: [
        {
          kind: "filenamePattern",
          pattern: /incoming.*ut|ut.*incoming|ds-?0002/i,
          preferFolder: /ndt/i,
          requiredExtensions: [".xlsx"],
        },
      ],
      generation: "table-from-source",
      automationConfidence: "high",
      confidenceNote:
        "UT wall-thickness measurements; pass/fail computed against the printed minimum-limit row. When a completed, print-ready PDF of this exact form also exists on disk, the report embeds that PDF verbatim instead of a re-rendered table — and that PDF is used even if no matching spreadsheet exists at all for this job, rather than showing the section as missing.",
    },
    {
      id: "metallurgicalReport",
      title: "Metallurgical Report",
      sourceRules: [
        {
          kind: "filenamePattern",
          pattern: /met.*report/i,
          requiredExtensions: [".pdf"],
        },
      ],
      generation: "attach-as-is",
      automationConfidence: "high",
      confidenceNote: "Vendor metallurgical evaluation, sent directly from the 3rd party when a sample is selected; attached as-is.",
    },
  ],
};
