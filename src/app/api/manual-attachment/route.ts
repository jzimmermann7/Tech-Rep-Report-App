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
  // One or more files -- a tech rep attaching, say, a multi-page cert that was scanned as
  // separate files, or just several candidates to compare at once, shouldn't need a separate
  // round trip per file.
  const files = form.getAll("file").filter((f): f is File => f instanceof File);

  if (typeof jobRoot !== "string" || !jobRoot) return NextResponse.json({ error: "jobRoot is required" }, { status: 400 });
  if (typeof sectionId !== "string" || !sectionId || !SAFE_SEGMENT.test(sectionId) || sectionId.startsWith(".")) {
    return NextResponse.json({ error: "Invalid sectionId" }, { status: 400 });
  }
  if (files.length === 0) return NextResponse.json({ error: "At least one file is required" }, { status: 400 });

  // Original filename, but stripped of anything but a plain base name -- e.g. a browser handing
  // us a full path from a drag-drop, or someone crafting a traversal attempt, both collapse to
  // just the last segment before this check runs.
  const safeNames: string[] = [];
  for (const file of files) {
    const safeName = path.basename(file.name).trim();
    if (!safeName || !SAFE_SEGMENT.test(safeName) || safeName.startsWith(".")) {
      return NextResponse.json({ error: `Invalid file name: "${file.name}"` }, { status: 400 });
    }
    safeNames.push(safeName);
  }

  const destDir = path.join(jobRoot, MANUAL_ATTACHMENTS_DIR, sectionId);
  const resolvedDir = path.resolve(destDir);
  const resolvedRoot = path.resolve(jobRoot);
  if (!resolvedDir.startsWith(resolvedRoot + path.sep)) {
    return NextResponse.json({ error: "Resolved path escapes the job folder" }, { status: 400 });
  }

  try {
    // A fresh upload replaces whatever was manually attached here before, rather than piling up
    // alongside it -- a tech rep swapping in the right file after realizing an earlier manual
    // attachment was wrong expects the old one gone, not still sitting in the candidate list.
    // Clearing out the directory's own *files* first, rather than fs.rm-ing the directory itself
    // recursively, deliberately avoids an rmdir call entirely -- confirmed against this app's own
    // real T:\ network share that removing (not just reading/writing into) a directory there can
    // fail with a flat EPERM even when nothing else holds it open, the same class of flakiness the
    // PDF generator's own readFileWithRetry already works around for reads. Deleting each file
    // individually and leaving the (now-empty) directory in place sidesteps that path completely.
    await fs.mkdir(destDir, { recursive: true });
    const existing = await fs.readdir(destDir).catch(() => [] as string[]);
    await Promise.all(existing.map((name) => fs.unlink(path.join(destDir, name)).catch(() => {})));
    const relativePaths: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const bytes = Buffer.from(await files[i].arrayBuffer());
      await fs.writeFile(path.join(destDir, safeNames[i]), bytes);
      relativePaths.push(`${MANUAL_ATTACHMENTS_DIR}/${sectionId}/${safeNames[i]}`);
    }
    return NextResponse.json({ relativePaths });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to save file(s)" }, { status: 500 });
  }
}
