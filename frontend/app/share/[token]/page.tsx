"use client";
import { AlertTriangle, Download, File as FileIcon, Loader2, ShieldCheck } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { API_URL, api, formatBytes } from "@/lib/api";

type SharedFile = { originalName: string; mimeType: string; size: string };
type ShareResponse = { file: SharedFile; expiresAt: string | null; maxDownloads: number | null; downloadCount: number };

export default function SharePage() {
  const { token } = useParams<{ token: string }>();
  const [share, setShare] = useState<ShareResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    api<ShareResponse>(`/shares/${token}`).then(setShare).catch(() => setError(true)).finally(() => setLoading(false));
  }, [token]);

  function download() {
    window.location.assign(`${API_URL}/shares/${token}/download`);
  }

  return <main className="flex min-h-screen items-center justify-center px-5 py-10"><div className="w-full max-w-[520px]">
    <div className="mb-7 flex items-center justify-between"><div className="flex items-center gap-2.5"><span className="brand-mark size-9"><FileIcon size={18} /></span><span className="text-sm font-bold">Self Cloud</span></div><span className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--accent-2)]"><ShieldCheck size={15} /> Secure link</span></div>
    <section className="cyber-panel p-6 sm:p-8">{loading ? <div className="grid min-h-52 place-items-center"><Loader2 className="animate-spin text-[var(--accent)]" /></div> : error || !share ? <div className="py-8 text-center"><span className="mx-auto grid size-14 place-items-center rounded-2xl bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] text-[var(--danger)]"><AlertTriangle size={26} /></span><h1 className="mt-5 text-xl font-bold">This link is unavailable</h1><p className="mt-2 text-sm leading-6 text-[var(--muted)]">It may have expired, been revoked, or reached its download limit.</p></div> : <><p className="cyber-kicker">Shared file</p><h1 className="mt-2 break-words text-2xl font-bold tracking-tight">{share.file.originalName}</h1><div className="mt-6 flex items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--panel-2)] p-4"><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[var(--glow)] text-[var(--accent)]"><FileIcon size={23} /></span><div className="min-w-0"><p className="truncate text-sm font-bold">{share.file.mimeType}</p><p className="mt-1 text-xs text-[var(--muted)]">{formatBytes(share.file.size)}{share.maxDownloads ? ` · ${Math.max(0, share.maxDownloads - share.downloadCount)} downloads left` : ""}</p></div></div><button onClick={download} className="cyber-button mt-6 flex h-12 w-full items-center justify-center gap-2 text-sm font-bold"><Download size={18} /> Download file</button><p className="mt-4 text-center text-[11px] text-[var(--muted)]">Your download is streamed securely. The storage location stays private.</p></>}</section>
    <p className="mt-5 text-center text-[11px] text-[var(--muted)]">Powered by Self Cloud</p>
  </div></main>;
}
