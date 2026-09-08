"use client";

import { useEffect, useState } from "react";
import type { JobScanResult, SectionScanResult } from "@/lib/ingest/scanJobFolder";
import { COVER_FIELD_ORDER } from "@/lib/ingest/jobMetadata";
import type { SectionState } from "@/lib/state/jobState";

type SectionWithState = SectionScanResult & { state: SectionState };
type ScanResponse = Omit<JobScanResult, "sections"> & { sections: SectionWithState[] };

function StatusBadge({ status, acknowledged }: { status: string; acknowledged?: boolean }) {
  // "ready" means the data/draft is there, not that a person has looked at it — don't let that
  // read as done until the tech rep actually clicks "Tech Rep Reviewed".
  const label = status === "ready" ? (acknowledged ? "Ready" : "Ready for Review") : status.replace("-", " ");
  return <span className={`status-badge ${status}`}>{label}</span>;
}

function FolderIcon() {
  // A clean minimal folder glyph in the brand navy (currentColor), replacing the 📁 emoji --
  // renders identically everywhere instead of varying by OS/browser emoji font.
  return (
    <svg className="folder-icon" viewBox="0 0 20 16" width="16" height="16" fill="none" aria-hidden="true">
      <path
        d="M1 3a1 1 0 0 1 1-1h4.5l1.5 1.8H18a1 1 0 0 1 1 1V13a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V3Z"
        fill="currentColor"
        opacity="0.9"
      />
    </svg>
  );
}

function FolderPicker({ onJobFolderChosen }: { onJobFolderChosen: (path: string) => void }) {
  const [dir, setDir] = useState<string | null>(null);
  const [folders, setFolders] = useState<string[]>([]);
  const [parent, setParent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async (target?: string) => {
    setLoading(true);
    try {
      const url = target ? `/api/browse?dir=${encodeURIComponent(target)}` : "/api/browse";
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error);
        return;
      }
      setError(null);
      setDir(data.dir);
      setParent(data.parent);
      setFolders(data.folders);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Fetch-on-mount: `load` intentionally omitted from deps (stable enough for this one-shot
    // initial listing) and its setState calls happen after an await, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  return (
    <div className="folder-picker">
      <div className="app-logo">
        <img src="/apg-mark-transparent.png" alt="" className="app-logo-icon" />
        <h1>Report Builder</h1>
      </div>
      <div className="app-logo-bar" />
      <p className="folder-picker-subtitle">Pick the job folder to scan.</p>
      <div className="folder-picker-card">
        <p className="job-path">{dir}</p>
        {error && (
          <p className="folder-picker-error" style={{ color: "#a4141a" }}>
            {error}
          </p>
        )}
        <div className="toolbar">
          <button className="secondary" disabled={!parent} onClick={() => parent && load(parent)}>
            Up one level
          </button>
          {dir && <button onClick={() => onJobFolderChosen(dir)}>Use this folder</button>}
        </div>
        {loading ? (
          <div className="folder-list-loading">Loading…</div>
        ) : folders.length === 0 ? (
          <div className="folder-list-empty">No subfolders here.</div>
        ) : (
          <div className="folder-list folder-list-enter" key={dir ?? "root"}>
            {folders.map((f) => (
              <button key={f} onClick={() => load(dir ? `${dir}\\${f}` : f)}>
                <FolderIcon /> {f}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function chunkRows<T>(rows: T[], numChunks: number): T[][] {
  const perChunk = Math.ceil(rows.length / numChunks);
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += perChunk) chunks.push(rows.slice(i, i + perChunk));
  return chunks;
}

function TablePreview({ section }: { section: SectionWithState }) {
  const table = section.parsedTable;
  if (!table) {
    // No data spreadsheet to show as a table, but the completed print-ready PDF was found (see
    // scanJobFolder.ts's PRINT_PDF_SECTIONS) and is what the report actually uses -- the
    // statusReason above this already explains that, so don't also claim there's "no data".
    if (section.printPdfFile) return null;
    return <p className="section-reason">No table data available.</p>;
  }

  // Serial Number List is a long, simple 3-column list (matching the real DS-0554 form, which
  // itself lays it out as three parallel column blocks) -- reflowing it the same way here keeps
  // the on-screen review matching what actually prints, instead of one tall single column.
  const columnBlocks = section.id === "serialNumberList" && table.rows.length > 3 ? 3 : 1;

  const headerCells = table.columns.map((c) => (
    <th key={c} data-col={c}>
      {c}
    </th>
  ));

  return (
    <div style={{ overflowX: "auto" }}>
      <p className="file-count">
        Source: {table.sourceFile} — sheet &quot;{table.sheetName}&quot; — {table.sampleSize} row(s)
        {table.populationSize ? ` of ${table.populationSize}` : ""}
        {typeof table.outOfSpecCount === "number" ? ` — ${table.outOfSpecCount} out of spec` : ""}
      </p>
      {table.notes.map((n, i) => (
        <p key={i} className="confidence-note">
          {n}
        </p>
      ))}
      {table.formHeader && table.formHeader.length > 0 && (
        <div className="form-header-grid">
          {table.formHeader.map(({ label, value }) => (
            <div className="form-header-cell" key={label}>
              <span className="form-header-label">{label}</span> {value}
            </div>
          ))}
        </div>
      )}
      {columnBlocks > 1 ? (
        <div className="table-columns">
          {chunkRows(table.rows, columnBlocks).map((rowsChunk, blockIdx) => (
            <table className="preview-table table-block" key={blockIdx}>
              <thead>
                <tr>{headerCells}</tr>
              </thead>
              <tbody>
                {rowsChunk.map((row, i) => (
                  <tr key={i}>
                    {table.columns.map((c) => (
                      <td key={c} data-col={c} className={row[c]?.includes("OUT OF SPEC") ? "fail" : ""}>
                        {row[c]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </div>
      ) : (
        <table className="preview-table">
          <thead>
            <tr>{headerCells}</tr>
          </thead>
          <tbody>
            {table.rows.map((row, i) => (
              <tr key={i}>
                {table.columns.map((c) => (
                  <td key={c} data-col={c} className={row[c]?.includes("OUT OF SPEC") ? "fail" : ""}>
                    {row[c]}
                  </td>
                ))}
              </tr>
            ))}
            {(table.summaryRows ?? []).map((row, i) => (
              <tr key={`summary-${i}`} style={{ fontWeight: 700, background: "#f0f0f0" }}>
                {table.columns.map((c) => (
                  <td key={c} data-col={c}>
                    {row[c]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {table.hasNotesBox && (
        <div className="form-notes-box">
          <span className="form-notes-label">NOTES:</span>
        </div>
      )}
    </div>
  );
}

function NarrativeEditor({
  jobRoot,
  section,
  onUpdated,
}: {
  jobRoot: string;
  section: SectionWithState;
  onUpdated: (content: string) => void;
}) {
  // Keyed by section.id in SectionPanel below, so this remounts (and re-derives its initial
  // state from `section`) whenever the reviewer switches sections — no sync effect needed.
  const [draft, setDraft] = useState(section.state.content ?? "");
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);

  const runDraft = async (withInstruction?: string) => {
    setBusy(true);
    try {
      const res = await fetch("/api/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobRoot, sectionId: section.id, instruction: withInstruction }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setDraft(data.content ?? "");
      onUpdated(data.content ?? "");
      setInstruction("");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Draft failed");
    } finally {
      setBusy(false);
    }
  };

  const saveManualEdit = async () => {
    setBusy(true);
    try {
      await fetch("/api/section-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobRoot, sectionId: section.id, patch: { content: draft, draftError: null } }),
      });
      onUpdated(draft);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {section.state.draftError && !draft && (
        <p className="confidence-note" style={{ color: "#a4141a" }}>
          ⚠ Automatic draft generation didn&apos;t produce a draft for this section: {section.state.draftError} Write it manually below, or use &quot;Revise with
          instruction&quot; to ask Claude for a fresh attempt.
        </p>
      )}
      <textarea className="draft-textarea" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="No draft yet — flagged for manual review." />
      <div className="toolbar">
        <button className="secondary" disabled={busy} onClick={saveManualEdit}>
          Save Edit
        </button>
      </div>
      <div className="toolbar">
        <input
          type="text"
          placeholder="Instruction for Claude, e.g. 'make this more concise'"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
        />
        <button disabled={busy || !instruction} onClick={() => runDraft(instruction)}>
          Revise with instruction
        </button>
      </div>
    </div>
  );
}

function PhotoSetEditor({ jobRoot, section }: { jobRoot: string; section: SectionWithState }) {
  // Keyed by section.id in SectionPanel below, so a section switch remounts this fresh.
  const [selected, setSelected] = useState<string[]>(section.state.selectedPhotoPaths ?? []);

  const toggle = async (relativePath: string) => {
    const next = selected.includes(relativePath) ? selected.filter((p) => p !== relativePath) : [...selected, relativePath];
    setSelected(next);
    await fetch("/api/section-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobRoot, sectionId: section.id, patch: { selectedPhotoPaths: next } }),
    });
  };

  const shown = section.matchedFiles.slice(0, 60);

  return (
    <div>
      <p className="section-reason">{section.statusReason}</p>
      {section.state.draftError && (
        <p className="confidence-note" style={{ color: "#a4141a" }}>
          ⚠ Automatic photo pre-selection didn&apos;t run: {section.state.draftError} Select photos manually below.
        </p>
      )}
      <p className="file-count">
        Incoming/NDT photos are preselected automatically, minus duplicates and unusable shots — click any photo to toggle it in/out of the final selection.{" "}
        {selected.length} selected.
      </p>
      <div className="photo-grid">
        {shown.map((f) => (
          <div key={f.relativePath} className={`photo-tile ${selected.includes(f.relativePath) ? "selected" : ""}`} onClick={() => toggle(f.relativePath)}>
            <img src={`/api/photo-file?jobRoot=${encodeURIComponent(jobRoot)}&path=${encodeURIComponent(f.relativePath)}`} alt={f.relativePath} />
            <div className="caption">{f.relativePath.split("/").pop()}</div>
          </div>
        ))}
      </div>
      {section.matchedFiles.length > shown.length && <p className="file-count">...and {section.matchedFiles.length - shown.length} more not shown.</p>}
    </div>
  );
}

function AttachAsIs({ section }: { section: SectionWithState }) {
  const file = section.matchedFiles[0];
  return (
    <div className="section-reason">
      {file ? (
        <p>
          Attached as-is: <strong>{file.relativePath}</strong>
        </p>
      ) : (
        <p>No file found — this exhibit will be missing from the generated report unless you add one to the job folder.</p>
      )}
    </div>
  );
}

function CoverEditor({ jobRoot, section, metadata }: { jobRoot: string; section: SectionWithState; metadata: JobScanResult["metadata"] }) {
  // Keyed by section.id in SectionPanel below, so this remounts fresh if the job is rescanned.
  const initial: Record<string, string> = {};
  for (const { key } of COVER_FIELD_ORDER) {
    const raw = (section.state.fields?.[key as string] ?? (metadata[key] as string) ?? "").toString();
    initial[key as string] = key === "date" ? raw.split("T")[0] : raw;
  }
  const [values, setValues] = useState(initial);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await fetch("/api/section-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobRoot, sectionId: section.id, patch: { fields: values } }),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="cover-table-wrap">
        <table className="preview-table cover-table" style={{ maxWidth: 640 }}>
          <tbody>
            {COVER_FIELD_ORDER.map(({ key, label }) => (
              <tr key={key as string}>
                <th style={{ width: 180, textAlign: "left" }}>{label}</th>
                <td>
                  <input
                    type="text"
                    style={{ width: "100%" }}
                    value={values[key as string]}
                    onChange={(e) => setValues((v) => ({ ...v, [key as string]: e.target.value }))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="toolbar">
        <button disabled={busy} onClick={save}>
          {busy ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}

function SectionPanel({
  jobRoot,
  section,
  metadata,
  onRefresh,
  onReviewed,
}: {
  jobRoot: string;
  section: SectionWithState;
  metadata: JobScanResult["metadata"];
  onRefresh: () => void;
  onReviewed: (acknowledged: boolean) => void;
}) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <h2 style={{ margin: 0 }}>{section.title}</h2>
        <button className={section.state.acknowledged ? "secondary" : ""} onClick={() => onReviewed(!section.state.acknowledged)}>
          {section.state.acknowledged ? "✓ Reviewed" : "Tech Rep Reviewed"}
        </button>
      </div>
      <div className="title-row" style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, marginTop: 8 }}>
        <StatusBadge status={section.status} acknowledged={section.state.acknowledged} />
        <span className="confidence-tag">automation confidence: {section.automationConfidence}</span>
      </div>
      <p className="section-reason">{section.statusReason}</p>
      {section.confidenceNote && <p className="confidence-note">{section.confidenceNote}</p>}

      {section.generation === "llm-narrative" && <NarrativeEditor key={section.id} jobRoot={jobRoot} section={section} onUpdated={onRefresh} />}
      {section.generation === "table-from-source" && <TablePreview section={section} />}
      {section.generation === "llm-vision-select" && <PhotoSetEditor key={section.id} jobRoot={jobRoot} section={section} />}
      {section.generation === "attach-as-is" && <AttachAsIs section={section} />}
      {section.generation === "template" && <CoverEditor key={section.id} jobRoot={jobRoot} section={section} metadata={metadata} />}
    </div>
  );
}

export default function Home() {
  const [jobRoot, setJobRoot] = useState<string | null>(null);
  const [scan, setScan] = useState<ScanResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  const runScan = async (root: string) => {
    setLoading(true);
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobRoot: root }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setScan(data);
      setSelectedId((prev) => prev ?? data.sections[0]?.id ?? null);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setLoading(false);
    }
  };

  const chooseFolder = async (path: string) => {
    setJobRoot(path);
    await runScan(path);
  };

  // Marking a section reviewed also jumps to the next one in the list — the whole point is to
  // let a tech rep move through the report top-to-bottom without hunting for the next tab
  // themselves. Only advances when marking AS reviewed, not when undoing it.
  const markReviewed = async (sectionId: string, acknowledged: boolean) => {
    if (!jobRoot || !scan) return;
    setScan((prev) =>
      prev ? { ...prev, sections: prev.sections.map((s) => (s.id === sectionId ? { ...s, state: { ...s.state, acknowledged } } : s)) } : prev
    );
    if (acknowledged) {
      const idx = scan.sections.findIndex((s) => s.id === sectionId);
      const next = scan.sections[idx + 1];
      if (next) setSelectedId(next.id);
    }
    await fetch("/api/section-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobRoot, sectionId, patch: { acknowledged } }),
    });
  };

  const generateReport = async () => {
    if (!jobRoot) return;
    setGenerating(true);
    try {
      const res = await fetch("/api/generate-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobRoot }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${scan?.metadata.jobNumber ?? "report"}-IA-Report.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(e instanceof Error ? e.message : "PDF generation failed");
    } finally {
      setGenerating(false);
    }
  };

  if (!jobRoot) {
    return <FolderPicker onJobFolderChosen={chooseFolder} />;
  }

  if (!scan) {
    return (
      <div className="folder-picker">
        <div className="app-logo">
          <img src="/apg-mark-transparent.png" alt="" className="app-logo-icon" />
          <h1>Report Builder</h1>
        </div>
        <div className="app-logo-bar" />
        <p className="folder-picker-subtitle">{loading ? "Analyzing job files and building the initial draft…" : "Something went wrong loading this job."}</p>
        <div className="folder-picker-card">
          <p className="job-path">{jobRoot}</p>
          {loading && <p className="section-reason">This reads every matched file and drafts each AI-assisted section — usually a minute or two.</p>}
          <div className="toolbar">
            <button className="secondary" onClick={() => setJobRoot(null)}>
              ← Change folder
            </button>
          </div>
        </div>
      </div>
    );
  }

  const selectedSection = scan.sections.find((s) => s.id === selectedId) ?? scan.sections[0];
  const allAddressed = scan.sections.every((s) => s.status === "ready" || s.state.acknowledged);

  return (
    <div className="app-shell">
      <header className="app-header">
        <button className="secondary" onClick={() => setJobRoot(null)}>
          ← Change folder
        </button>
        <span className="job-path">{jobRoot}</span>
        <span className="file-count">
          Job #{scan.metadata.jobNumber} · {scan.metadata.customer} · {scan.metadata.part} · Qty {scan.metadata.quantity}
        </span>
        <button disabled={loading} className="secondary" onClick={() => runScan(jobRoot)}>
          {loading ? "Scanning..." : "Rescan"}
        </button>
      </header>
      <div className="app-body">
        <nav className="sidebar">
          <div className="sidebar-scroll">
            {scan.sections.map((s) => (
              <button key={s.id} className={`section-item ${s.id === selectedSection.id ? "active" : ""}`} onClick={() => setSelectedId(s.id)}>
                <div className="title-row">
                  <span>{s.title}</span>
                  <StatusBadge status={s.status} acknowledged={s.state.acknowledged} />
                </div>
                <div className="confidence-tag">{s.automationConfidence} confidence</div>
              </button>
            ))}
            <div className="sidebar-logo-spacer" aria-hidden="true">
              <img src="/apg-logo-transparent.png" alt="" className="sidebar-logo-img" />
            </div>
          </div>
        </nav>
        <main className="main-panel">
          <SectionPanel
            jobRoot={jobRoot}
            section={selectedSection}
            metadata={scan.metadata}
            onRefresh={() => runScan(jobRoot)}
            onReviewed={(acknowledged) => markReviewed(selectedSection.id, acknowledged)}
          />
        </main>
      </div>
      <footer className="app-header" style={{ justifyContent: "flex-end" }}>
        {!allAddressed && <span className="confidence-note">Some sections still need attention.</span>}
        <button className="generate-report" disabled={generating} onClick={generateReport}>
          {generating ? "Generating..." : "Generate Report"}
        </button>
      </footer>
    </div>
  );
}
