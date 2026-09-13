"use client";

import { Archive, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, API_URL, formatBytes } from "@/lib/api";

type BackupFile = { id: string; originalName: string; size: string; folder: { name: string } };

export function BackupButton() {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<BackupFile[]>([]);
  const [selected, setSelected] = useState<Map<string, BackupFile>>(new Map());
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [requested, setRequested] = useState(false);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const timer = setTimeout(() => {
      const query = new URLSearchParams({ search, page: String(page), limit: "30", sort: "name", order: "asc" });
      api<{ files: BackupFile[]; pagination: { pages: number } }>(`/files?${query}`, { signal: controller.signal })
        .then(result => { setFiles(result.files); setPages(Math.max(1, result.pagination.pages)); })
        .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load files"); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, search, page]);

  function toggle(file: BackupFile) {
    setRequested(false);
    setSelected(current => {
      const next = new Map(current);
      if (next.has(file.id)) next.delete(file.id);
      else if (next.size < 100) next.set(file.id, file);
      return next;
    });
  }

  return <>
    <button onClick={() => { setOpen(true); setRequested(false); }} className="icon-button flex h-11 items-center gap-2 px-3 text-xs font-bold"><Archive size={17} />Back up files</button>
    {open && <div role="dialog" aria-modal="true" aria-labelledby="backup-title" onKeyDown={event => { if (event.key === "Escape") setOpen(false); }} className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4 backdrop-blur-sm">
      <button onClick={() => setOpen(false)} className="absolute inset-0" aria-label="Close backup dialog" />
      <div className="cyber-panel relative flex max-h-[90dvh] w-full max-w-xl flex-col p-5 sm:p-7">
        <button onClick={() => setOpen(false)} className="icon-button absolute right-4 top-4 size-9 border-0" aria-label="Close"><X size={18} /></button>
        <h2 id="backup-title" className="pr-10 text-xl font-bold">Back up your files</h2>
        <p className="mt-2 text-sm text-[var(--muted)]">Select up to 100 files from any folder. Download a ZIP backup to this device.</p>
        <input autoFocus aria-label="Search files to back up" placeholder="Search all your files" maxLength={100} value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} className="cyber-input my-4 h-11 shrink-0 px-3 text-sm" />
        {error && <p role="alert" className="mb-3 text-sm text-[var(--danger)]">{error}</p>}
        <div className="min-h-24 overflow-y-auto" aria-busy={loading}>
          {loading ? <Loader2 className="mx-auto my-6 animate-spin" aria-label="Loading files" /> : error ? null : files.length === 0 ? <p className="py-5 text-sm">No files found.</p> : files.map(file => <label key={file.id} className="flex cursor-pointer items-center gap-3 border-b border-[var(--line)] py-3">
            <input type="checkbox" checked={selected.has(file.id)} disabled={!selected.has(file.id) && selected.size >= 100} onChange={() => toggle(file)} aria-label={`Back up ${file.originalName}`} />
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{file.originalName}</span><span className="block truncate text-xs text-[var(--muted)]">{file.folder.name} · {formatBytes(file.size)}</span></span>
          </label>)}
        </div>
        <div className="my-4 flex items-center justify-between text-xs"><button disabled={page <= 1 || loading} onClick={() => setPage(value => value - 1)} className="icon-button px-3 py-2 disabled:opacity-40">Previous</button><span>Page {page} of {pages}</span><button disabled={page >= pages || loading} onClick={() => setPage(value => value + 1)} className="icon-button px-3 py-2 disabled:opacity-40">Next</button></div>
        <div className="flex items-center justify-between gap-2 text-sm"><span>{selected.size} selected · {formatBytes([...selected.values()].reduce((sum, file) => sum + Number(file.size), 0))}</span><button onClick={() => { setSelected(new Map()); setRequested(false); }} className="text-xs underline">Clear selection</button></div>
        <form action={`${API_URL}/files/backup`} method="get" target="_blank" rel="noopener noreferrer" onSubmit={() => setRequested(true)}>
          <input type="hidden" name="ids" value={[...selected.keys()].join(",")} />
          <button disabled={!selected.size} className="cyber-button mt-4 h-11 w-full text-sm font-bold disabled:opacity-40">Download backup</button>
        </form>
        {requested && <p role="status" className="mt-3 text-xs text-[var(--muted)]">Download requested. Check your browser’s downloads; any request error opens in a new tab. Keep the connection open until it finishes.</p>}
      </div>
    </div>}
  </>;
}
