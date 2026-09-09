import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

// Convention shared with scanJobFolder.ts's manualAttachmentsFor(): a manually-attached file
// lives at "<jobRoot>/_Manual Attachments/<sectionId>/<filename>", a real file inside the job
// folder like any other -- so the very next scan picks it up through the normal file walk, with
// no separate storage or job-state field required. Placing it under a section-specific
// subfolder is what associates it with that section (matched by folder path, not filename).
const MANUAL_ATTACHMENTS_DIR = "_Manual Attachments";

// A safe path segment: no separators, no leading dot (rules out "..", ".", and hidden-file
// weirdness). Both the section id (caller-controlled, though only ever one of our own template's
// ids in practice) and the uploaded filename are checked against this before touching the disk.
const SAFE_SEGMENT = /^[^\\/]+$/;

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const jobRoot = form.get("jobRoot");
  const sectionId = form.get("sectionId");
  const file = form.get("file");

  if (typeof jobRoot !== "string" || !jobRoot) return NextResponse.json({ error: "jobRoot is required" }, { status: 400 });
  if (typeof sectionId !== "string" || !sectionId || !SAFE_SEGMENT.test(sectionId) || sectionId.startsWith(".")) {
    return NextResponse.json({ error: "Invalid sectionId" }, { status: 400 });
  }
  if (!(file instanceof File)) return NextResponse.json({ error: "file is required" }, { status: 400 });

  // Original filename, but stripped of anything but a plain base name -- e.g. a browser handing
  // us a full path from a drag-drop, or someone crafting a traversal attempt, both collapse to
  // just the last segment before this check runs.
  const safeName = path.basename(file.name).trim();
  if (!safeName || !SAFE_SEGMENT.test(safeName) || safeName.startsWith(".")) {
    return NextResponse.json({ error: "Invalid file name" }, { status: 400 });
  }

  const destDir = path.join(jobRoot, MANUAL_ATTACHMENTS_DIR, sectionId);
  const resolvedDir = path.resolve(destDir);
  const resolvedRoot = path.resolve(jobRoot);
  if (!resolvedDir.startsWith(resolvedRoot + path.sep)) {
    return NextResponse.json({ error: "Resolved path escapes the job folder" }, { status: 400 });
  }

  try {
    await fs.mkdir(destDir, { recursive: true });
    const bytes = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(path.join(destDir, safeName), bytes);
    return NextResponse.json({ relativePath: `${MANUAL_ATTACHMENTS_DIR}/${sectionId}/${safeName}` });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to save file" }, { status: 500 });
  }
}
