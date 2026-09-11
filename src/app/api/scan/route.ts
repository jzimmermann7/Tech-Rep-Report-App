import { NextRequest, NextResponse } from "next/server";
import { scanJobFolder } from "@/lib/ingest/scanJobFolder";
import { resolveReportTemplate } from "@/lib/report-templates";
import { loadJobState } from "@/lib/state/jobState";
import { autoDraftJob } from "@/lib/draft/autoDraft";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const jobRoot: string | undefined = body.jobRoot;
  if (!jobRoot) return NextResponse.json({ error: "jobRoot is required" }, { status: 400 });

  try {
    const scanResult = await scanJobFolder(jobRoot, resolveReportTemplate(body.reportType));
    // Best-effort: builds the initial draft for every AI-assisted section right here, so the
    // tech rep lands on a completed draft to review rather than a page of "Generate" buttons.
    // Never throws — per-section failures are recorded as `draftError` on that section alone.
    await autoDraftJob(scanResult);
    const state = await loadJobState(jobRoot);

    const sections = scanResult.sections.map((section) => {
      const sectionState = state.sections[section.id] ?? {};
      // Every narrative section (I&A Summary, FPI/Visual, ...) still drafts a best-effort partial
      // from whatever job metadata is on hand even when its usual source data wasn't found (see
      // autoDraftJob's own comments) -- so "missing" here would be actively misleading once that
      // draft has real text in it: the tech rep would see a fully-written section right there in
      // the panel while the sidebar insists there's nothing to look at. Reporting "missing" is
      // only honest when the panel is genuinely empty too; once a draft exists, "needs attention"
      // is the true state -- something was written, but from thinner source data than usual, so it
      // needs a closer read than a normal "ready" section would.
      const hasDraftedContent = section.generation === "llm-narrative" && Boolean(sectionState.content?.trim());
      const status = section.status === "missing" && hasDraftedContent ? "needs-attention" : section.status;
      const statusReason =
        status !== section.status
          ? `${section.statusReason} A draft was still generated from the available job metadata — review it carefully, since the usual source data wasn't found.`
          : section.statusReason;
      return { ...section, status, statusReason, state: sectionState };
    });

    return NextResponse.json({ ...scanResult, sections });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Scan failed" }, { status: 500 });
  }
}
