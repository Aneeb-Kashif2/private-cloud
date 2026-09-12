"use client";
import { Activity, Database, FolderTree } from "lucide-react";
import { useEffect, useState } from "react";
import { api, formatBytes } from "@/lib/api";

export type Storage = { storageLimit: string; storageUsed: string; availableStorage: string; fileCount: number; folderCount: number };

export function StorageSummary({ compact = false }: { compact?: boolean }) {
  const [data, setData] = useState<Storage | null>(null);
  useEffect(() => { api<Storage>("/storage").then(setData); }, []);
  const pct = data ? Math.min(100, Number(data.storageUsed) / Number(data.storageLimit) * 100) : 0;

  return <section className={compact ? "" : "cyber-panel p-5 sm:p-6"}>
    <div className="flex items-start justify-between gap-4"><div><p className="cyber-kicker">Storage overview</p><h2 className="mt-1 text-lg font-bold">Your cloud at a glance</h2></div><span className="flex items-center gap-1.5 rounded-full bg-[color-mix(in_srgb,var(--accent-2)_12%,transparent)] px-2.5 py-1 text-[10px] font-bold text-[var(--accent-2)]"><Activity size={13} /> Live</span></div>
    <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end"><div><div className="flex items-end justify-between gap-4"><div><p className="text-xs font-semibold text-[var(--muted)]">Used storage</p><p className="mt-1 text-2xl font-bold tracking-tight">{data ? formatBytes(data.storageUsed) : "Reading..."}<span className="ml-1 text-sm font-medium text-[var(--muted)]">/ {data ? formatBytes(data.storageLimit) : ""}</span></p></div><p className="text-right text-xs font-semibold text-[var(--accent-2)]">{data ? `${formatBytes(data.availableStorage)} free` : ""}</p></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--panel-2)]"><div className="h-full rounded-full bg-[var(--accent)] transition-all duration-700" style={{ width: `${pct}%` }} /></div><div className="mt-2 flex justify-between text-[10px] text-[var(--muted)]"><span>0%</span><span>{pct.toFixed(1)}% used</span><span>100%</span></div></div>{!compact && data && <div className="grid grid-cols-2 gap-3 sm:grid-cols-2"><Stat icon={<Database size={16} />} label="Files" value={data.fileCount} /><Stat icon={<FolderTree size={16} />} label="Folders" value={data.folderCount} /></div>}</div>
  </section>;
}

function Stat({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return <div className="min-w-[112px] rounded-xl border border-[var(--line)] bg-[var(--panel-2)] p-3"><span className="text-[var(--accent)]">{icon}</span><p className="mt-2 text-xl font-bold">{value}</p><p className="mt-0.5 text-[10px] text-[var(--muted)]">{label}</p></div>;
}
