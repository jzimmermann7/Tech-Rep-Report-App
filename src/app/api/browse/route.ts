import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import os from "os";

export async function GET(request: NextRequest) {
  const dirParam = request.nextUrl.searchParams.get("dir");
  const dir = dirParam || path.join(os.homedir(), "OneDrive - Allied Power Group", "Strategy - Files");

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const names = await Promise.all(
      entries.map(async (e) => {
        if (e.name.startsWith(".")) return null;
        if (e.isDirectory()) return e.name;
        // Some network/cloud-synced drives (OneDrive placeholders especially) report a real
        // subfolder's dirent as a symlink rather than a directory, so e.isDirectory() alone
        // silently drops it from the picker -- fall back to a real stat() (which follows the
        // reparse point to what it actually is) before ruling it out.
        if (e.isFile()) return null;
        try {
          const stat = await fs.stat(path.join(dir, e.name));
          return stat.isDirectory() ? e.name : null;
        } catch {
          return null; // broken link, permission error, etc.
        }
      })
    );
    const folders = names.filter((n): n is string => n !== null).sort((a, b) => a.localeCompare(b));
    return NextResponse.json({ dir, parent: path.dirname(dir), folders });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not read directory" }, { status: 400 });
  }
}
