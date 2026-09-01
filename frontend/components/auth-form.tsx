"use client";
import { Cloud, Eye, EyeOff, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter(); const [loading, setLoading] = useState(false); const [show, setShow] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setLoading(true); const form = new FormData(event.currentTarget); try { await api(`/auth/${mode}`, { method: "POST", body: JSON.stringify(Object.fromEntries(form)) }); toast.success(mode === "login" ? "Welcome back" : "Your cloud is ready"); router.replace("/dashboard"); } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to continue"); } finally { setLoading(false); } }
  return <main className="grid min-h-screen place-items-center bg-[var(--bg)] px-5 py-12">
    <section className="w-full max-w-[420px]">
      <Link href="/" className="mb-10 flex items-center gap-3 text-xl font-bold"><span className="grid size-10 place-items-center rounded-md bg-emerald-700 text-white"><Cloud size={23}/></span>Self Cloud</Link>
      <h1 className="text-3xl font-semibold">{mode === "login" ? "Sign in" : "Create your account"}</h1><p className="mt-2 text-[var(--muted)]">{mode === "login" ? "Access your private files and folders." : "Start with 10 GB of private storage."}</p>
      <form onSubmit={submit} className="mt-8 space-y-5">{mode === "register" && <Field label="Name" name="name" type="text" autoComplete="name"/>}<Field label="Email" name="email" type="email" autoComplete="email"/><label className="block"><span className="mb-2 block text-sm font-medium">Password</span><span className="relative block"><input className="focus-ring h-12 w-full rounded-md border border-[var(--line)] bg-[var(--panel)] px-3 pr-12" name="password" type={show ? "text" : "password"} autoComplete={mode === "login" ? "current-password" : "new-password"} required/><button type="button" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"} className="absolute right-3 top-3 text-[var(--muted)]">{show ? <EyeOff/> : <Eye/>}</button></span></label>{mode === "register" && <><Field label="Confirm password" name="confirmPassword" type={show ? "text" : "password"} autoComplete="new-password"/><p className="text-xs leading-5 text-[var(--muted)]">Use 12+ characters with uppercase, lowercase, a number, and a symbol.</p></>}<button disabled={loading} className="focus-ring flex h-12 w-full items-center justify-center gap-2 rounded-md bg-emerald-700 font-semibold text-white hover:bg-emerald-800 disabled:opacity-60">{loading && <Loader2 className="animate-spin" size={18}/>} {mode === "login" ? "Sign in" : "Create account"}</button></form>
      <p className="mt-7 text-center text-sm text-[var(--muted)]">{mode === "login" ? "New to Self Cloud?" : "Already have an account?"} <Link className="font-semibold text-[var(--accent)]" href={mode === "login" ? "/register" : "/login"}>{mode === "login" ? "Create account" : "Sign in"}</Link></p>
    </section></main>;
}
function Field(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) { return <label className="block"><span className="mb-2 block text-sm font-medium">{props.label}</span><input {...props} required className="focus-ring h-12 w-full rounded-md border border-[var(--line)] bg-[var(--panel)] px-3"/></label>; }
