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
      automationConfidence: "medium",
      confidenceNote:
        "Reliable once drafted after the findings/dimensional sections exist; needs the standard boilerplate lines (seal-strip/root-galling removal, airfoil cleaning) folded in.",
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
      automationConfidence: "medium",
      confidenceNote:
        "High when the router's FPI/visual note resolves to real text; low for any zone the note doesn't cover, since self-derived zone reading from raw findings is the weakest link.",
    },
    {
      id: "dimensionalSummary",
      title: "Dimensional Inspection Summary",
      sourceRules: [],
      dependsOnSections: ["heightDimForm", "dovetailDimension", "wallThickness"],
      generation: "llm-narrative",
      automationConfidence: "high",
      confidenceNote: "Conclusion paragraph + counts derived directly from the computed pass/fail tables.",
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
      confidenceNote: "Standard repair sequence pulled from the Repair Router's resolved operation phrases.",
    },
    {
      id: "chemTest",
      title: "Chem Test",
      sourceRules: [
        {
          kind: "filenamePattern",
          pattern: /chem.*(strip|test).*cert/i,
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
      ],
      generation: "llm-vision-select",
      automationConfidence: "low",
      alwaysReview: true,
      confidenceNote:
        "Pure judgment call and the tech reps' #1 time-sink; not reliably derivable from data alone. Always requires human confirmation.",
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
      automationConfidence: "low",
      alwaysReview: true,
      confidenceNote:
        "High confidence to attach the scanned form as-is; low confidence to use it as a source for categorizing findings, so this prototype only attaches it and never auto-interprets the markings.",
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
        "Tip & angel-wing heights from Form DS-0004. Some jobs keep the real data in a differently-named workbook next to a blank DS-0004 template — both are tried, and a blank match is skipped.",
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
        "Root/dovetail measurements from Form DS-1017. Often a sampled subset of the full population, not every serial number — the draft states the sample size explicitly.",
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
      confidenceNote: "UT wall-thickness measurements; pass/fail computed against the printed minimum-limit row.",
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
