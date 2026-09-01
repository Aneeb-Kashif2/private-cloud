import { FileManager } from "@/components/file-manager";
import { StorageSummary } from "@/components/storage-summary";
export default function DashboardPage(){return <div className="mx-auto max-w-[1200px]"><div className="mb-7"><p className="text-sm text-[var(--muted)]">Overview</p><h1 className="mt-1 text-3xl font-semibold">Your cloud</h1></div><StorageSummary/><div className="mt-8"><FileManager dashboard/></div></div>}
