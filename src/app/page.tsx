"use client";

import { useEffect, useState } from "react";
import type { JobScanResult, SectionScanResult } from "@/lib/ingest/scanJobFolder";
import { COVER_FIELD_ORDER } from "@/lib/ingest/jobMetadata";
import type { SectionState } from "@/lib/state/jobState";

type SectionWithState = SectionScanResult & { state: SectionState };
type ScanResponse = Omit<JobScanResult, "sections"> & { sections: SectionWithState[] };

function StatusBadge({ status }: { status: string }) {
  return <span className={`status-badge ${status}`}>{status.replace("-", " ")}</span>;
}

function FolderPicker({ onJobFolderChosen }: { onJobFolderChosen: (path: string) => void }) {
  const [dir, setDir] = useState<string | null>(null);
  const [folders, setFolders] = useState<string[]>([]);
  const [parent, setParent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async (target?: string) => {
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
  };

  useEffect(() => {
    // Fetch-on-mount: `load` intentionally omitted from deps (stable enough for this one-shot
    // initial listing) and its setState calls happen after an await, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  return (
    <div className="folder-picker">
      <h1>Tech Rep Report Builder</h1>
      <p>Pick the job folder to scan.</p>
      <p className="job-path">{dir}</p>
      {error && <p style={{ color: "#a4141a" }}>{error}</p>}
      <div className="toolbar">
        <button className="secondary" onClick={() => parent && load(parent)}>
          Up one level
        </button>
        {dir && <button onClick={() => onJobFolderChosen(dir)}>Use this folder</button>}
      </div>
      <div className="folder-list">
        {folders.map((f) => (
          <button key={f} onClick={() => load(dir ? `${dir}\\${f}` : f)}>
            📁 {f}
          </button>
        ))}
      </div>
    </div>
  );
}

function TablePreview({ section }: { section: SectionWithState }) {
  const table = section.parsedTable;
  if (!table) return <p className="section-reason">No table data available.</p>;
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
      <table className="preview-table">
        <thead>
          <tr>
            {table.columns.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, i) => (
            <tr key={i}>
              {table.columns.map((c) => (
                <td key={c} className={row[c]?.includes("OUT OF SPEC") ? "fail" : ""}>
                  {row[c]}
                </td>
              ))}
            </tr>
          ))}
          {(table.summaryRows ?? []).map((row, i) => (
            <tr key={`summary-${i}`} style={{ fontWeight: 700, background: "#f0f0f0" }}>
              {table.columns.map((c) => (
                <td key={c}>{row[c]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
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
        body: JSON.stringify({ jobRoot, sectionId: section.id, patch: { content: draft } }),
      });
      onUpdated(draft);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <textarea className="draft-textarea" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="No draft yet — click Generate Draft." />
      <div className="toolbar">
        <button disabled={busy} onClick={() => runDraft()}>
          {section.state.content ? "Regenerate" : "Generate Draft"}
        </button>
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
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string[]>(section.state.selectedPhotoPaths ?? []);

  const runSelect = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobRoot, sectionId: section.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSelected(data.selectedPhotoPaths ?? []);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Selection failed");
    } finally {
      setBusy(false);
    }
  };

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
      <button disabled={busy} onClick={runSelect}>
        {busy ? "Asking Claude..." : "Suggest best photos"}
      </button>
      <p className="file-count">Click a photo to toggle it in/out of the final selection. {selected.length} selected.</p>
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
      <table className="preview-table" style={{ maxWidth: 560 }}>
        <tbody>
          {COVER_FIELD_ORDER.map(({ key, label }) => (
            <tr key={key as string}>
              <th style={{ width: 180, textAlign: "left" }}>{label}</th>
              <td>
                <input
                  type="text"
                  style={{ width: "100%", border: "1px solid #ccc", borderRadius: 4, padding: "4px 6px" }}
                  value={values[key as string]}
                  onChange={(e) => setValues((v) => ({ ...v, [key as string]: e.target.value }))}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
}: {
  jobRoot: string;
  section: SectionWithState;
  metadata: JobScanResult["metadata"];
  onRefresh: () => void;
}) {
  return (
    <div>
      <h2>{section.title}</h2>
      <div className="title-row" style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <StatusBadge status={section.status} />
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

  if (!jobRoot || !scan) {
    return <FolderPicker onJobFolderChosen={chooseFolder} />;
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
          {scan.sections.map((s) => (
            <button key={s.id} className={`section-item ${s.id === selectedSection.id ? "active" : ""}`} onClick={() => setSelectedId(s.id)}>
              <div className="title-row">
                <span>{s.title}</span>
                <StatusBadge status={s.status} />
              </div>
              <div className="confidence-tag">{s.automationConfidence} confidence</div>
            </button>
          ))}
        </nav>
        <main className="main-panel">
          <SectionPanel jobRoot={jobRoot} section={selectedSection} metadata={scan.metadata} onRefresh={() => runScan(jobRoot)} />
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
