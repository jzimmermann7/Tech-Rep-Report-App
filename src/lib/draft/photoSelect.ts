import { promises as fs } from "fs";
import { getAnthropicClient, VISION_MODEL } from "../anthropic/client";
import type { JobFile } from "../ingest/fileWalk";

export interface PhotoSelection {
  relativePath: string;
  rationale: string;
}

export interface PhotoSelectResult {
  selections: PhotoSelection[];
  raw: string;
}

const MAX_PHOTOS_PER_CALL = 20;

function mediaTypeFor(ext: string): "image/jpeg" | "image/png" {
  return ext === ".png" ? "image/png" : "image/jpeg";
}

/** Selects the best representative photos from a candidate set. Given the tracker's own note
 * that this is the weakest-automated section, this always returns with the expectation the UI
 * marks it "review recommended" regardless of the result. Only a bounded sample of candidates
 * is sent per call to keep requests a reasonable size; for large photo sets, call this per
 * sub-folder (Incoming/In-process/Final) rather than across the whole set at once. */
export async function selectBestPhotos(candidates: JobFile[], targetCount = 6): Promise<PhotoSelectResult> {
  const sample = candidates.slice(0, MAX_PHOTOS_PER_CALL);
  const imageBlocks = await Promise.all(
    sample.map(async (file) => {
      const buffer = await fs.readFile(file.absolutePath);
      return {
        type: "image" as const,
        source: {
          type: "base64" as const,
          media_type: mediaTypeFor(file.ext),
          data: buffer.toString("base64"),
        },
      };
    })
  );

  const labelList = sample.map((f, i) => `Photo ${i + 1}: ${f.relativePath}`).join("\n");

  const client = getAnthropicClient();
  const response = await client.messages.create({
    model: VISION_MODEL,
    max_tokens: 1024,
    system:
      "You are helping a turbine-parts repair tech rep pick the best photos to include in a customer inspection report. Prefer clear, well-lit, in-focus photos that show the actual condition/findings, and avoid near-duplicates.",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Here are ${sample.length} candidate photos, in this order:\n${labelList}\n\nPick up to ${targetCount} of the best, most representative photos. Reply as a numbered list matching "Photo N: <one-sentence rationale>" — one line per photo you select, nothing else.`,
          },
          ...imageBlocks,
        ],
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const raw = textBlock && textBlock.type === "text" ? textBlock.text : "";

  const selections: PhotoSelection[] = [];
  const lineRegex = /photo\s+(\d+)\s*:\s*(.+)/gi;
  let match: RegExpExecArray | null;
  while ((match = lineRegex.exec(raw))) {
    const index = Number(match[1]) - 1;
    if (index >= 0 && index < sample.length) {
      selections.push({ relativePath: sample[index].relativePath, rationale: match[2].trim() });
    }
  }

  return { selections, raw };
}

export function groupPhotosByStage(files: JobFile[]): Record<string, JobFile[]> {
  const groups: Record<string, JobFile[]> = {};
  for (const file of files) {
    const stageMatch = file.folderPath.match(/3[a-c]\s+(incoming|in-process|final)/i);
    const stage = stageMatch ? stageMatch[1].toLowerCase() : "other";
    (groups[stage] ??= []).push(file);
  }
  return groups;
}
