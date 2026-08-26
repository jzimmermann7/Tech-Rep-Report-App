import { NextRequest, NextResponse } from "next/server";
import { generateReportPdf } from "@/lib/pdf/generateReport";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const jobRoot: string | undefined = body.jobRoot;
  if (!jobRoot) return NextResponse.json({ error: "jobRoot is required" }, { status: 400 });

  try {
    const { buffer, skippedAttachments } = await generateReportPdf(jobRoot);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="report.pdf"',
        "X-Skipped-Attachments": encodeURIComponent(JSON.stringify(skippedAttachments)),
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "PDF generation failed" }, { status: 500 });
  }
}
