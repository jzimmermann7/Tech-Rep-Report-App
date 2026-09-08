import { promises as fs } from "fs";
import sharp from "sharp";
import { getAnthropicClient, VISION_MODEL } from "../anthropic/client";
import type { JobFile } from "../ingest/fileWalk";

export interface PhotoExclusion {
  relativePath: string;
  reason: string;
}

export interface PhotoSelectResult {
  includedPaths: string[];
  excluded: PhotoExclusion[];
  raw: string;
}

const MAX_PHOTOS_PER_CALL = 20;

function mediaTypeFor(ext: string): "image/jpeg" | "image/png" {
  return ext === ".png" ? "image/png" : "image/jpeg";
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Best-effort vision-based screen for exact duplicates / unusable blur within one batch. This is
 * a bonus refinement on top of the real default (include everything) — not a requirement for it.
 * Without an API key, or if the call fails for any other reason, this returns zero exclusions
 * rather than throwing, so photo preselection never depends on AI access being available. */
async function flagExclusionsInBatch(batch: JobFile[]): Promise<{ exclusions: PhotoExclusion[]; raw: string }> {
  try {
    const imageBlocks = await Promise.all(
      batch.map(async (file) => {
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

    const labelList = batch.map((f, i) => `Photo ${i + 1}: ${f.relativePath}`).join("\n");

    const client = getAnthropicClient();
    const response = await client.messages.create({
      model: VISION_MODEL,
      max_tokens: 1024,
      system:
        "You are helping a turbine-parts repair tech rep prepare photos for a customer inspection report. The default is to include every photo — tech reps aren't picky about volume, and having a few extra rarely hurts. Only flag a photo for exclusion if it is an exact or near-duplicate of another photo in this batch (keep the sharpest one, flag the rest) or if it is so blurry/out of focus that the subject can't be made out. Never exclude a photo just for composition, lighting, or relevance.",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Here are ${batch.length} candidate photos, in this order:\n${labelList}\n\nReply with ONLY the photos to exclude, as a numbered list matching "Photo N: duplicate of Photo M" or "Photo N: too blurry to use" — one line per excluded photo. If every photo should be kept, reply with the single word NONE.`,
            },
            ...imageBlocks,
          ],
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    const raw = textBlock && textBlock.type === "text" ? textBlock.text : "";

    const exclusions: PhotoExclusion[] = [];
    if (!/^\s*none\s*$/i.test(raw.trim())) {
      const lineRegex = /photo\s+(\d+)\s*:\s*(.+)/gi;
      let match: RegExpExecArray | null;
      while ((match = lineRegex.exec(raw))) {
        const index = Number(match[1]) - 1;
        if (index >= 0 && index < batch.length) {
          exclusions.push({ relativePath: batch[index].relativePath, reason: match[2].trim() });
        }
      }
    }

    return { exclusions, raw };
  } catch (err) {
    // No API key, rate limit, network error, whatever — the whole point of this batch is an
    // optional refinement, so a failure here just means "keep everything," not "fail the scan."
    const message = err instanceof Error ? err.message : "vision-based screening failed";
    return { exclusions: [], raw: `(skipped duplicate/blur screening: ${message})` };
  }
}

/** Splits a filename into its leading number (if any) and the rest, so "2.jpg" sorts before
 * "10.jpg" — plain string sort would put "10.jpg" first. Falls back to plain string comparison
 * for anything that doesn't start with a number. */
function naturalCompare(a: string, b: string): number {
  const parse = (name: string) => {
    const m = name.match(/^(\d+)/);
    return m ? Number(m[1]) : null;
  };
  const na = parse(a);
  const nb = parse(b);
  if (na !== null && nb !== null && na !== nb) return na - nb;
  return a.localeCompare(b);
}

/** Below this average grayscale value (0-255, sampled on a tiny downscaled copy) a photo is
 * classified as taken under UV/blacklight (FPI indications glowing against a dark background) —
 * above it, as a normal work-light photo. Picked from the actual brightness distribution of a
 * real job's NDT photo set, which fell cleanly into two clusters (roughly 35-65 and 75-125) with
 * this value sitting in the gap between them. Not perfect — a heuristic on pixel brightness, not
 * real image understanding — but there's no vision model available without an API key, and this
 * is a much better default grouping than leaving the two intermixed. */
const UV_BRIGHTNESS_THRESHOLD = 75;

async function isUvLit(absolutePath: string): Promise<boolean> {
  try {
    const { data } = await sharp(absolutePath).resize(32, 32, { fit: "fill" }).grayscale().raw().toBuffer({ resolveWithObject: true });
    const mean = data.reduce((sum, v) => sum + v, 0) / data.length;
    return mean < UV_BRIGHTNESS_THRESHOLD;
  } catch {
    return false; // if it can't be read here, photoToDataUri will surface the real error at render time
  }
}

/** Preselects photos for the I&A (Incoming Inspect-and-Advise) report — Incoming-stage photos
 * (which includes any NDT subfolder nested under "3A Incoming") by default, since those are what
 * an incoming-inspection report actually documents; in-process/final-stage shots belong to a
 * different deliverable and are left out of the preselection, though they're still fully
 * browsable and selectable by hand in the grid. Shipping/receiving photos (the box/crate arriving)
 * are excluded outright — not inspection content. Within what's left, every photo is included by
 * default — tech reps aren't picky about volume, so there's no "pick the best N" judgment call,
 * just a screen for exact/near-duplicates (kept once) and shots too blurry to use. Batched to keep
 * each vision call a reasonable size; duplicate detection only catches matches within the same
 * batch. Falls back to screening the full candidate set if no Incoming-stage photos were found at
 * all, rather than silently preselecting nothing.
 *
 * The final selection is then grouped into two blocks — UV/blacklight FPI shots together, then
 * normal work-light shots together — instead of left in whatever order they were found, since the
 * two lighting conditions read as unrelated photos when intermixed. */
export async function selectBestPhotos(candidates: JobFile[]): Promise<PhotoSelectResult> {
  const stageGroups = groupPhotosByStage(candidates);
  const incoming = stageGroups["incoming"]?.length ? stageGroups["incoming"] : candidates;
  const priorityCandidates = incoming.filter((f) => !/shipping/i.test(f.folderPath));
  const batches = chunk(priorityCandidates, MAX_PHOTOS_PER_CALL);

  const batchResults = await Promise.all(batches.map(flagExclusionsInBatch));

  const excluded = batchResults.flatMap((r) => r.exclusions);
  const raw = batchResults.map((r) => r.raw).join("\n\n");
  const excludedPaths = new Set(excluded.map((e) => e.relativePath));
  const kept = priorityCandidates.filter((f) => !excludedPaths.has(f.relativePath));

  const uvFlags = await Promise.all(kept.map((f) => isUvLit(f.absolutePath)));
  const uvGroup = kept.filter((_, i) => uvFlags[i]).sort((a, b) => naturalCompare(a.baseName, b.baseName));
  const normalGroup = kept.filter((_, i) => !uvFlags[i]).sort((a, b) => naturalCompare(a.baseName, b.baseName));
  const includedPaths = [...uvGroup, ...normalGroup].map((f) => f.relativePath);

  return { includedPaths, excluded, raw };
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
