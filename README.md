# Tech Rep Report Builder

Prototype: point this app at an APG job folder, review what it can and can't auto-draft for the I&A Report, edit/regenerate sections, and export the finished PDF.

## Setup

```bash
npm install
cp .env.local.example .env.local   # then fill in ANTHROPIC_API_KEY
npm run dev
```

Open http://localhost:3000. Section drafting (I&A Summary, FPI & Visual Inspection Summary, Dimensional Inspection Summary, Recommended Repairs, Photo Set) calls the Anthropic API and needs `ANTHROPIC_API_KEY` set — everything else (folder scanning, the four dimensional tables, attaching third-party PDFs, PDF export) works without it.

PDF export (`Generate Report`) needs a local Chrome or Edge install (checks the usual Program Files locations) — no download required.

## What's real vs. stubbed

- **I&A Report**: fully implemented, reverse-engineered against a real completed job (APG Job 20443).
- **Final Report**: not implemented yet — `src/lib/report-templates/final-report.ts` is an intentional stub. No completed job with a finished Final Report was available to reverse-engineer its structure from. The rest of the app (ingestion, drafting, review UI, PDF export) is written generically against the `ReportTemplate` shape, so filling this in is additive, not a rewrite.
- **Crack Map**: only attached as-is when a source file is found by filename pattern (`crack*map`). The app never tries to interpret hand-marked findings from it — the source tracker itself rates that as low-confidence automation, and this prototype treats it as always-manual.
- **Photo Set**: Claude vision suggests candidates, but the section is always flagged "review recommended" — click photos in the grid to override the selection before generating.
- **Router-derived sections** (FPI & Visual Inspection Summary, Recommended Repairs): pulled from the job's "Router" `.xlsm` workbooks. Which operations are actually in scope for a given job is determined by reading the router's own prose ("not selected" / "not required" / a label starting with "No ...") rather than its Quantity/cost columns, which are driven by live cross-sheet formulas this app doesn't evaluate.

## Where job-review state lives

Per-job edits, regenerated drafts, and photo selections are saved to `%LOCALAPPDATA%\TechRepReportApp\jobs\<hash>.json` — keyed by the job folder's path, not stored inside the job folder itself, so nothing is written back into the customer's OneDrive folder until you explicitly export the PDF.
