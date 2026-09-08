import { NextRequest, NextResponse } from "next/server";
import { scanJobFolder } from "@/lib/ingest/scanJobFolder";
import { iaReportTemplate } from "@/lib/report-templates/ia-report";
import { loadJobState } from "@/lib/state/jobState";
import { autoDraftJob } from "@/lib/draft/autoDraft";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const jobRoot: string | undefined = body.jobRoot;
  if (!jobRoot) return NextResponse.json({ error: "jobRoot is required" }, { status: 400 });

  try {
    const scanResult = await scanJobFolder(jobRoot, iaReportTemplate);
    // Best-effort: builds the initial draft for every AI-assisted section right here, so the
    // tech rep lands on a completed draft to review rather than a page of "Generate" buttons.
    // Never throws — per-section failures are recorded as `draftError` on that section alone.
    await autoDraftJob(scanResult);
    const state = await loadJobState(jobRoot);

    const sections = scanResult.sections.map((section) => ({
      ...section,
      state: state.sections[section.id] ?? {},
    }));

    return NextResponse.json({ ...scanResult, sections });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Scan failed" }, { status: 500 });
  }
}
