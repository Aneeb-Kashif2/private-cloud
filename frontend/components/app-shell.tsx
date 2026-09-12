"use client";
import { Cloud, Files, FolderClosed, Gauge, LogOut, Menu, Moon, Settings, ShieldCheck, Sun, Trash2, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

const links = [
  { href: "/dashboard", label: "Overview", icon: Gauge },
  { href: "/files", label: "My files", icon: Files },
  { href: "/files?folders=true", label: "Folders", icon: FolderClosed },
  { href: "/trash", label: "Trash", icon: Trash2 },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [dark, setDark] = useState(false);
  const [user, setUser] = useState<{ name: string; email: string } | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem("theme") === "dark";
    setDark(stored);
    document.documentElement.classList.toggle("dark", stored);
    api<{ user: { name: string; email: string } }>("/auth/me")
      .then((response) => setUser(response.user))
      .catch(() => router.replace("/login"));
  }, [router]);

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  }

  async function logout() {
    await api("/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  const sidebar = (
    <aside className="flex h-full w-[264px] flex-col border-r border-[var(--line)] bg-[var(--panel)] px-4 py-5">
      <div className="flex items-center justify-between px-2">
        <Link href="/dashboard" className="flex items-center gap-3" onClick={() => setOpen(false)}>
          <span className="brand-mark size-10"><Cloud size={21} strokeWidth={2.4} /></span>
          <span><span className="block text-[15px] font-bold tracking-tight">Self Cloud</span><span className="mt-0.5 block text-[10px] text-[var(--muted)]">Private file storage</span></span>
        </Link>
        <button className="icon-button size-9 md:hidden" onClick={() => setOpen(false)} aria-label="Close navigation"><X size={18} /></button>
      </div>

      <div className="mx-2 mb-6 mt-8 flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--panel-2)] px-3 py-2.5 text-[11px] text-[var(--muted)]">
        <span className="status-dot" /> <span>All systems operational</span>
      </div>
      <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[.12em] text-[var(--muted)]">Workspace</p>
      <nav className="space-y-1">
        {links.map(({ href, label, icon: Icon }) => {
          const active = path === href.split("?")[0];
          return <Link key={label} href={href} onClick={() => setOpen(false)} className={`nav-item flex h-11 items-center gap-3 px-3 text-[13px] font-semibold ${active ? "nav-item-active" : ""}`}><Icon size={18} strokeWidth={active ? 2.3 : 1.8} /><span>{label}</span>{active && <span className="ml-auto size-1.5 rounded-full bg-[var(--accent)]" />}</Link>;
        })}
      </nav>

      <div className="mt-auto border-t border-[var(--line)] pt-4">
        <div className="mb-3 flex items-center gap-3 rounded-xl bg-[var(--panel-2)] p-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--accent)] text-xs font-bold text-white">{user?.name?.slice(0, 1).toUpperCase() ?? "..."}</span>
          <div className="min-w-0"><p className="truncate text-xs font-bold">{user?.name ?? "Loading profile"}</p><p className="mt-0.5 truncate text-[10px] text-[var(--muted)]">{user?.email ?? ""}</p></div>
          <ShieldCheck className="ml-auto shrink-0 text-[var(--accent-2)]" size={15} />
        </div>
        <button onClick={logout} className="flex h-10 w-full items-center gap-3 rounded-lg px-3 text-xs font-semibold text-[var(--muted)] transition-colors hover:bg-red-50 hover:text-[var(--danger)] dark:hover:bg-red-950/20"><LogOut size={16} /> Sign out</button>
      </div>
    </aside>
  );

  return <div className="flex min-h-screen bg-[var(--bg)]"><div className="hidden md:block">{sidebar}</div>{open && <div className="fixed inset-0 z-40 md:hidden"><button className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm" onClick={() => setOpen(false)} aria-label="Close navigation" />{sidebar}</div>}<div className="min-w-0 flex-1"><header className="flex h-[72px] items-center justify-between border-b border-[var(--line)] bg-[color-mix(in_srgb,var(--panel)_90%,transparent)] px-4 backdrop-blur-md sm:px-7"><button className="icon-button size-10 md:hidden" onClick={() => setOpen(true)} aria-label="Open navigation"><Menu size={19} /></button><div className="hidden items-center gap-2 text-xs text-[var(--muted)] md:flex"><span className="font-semibold text-[var(--ink)]">Workspace</span><span>/</span><span>{path === "/dashboard" ? "Overview" : path.split("/")[1]?.replace("-", " ")}</span></div><div className="ml-auto flex items-center gap-2"><span className="hidden rounded-full border border-[var(--line)] px-3 py-2 text-[11px] text-[var(--muted)] sm:block">Secure workspace</span><button onClick={toggleTheme} className="icon-button size-10" aria-label="Toggle color theme">{dark ? <Sun size={18} /> : <Moon size={18} />}</button></div></header><main className="p-4 sm:p-6 lg:p-8">{children}</main></div></div>;
}
