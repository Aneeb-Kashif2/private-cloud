"use client";
import { ArrowRight, Check, Cloud, Eye, EyeOff, LockKeyhole, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [show, setShow] = useState(false);
  const isLogin = mode === "login";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    const form = new FormData(event.currentTarget);
    try {
      await api(`/auth/${mode}`, { method: "POST", body: JSON.stringify(Object.fromEntries(form)) });
      toast.success(isLogin ? "Welcome back" : "Your cloud is ready");
      router.replace("/dashboard");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to continue");
    } finally {
      setLoading(false);
    }
  }

  return <main className="grid min-h-screen lg:grid-cols-[minmax(340px,42%)_1fr]">
    <section className="relative hidden overflow-hidden bg-[#18355f] p-10 text-white lg:flex lg:flex-col lg:justify-between xl:p-14">
      <div className="absolute -right-24 -top-24 size-80 rounded-full border-[32px] border-white/5" /><div className="absolute -bottom-40 -left-28 size-96 rounded-full border-[48px] border-white/5" />
      <Link href="/" className="relative flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-white text-[#2865d8]"><Cloud size={22} /></span><span><span className="block text-[15px] font-bold">Self Cloud</span><span className="block text-[10px] text-blue-100/70">Private file storage</span></span></Link>
      <div className="relative max-w-sm"><p className="mb-4 text-xs font-bold uppercase tracking-[.16em] text-blue-200">Your files. Your control.</p><h2 className="text-4xl font-bold leading-[1.08] tracking-tight xl:text-5xl">A calmer home for everything important.</h2><p className="mt-6 text-sm leading-6 text-blue-100/75">Securely store, organize, and access your files from anywhere, with a workspace that stays refreshingly simple.</p><div className="mt-8 space-y-3 text-sm text-blue-50"><p className="flex items-center gap-3"><Check size={16} className="text-[#53d2bb]" /> Private by default</p><p className="flex items-center gap-3"><Check size={16} className="text-[#53d2bb]" /> Fast, focused file browsing</p><p className="flex items-center gap-3"><Check size={16} className="text-[#53d2bb]" /> Built for your personal cloud</p></div></div>
      <p className="relative text-[11px] text-blue-100/50">SELF CLOUD · SECURE STORAGE</p>
    </section>
    <section className="flex items-center justify-center px-5 py-10 sm:px-10"><div className="w-full max-w-[430px]">
      <Link href="/" className="mb-10 flex items-center gap-3 lg:hidden"><span className="brand-mark size-10"><Cloud size={21} /></span><span><span className="block text-[15px] font-bold">Self Cloud</span><span className="block text-[10px] text-[var(--muted)]">Private file storage</span></span></Link>
      <div className="mb-8"><div className="mb-5 flex size-11 items-center justify-center rounded-xl bg-[var(--glow)] text-[var(--accent)]"><ShieldCheck size={23} /></div><p className="cyber-kicker">{isLogin ? "Welcome back" : "Get started"}</p><h1 className="mt-2 text-3xl font-bold tracking-tight">{isLogin ? "Sign in to your cloud" : "Create your cloud"}</h1><p className="mt-3 text-sm leading-6 text-[var(--muted)]">{isLogin ? "Access your private files and keep moving." : "Set up your private 10 GB storage workspace in a minute."}</p></div>
      <form onSubmit={submit} className="space-y-5">
        {!isLogin && <Field label="Full name" name="name" type="text" autoComplete="name" placeholder="Alex Morgan" />}
        <Field label="Email address" name="email" type="email" autoComplete="email" placeholder="you@example.com" />
        <label className="block"><span className="mb-2 flex items-center gap-2 text-xs font-semibold"> <LockKeyhole size={14} className="text-[var(--muted)]" /> Password</span><span className="relative block"><input className="cyber-input h-12 w-full px-3 pr-12 text-sm" name="password" type={show ? "text" : "password"} autoComplete={isLogin ? "current-password" : "new-password"} required placeholder="Enter your password" /><button type="button" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"} className="absolute right-3 top-3 text-[var(--muted)] hover:text-[var(--ink)]">{show ? <EyeOff size={19} /> : <Eye size={19} />}</button></span></label>
        {!isLogin && <Field label="Confirm password" name="confirmPassword" type="password" autoComplete="new-password" placeholder="Repeat your password" />}
        <button disabled={loading} className="cyber-button flex h-12 w-full items-center justify-center gap-2 text-sm font-bold disabled:cursor-wait disabled:opacity-70">{loading ? "Please wait..." : isLogin ? "Sign in" : "Create account"}{!loading && <ArrowRight size={17} />}</button>
      </form>
      <p className="mt-8 text-center text-sm text-[var(--muted)]">{isLogin ? "New to Self Cloud?" : "Already have an account?"} <Link href={isLogin ? "/register" : "/login"} className="font-bold text-[var(--accent)] hover:underline">{isLogin ? "Create an account" : "Sign in"}</Link></p>
    </div></section>
  </main>;
}

function Field(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return <label className="block"><span className="mb-2 block text-xs font-semibold">{props.label}</span><input {...props} required className="cyber-input h-12 w-full px-3 text-sm" /></label>;
}
