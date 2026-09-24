import type { ReportTemplate } from "./types";

// Section order, source rules, and generation strategy for the I&A Report.
// Reverse-engineered from a real completed job (APG Job 20443) plus the
// company's own "TR Summary" tracker tab (Claudability ratings carried over
// into `automationConfidence` / `confidenceNote`).
//
// This array's order is also the sidebar's order (scanJobFolder.ts preserves it verbatim into
// JobScanResult.sections) -- kept matching the actual generated PDF's own section order rather
// than an independent ordering, so paging down the review sidebar lines up with paging through
// the final report. The attach-as-is exhibits (Metallurgical Report, Chem Test, Crack Map) are
// last in both because generateReport.ts's ATTACH_AS_IS_ORDER appends them verbatim at the very
// end of the assembled PDF, after every other section's content.
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
        "Built directly from the router data — no AI call at all, so it never depends on an API key. Procedure/form numbers are pulled straight out of the router's own note text. The router's FPI note is procedural (what to inspect), never the actual zone-by-zone findings — those live only in the crack map, so the draft never tries to derive them: it defers to the crack map as its own exhibit when one's found, and explicitly states when findings aren't available rather than inventing them. Still drafts a scope + Crack-Map-pointer skeleton from job metadata alone when no router file is found, rather than leaving this section fully blank — just without the procedure/form-number clause, which is called out for the tech rep to fill in.",
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
        {
          // Some customers' jobs have no repair-router file at all -- a "Repair CDS" reference
          // workbook stands in instead (see repairCds.ts), confirmed against Job 20436 ("Repair
          // CDS.xlsm") and Job 20668, a different customer unit/contract ("CDS Repair.xlsm" --
          // word order isn't consistent).
          kind: "filenamePattern",
          pattern: /repair\s*cds|cds\s*repair/i,
          requiredExtensions: [".xlsm", ".xlsx"],
        },
      ],
      generation: "llm-narrative",
      automationConfidence: "high",
      confidenceNote:
        "Built directly from the router's own active step labels — no AI call, so no API key dependency; the earlier concern that this needed AI (and so couldn't run without sending the router to a model) no longer applies, since it's now pure code reading the file. Confirmed against a real completed report that APG's own convention is exactly this — the router's step labels in sequence, repeats and all — with only the \"(Opt)\" suffix and a handful of internal admin checkpoints (Foreman/Quality Review, QC hold point, Consumables) dropped. When no router file exists at all, a \"Repair CDS\" reference workbook is tried instead (see repairCds.ts) -- its own step labels are terser than a router's and haven't been polished into the fuller customer-facing wording a hand-written report might use, so expect to revise this one more than a router-sourced draft.",
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
      id: "scrapReport",
      title: "Scrap Report",
      // Same workbook as Serial Number List, not a separate file -- this reads its "blade bucket
      // scrap" tab instead of the main serial number sheet.
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
      confidenceNote:
        "Reads the Serial Number List workbook's own \"scrap\" tab, not a separate file. A tech rep's usual workflow is to review indications/photos, physically verify the part, then update this tab once scrap is actually determined -- so this genuinely starts out blank for a job and fills in as review happens; a blank result here means \"nothing scrapped (yet)\" and is left out of the generated report, not treated as missing data. Rescan after updating the workbook to pick up a new determination.",
    },
    {
      id: "snRecordingSheet",
      title: "Serial Number Recording Sheet",
      // Same workbook as Serial Number List again -- its "DS-0404 SN Recording Sheet" tab.
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
      confidenceNote:
        "Reads the Serial Number List workbook's own \"DS-0404 SN Recording Sheet\" tab: prior APG job number(s) a bucket was repaired under before, other vendor/repair-shop markings found on the part, and freeform comments. Only whichever of those a job actually used shows up as its own column -- a job that only ever records prior job numbers doesn't get blank Other-Numbers/Comments columns. Left out of the generated report entirely when nothing was recorded, same reasoning as Scrap Report.",
    },
    {
      id: "heightDimForm",
      title: "Height Dim Form",
      sourceRules: [
        {
          // "heights...incoming" (1st stage) or "height form...incoming" (2nd/3rd stage,
          // confirmed against Job 20436's "...height form tall buckets Incoming.xlsx" -- no "s"
          // on "height" at all, so the 1st-stage-only pattern this used to be missed it outright).
          kind: "filenamePattern",
          pattern: /heights?.*incoming/i,
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
        "Tip & angel-wing heights -- Form DS-0004 for 1st-stage buckets; 2nd/3rd stage use a differently-laid-out form under a job-specific name with no shared form number, read by a separate strategy that shows raw measurements without automatic pass/fail (that form mixes more than one tolerance convention across its own columns). Some jobs keep the real data in a differently-named workbook next to a blank template — both are tried, and a blank match is skipped. When a completed, print-ready PDF of this exact form also exists on disk, the report embeds that PDF verbatim instead of a re-rendered table, so its diagrams and formatting come through intact — the spreadsheet is still what this review screen shows and what other sections' narratives draw from.",
    },
    {
      id: "dovetailDimension",
      title: "Dovetail Dimension Inspection",
      sourceRules: [
        {
          kind: "filenamePattern",
          pattern: /dovetail.*incoming/i,
          requiredExtensions: [".xlsx"],
        },
        {
          // Form number varies by bucket stage -- DS-1017 for 1st stage, DS-0460 ("Stage 2 and
          // 3 Bucket Dovetail Inspection Data Sheet") for 2nd/3rd -- confirmed both use the same
          // internal layout (see dovetailDimension.ts), so one section covers all of them.
          kind: "filenamePattern",
          pattern: /ds-?1017|ds-?0460/i,
          excludePattern: /in.?process|final/i,
          requiredExtensions: [".xlsx"],
        },
      ],
      generation: "table-from-source",
      automationConfidence: "high",
      confidenceNote:
        "Root/dovetail measurements -- Form DS-1017 for 1st-stage buckets, DS-0460 for 2nd/3rd stage (same layout, different form number). Often a sampled subset of the full population, not every serial number — the draft states the sample size explicitly. When a completed, print-ready PDF of this exact form also exists on disk, the report embeds that PDF verbatim instead of a re-rendered table.",
    },
    {
      id: "zDropDimension",
      title: "Z-Drop Dimensions",
      sourceRules: [
        {
          // "Z drop"/"Z notch" (2nd stage) or just "Z dimensions" (3rd stage, confirmed against
          // Job 20436 -- same form, filename just doesn't say drop/notch at all).
          kind: "filenamePattern",
          pattern: /z[\s_-]?(drop|notch|dimensions?).*incoming/i,
          requiredExtensions: [".xlsx"],
        },
        {
          kind: "filenamePattern",
          pattern: /ds-?0459/i,
          excludePattern: /in.?process|final/i,
          requiredExtensions: [".xlsx"],
        },
      ],
      generation: "table-from-source",
      automationConfidence: "high",
      confidenceNote:
        "Form DS-0459 -- a dimensional check specific to 2nd/3rd stage buckets with no 1st-stage equivalent, so a 1st-stage job correctly shows this as missing, the same as Airflow Report shows missing for a job it doesn't apply to -- no part-type allowlist, just \"no such file for this job.\" CVZ and CCZ are the two raw Z-height measurements per bucket; \"Z to Z\" is their difference, the dimension actually being checked. Unlike the other dimensional forms, this one doesn't compute pass/fail automatically -- tried it against this form's own printed target on a real completed job and it disagreed with that job's own signed-off conclusion, so it shows the raw numbers and the printed target and leaves the call to the tech rep. When a completed, print-ready PDF of this exact form also exists on disk, the report embeds that PDF verbatim instead of a re-rendered table.",
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
      id: "airflowReport",
      title: "Airflow Report",
      sourceRules: [
        {
          kind: "filenamePattern",
          pattern: /airflow/i,
          requiredExtensions: [".xlsx"],
        },
      ],
      generation: "table-from-source",
      automationConfidence: "high",
      confidenceNote:
        "Routinely produced for 7FA and 501F 1st-stage buckets and 501F 2nd-stage buckets, and sometimes for other airfoil parts on customer request -- so most jobs simply won't have this file at all, which is exactly how this section stays off a report it doesn't apply to: no part-type allowlist, just \"missing\" like any other optional exhibit when there's nothing to show. When a completed, print-ready PDF of this exact workbook also exists on disk, the report embeds that PDF verbatim instead of a re-rendered table (the review screen still shows the parsed readings).",
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
      confidenceNote:
        "Vendor metallurgical evaluation, sent directly from the 3rd party when a sample is selected; attached as-is. If no filename matches, a fallback vision check looks at what PDFs/images in the job folder actually contain before giving up — useful for a shop-scanned copy saved under a generic name — but any match found that way is always flagged for confirmation, never trusted outright the way a filename match is.",
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
      confidenceNote:
        "Sent directly from the 3rd-party vendor; attached as-is, no drafting needed. If no filename matches, a fallback vision check looks at what PDFs/images in the job folder actually contain before giving up — useful for a shop-scanned copy saved under a generic name — but any match found that way is always flagged for confirmation, never trusted outright the way a filename match is.",
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
        "Same mechanism as Chem Test / Metallurgical Report: found by filename pattern and attached as-is, no drafting. Still flagged for human confirmation since this prototype never auto-interprets the markings — that's on the tech rep. If no filename matches (a real, common case: crack maps are often hand-marked and scanned under a generic name like the scanner's own default), a fallback vision check looks at candidate PDFs/images by their actual content instead — it can recognize a hand-marked bucket diagram even with zero machine-readable text, unlike a filename or OCR search. That match is still just a starting point for the tech rep to confirm, never auto-accepted.",
    },
  ],
};
