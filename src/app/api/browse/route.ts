import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import os from "os";

export async function GET(request: NextRequest) {
  const dirParam = request.nextUrl.searchParams.get("dir");
  const dir = dirParam || path.join(os.homedir(), "OneDrive - Allied Power Group", "Strategy - Files");

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const folders = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));
    return NextResponse.json({ dir, parent: path.dirname(dir), folders });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not read directory" }, { status: 400 });
  }
}
