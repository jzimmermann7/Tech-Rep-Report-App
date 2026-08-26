import { NextRequest, NextResponse } from "next/server";
import { scanJobFolder } from "@/lib/ingest/scanJobFolder";
import { iaReportTemplate } from "@/lib/report-templates/ia-report";
import { updateSectionState, loadJobState } from "@/lib/state/jobState";
import { draftFpiVisual, draftRecommendedRepairs, draftDimensionalSummary, draftIaSummary } from "@/lib/draft/narrative";
import { selectBestPhotos } from "@/lib/draft/photoSelect";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { jobRoot, sectionId, instruction } = body as { jobRoot: string; sectionId: string; instruction?: string };
  if (!jobRoot || !sectionId) return NextResponse.json({ error: "jobRoot and sectionId are required" }, { status: 400 });

  try {
    const scanResult = await scanJobFolder(jobRoot, iaReportTemplate);
    const bySectionId = new Map(scanResult.sections.map((s) => [s.id, s]));
    const section = bySectionId.get(sectionId);
    if (!section) return NextResponse.json({ error: `Unknown section ${sectionId}` }, { status: 404 });

    const jobState = await loadJobState(jobRoot);
    const previousDraft = jobState.sections[sectionId]?.content;
    const ctx = { metadata: scanResult.metadata, instruction, previousDraft };

    let content: string | undefined;
    let selectedPhotoPaths: string[] | undefined;

    switch (sectionId) {
      case "fpiVisual": {
        if (!section.parsedRouter) return NextResponse.json({ error: "No router data available" }, { status: 400 });
        const crackMapAvailable = bySectionId.get("crackMap")?.status !== "missing";
        content = await draftFpiVisual(section.parsedRouter, ctx, crackMapAvailable);
        break;
      }
      case "recommendedRepairs": {
        if (!section.parsedRouter) return NextResponse.json({ error: "No router data available" }, { status: 400 });
        content = await draftRecommendedRepairs(section.parsedRouter, ctx);
        break;
      }
      case "dimensionalSummary": {
        content = await draftDimensionalSummary(
          {
            heightDimForm: bySectionId.get("heightDimForm")?.parsedTable,
            dovetailDimension: bySectionId.get("dovetailDimension")?.parsedTable,
            wallThickness: bySectionId.get("wallThickness")?.parsedTable,
          },
          ctx
        );
        break;
      }
      case "iaSummary": {
        const depIds = section.dependsOnSections ?? [];
        const depDrafts: Record<string, string> = {};
        for (const depId of depIds) {
          const depContent = jobState.sections[depId]?.content;
          if (depContent) depDrafts[depId] = depContent;
        }
        content = await draftIaSummary(depDrafts, ctx);
        break;
      }
      case "photoSet": {
        const result = await selectBestPhotos(section.matchedFiles);
        content = result.raw;
        selectedPhotoPaths = result.selections.map((s) => s.relativePath);
        break;
      }
      default:
        return NextResponse.json({ error: `Section ${sectionId} does not support drafting` }, { status: 400 });
    }

    const newState = await updateSectionState(jobRoot, sectionId, {
      content,
      selectedPhotoPaths,
      lastGeneratedAt: new Date().toISOString(),
    });

    return NextResponse.json({ content, selectedPhotoPaths, state: newState.sections[sectionId] });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Draft generation failed" }, { status: 500 });
  }
}
