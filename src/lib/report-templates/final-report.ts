import type { ReportTemplate } from "./types";

// Stub. No completed job with a finished Final Report deliverable has been
// reverse-engineered yet (Job 20443, our ground-truth job, never reached this
// phase). Fill this in with real sections once such a job is available —
// the rest of the app (ingestion, drafting, review UI, PDF export) is
// written generically against `ReportTemplate` and needs no changes to
// support a populated version of this config.
export const finalReportTemplate: ReportTemplate = {
  reportType: "Final Report",
  sections: [],
};
