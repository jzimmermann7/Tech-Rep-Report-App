import type { ReportTemplate } from "./types";

// Final Report -- reverse-engineered from a real completed deliverable (Job 18664, Fredrickson
// Power, plus notes from Jonathan on which exhibits are conditional vs. near-universal). Unlike
// the I&A Report, this has no narrative summary sections at all (no I&A Summary, FPI/Visual
// Summary, or Dimensional Summary -- those describe incoming findings, which this deliverable
// doesn't restate) -- just Recommended Repairs (reused from the I&A Report's own section/data,
// since it's the same underlying repair-router/CDS source either way) followed by a run of
// completion-stage re-checks and certifications. Section order here matches the real report's own
// page order as closely as this app's rendering pipeline supports (see renderReportHtml.ts's
// INLINE_ATTACH_SECTIONS): dimensional re-checks and true attach-as-is certifications /
// checklists are genuinely interleaved in the real document, not grouped separately.
//
// Per Jonathan: X-ray & airflow only apply to some jobs (no part-type allowlist, same "just
// missing when absent" pattern as the I&A Report's own Airflow Report); coating cert, shot
// peen/Al seal strip cert, and moment weigh apply to almost every job; heat treat charts and the
// damper pin check are also routine. All of these are genuinely optional at the file-matching
// level regardless -- a job that doesn't have a given exhibit's source file simply doesn't get
// that page, exactly the "conditional logic, not on every report" convention already established
// for the I&A Report's own optional sections.
export const finalReportTemplate: ReportTemplate = {
  reportType: "Final Report",
  sections: [
    {
      id: "cover",
      title: "Title / Cover",
      sourceRules: [{ kind: "jobMetadata" }],
      generation: "template",
      automationConfidence: "high",
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
        "The same repair-router (or Repair CDS, see repairCds.ts) data the I&A Report's own Recommended Repairs section reads -- what was actually done, not a separate re-derivation.",
    },
    {
      id: "finalSerialNumberList",
      title: "Final Ship Serial Number List",
      // Same DS-0554 workbook family as the I&A Report's own Serial Number List, just the
      // as-shipped/final-stage export -- confirmed against Job 18664: "...Final Ship SN List
      // 5-30-26.xlsx" carries the exact same "DS-0554 serial number sheet" tab.
      sourceRules: [
        {
          kind: "filenamePattern",
          pattern: /final.*ship.*sn|ds-?0554.*final/i,
          excludePattern: /no-?ship/i,
          requiredExtensions: [".xlsx"],
        },
      ],
      generation: "table-from-source",
      automationConfidence: "high",
      confidenceNote: "Transcribed directly from Form DS-0554's as-shipped export; the three parallel column blocks are un-pivoted into one table.",
    },
    {
      id: "finalScrapReport",
      title: "Final Scrap SN List",
      // Same workbook as Final Ship Serial Number List above, not a separate file -- its "blade
      // bucket scrap" tab.
      sourceRules: [
        {
          kind: "filenamePattern",
          pattern: /final.*ship.*sn|ds-?0554.*final/i,
          excludePattern: /no-?ship/i,
          requiredExtensions: [".xlsx"],
        },
      ],
      generation: "table-from-source",
      automationConfidence: "high",
      confidenceNote:
        "Reads the final-stage workbook's own \"scrap\" tab -- which buckets ended up scrapped by the time of shipment, not just flagged during incoming review. Left out of the generated report entirely when nothing was recorded, same reasoning as the I&A Report's own Scrap Report.",
    },
    {
      id: "preWeldHeatTreatChart",
      title: "Pre-Weld Heat Treat Chart",
      sourceRules: [{ kind: "filenamePattern", pattern: /pre.?weld/i, requiredExtensions: [".pdf"] }],
      generation: "attach-as-is",
      automationConfidence: "high",
      confidenceNote: "Furnace temperature/time trend chart from the pre-weld heat treat run, attached as-is.",
    },
    {
      id: "postWeldHeatTreatChart",
      title: "Post-Weld Heat Treat Chart",
      sourceRules: [{ kind: "filenamePattern", pattern: /post.?weld/i, requiredExtensions: [".pdf"] }],
      generation: "attach-as-is",
      automationConfidence: "high",
      confidenceNote: "Furnace temperature/time trend chart from the post-weld heat treat run, attached as-is.",
    },
    {
      id: "xRayInspection",
      title: "X-Ray Inspection",
      sourceRules: [{ kind: "filenamePattern", pattern: /x.?ray/i, requiredExtensions: [".pdf"] }],
      generation: "attach-as-is",
      automationConfidence: "high",
      confidenceNote: "Per Jonathan, only some jobs get X-ray -- no part-type allowlist, just missing when there's no X-ray file for this job. Attached as-is.",
    },
    {
      // Named "Final NDT.pdf" per a tech rep, no real completed report to reverse-engineer an
      // exact page position from (unlike most of this template's other sections) -- placed here,
      // grouped with X-Ray Inspection, since both are NDT-type re-checks; move it if it turns out
      // to print somewhere else on the real form.
      id: "finalNdt",
      title: "Final NDT",
      sourceRules: [{ kind: "filenamePattern", pattern: /final.*ndt|ndt.*final/i, requiredExtensions: [".pdf"] }],
      generation: "attach-as-is",
      automationConfidence: "high",
      confidenceNote: "Post-repair NDT re-check results, attached as-is.",
    },
    {
      id: "finalWallThickness",
      title: "Final Wall Thickness Dimensions",
      // Same real form as the I&A Report's own Wall Thickness (confirmed against Job 18664:
      // "Final UT.xlsx" is the same "DS-0007 FA R1 wall thickness" sheet layout), just the
      // post-repair measurement instead of incoming.
      sourceRules: [{ kind: "filenamePattern", pattern: /final.*ut|ut.*final/i, preferFolder: /ndt/i, requiredExtensions: [".xlsx"] }],
      generation: "table-from-source",
      automationConfidence: "high",
      confidenceNote:
        "UT wall-thickness re-check after repair; pass/fail computed against the printed minimum-limit row, same parser as the I&A Report's own Wall Thickness section. When a completed, print-ready PDF also exists on disk, the report embeds that PDF verbatim instead of a re-rendered table.",
    },
    {
      // Named "Z Notch Dimensions.pdf" / "Bucket Dimensions.pdf" per a tech rep -- attach-as-is,
      // not a parsed table, since no sample file was available to reverse-engineer a column
      // layout from. Grouped with the other dimensional re-checks; see finalNdt's own comment on
      // page-position uncertainty.
      id: "zNotchDimensions",
      title: "Z Notch Dimensions",
      sourceRules: [{ kind: "filenamePattern", pattern: /z[\s-]?notch.*dimension/i, requiredExtensions: [".pdf"] }],
      generation: "attach-as-is",
      automationConfidence: "high",
      confidenceNote: "Z-notch dimensional re-check results, attached as-is.",
    },
    {
      id: "postCoatHeatTreatChart",
      title: "Post-HVOF Coat Diffusion Heat Treat Chart",
      sourceRules: [{ kind: "filenamePattern", pattern: /post.?coat/i, requiredExtensions: [".pdf"] }],
      generation: "attach-as-is",
      automationConfidence: "high",
      confidenceNote: "Furnace temperature/time trend chart from the post-coat diffusion heat treat run, attached as-is.",
    },
    {
      id: "finalAgeHeatTreatChart",
      title: "Post-TBC Coat Diffusion + Final Age Heat Treat Chart",
      sourceRules: [{ kind: "filenamePattern", pattern: /\bage\b/i, requiredExtensions: [".pdf"] }],
      generation: "attach-as-is",
      automationConfidence: "high",
      confidenceNote: "Furnace temperature/time trend chart from the final age heat treat run, attached as-is.",
    },
    {
      id: "coatingCertification",
      title: "APG Coating Certification",
      sourceRules: [{ kind: "filenamePattern", pattern: /coating.*cert/i, requiredExtensions: [".pdf"] }],
      generation: "attach-as-is",
      automationConfidence: "high",
      confidenceNote: "Per Jonathan, applies to almost every job. Signed certification of the coating process applied, attached as-is.",
    },
    {
      id: "finalHeightDimForm",
      title: "Final Height Dimensions",
      // Same real form as the I&A Report's own Height Dim Form -- confirmed against Job 18664:
      // "...heights FINAL.xlsx" uses the exact same APG#-anchored layout, just under a "DS-0006"
      // sheet name instead of "DS-0004"/"1st stg heights" -- found by parseHeightDimForm's
      // content-based fallback strategy regardless of sheet name, no changes needed there.
      sourceRules: [{ kind: "filenamePattern", pattern: /heights?.*final|final.*heights?/i, requiredExtensions: [".xlsx"] }],
      generation: "table-from-source",
      automationConfidence: "high",
      confidenceNote:
        "Tip & angel-wing heights re-check after repair, same parser as the I&A Report's own Height Dim Form. When a completed, print-ready PDF also exists on disk, the report embeds that PDF verbatim instead of a re-rendered table.",
    },
    {
      id: "finalAirflowReport",
      title: "Final Air Flow",
      sourceRules: [{ kind: "filenamePattern", pattern: /total.*flow|airflow/i, requiredExtensions: [".xlsx"] }],
      generation: "table-from-source",
      automationConfidence: "high",
      confidenceNote:
        "Per Jonathan, only some jobs get airflow -- no part-type allowlist, just missing when there's no airflow file for this job (same convention as the I&A Report's own Airflow Report, which this reuses the parser from). When a completed, print-ready PDF also exists on disk, the report embeds that PDF verbatim instead of a re-rendered table.",
    },
    {
      id: "shotPeenAlSealStripCert",
      title: "APG Shot Peen & Al Seal Strip Certification",
      sourceRules: [{ kind: "filenamePattern", pattern: /shot.?peen/i, requiredExtensions: [".pdf"] }],
      generation: "attach-as-is",
      automationConfidence: "high",
      confidenceNote: "Per Jonathan, applies to almost every job. Attached as-is.",
    },
    {
      id: "damperPinCheck",
      title: "Damper Pin Rock Check",
      sourceRules: [{ kind: "filenamePattern", pattern: /damper.*pin/i, requiredExtensions: [".pdf"] }],
      generation: "attach-as-is",
      automationConfidence: "high",
      confidenceNote: "Per Jonathan, a routine check. Attached as-is.",
    },
    {
      id: "finalPhotoSet",
      title: "Final Photos",
      // Same folder convention as the I&A Report's own Photo Set -- just prefers the "3C Final"
      // stage grouping instead of "3A Incoming" (see photoSelect.ts's selectBestPhotos
      // preferredStage param).
      sourceRules: [{ kind: "folderPattern", pattern: /pictures/i, fileExtensions: [".jpg", ".jpeg", ".png"] }],
      generation: "llm-vision-select",
      automationConfidence: "medium",
      alwaysReview: true,
      confidenceNote:
        "Preselects Final-stage photos automatically, same screening as the I&A Report's own Photo Set (duplicates/blur screened out, indication/marking shots sorted first) but preferring the \"3C Final\" folder instead of \"3A Incoming\". Still flagged for human confirmation since it's an image-judgment call.",
    },
    {
      id: "finalMomentWeigh",
      title: "Final Moment Weigh",
      sourceRules: [{ kind: "filenamePattern", pattern: /moment.*weigh/i, requiredExtensions: [".pdf"] }],
      generation: "attach-as-is",
      automationConfidence: "high",
      confidenceNote: "Per Jonathan, applies to almost every job. Raw balance-machine output, attached as-is.",
    },
  ],
};
