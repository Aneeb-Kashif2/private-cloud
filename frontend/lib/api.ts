export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api";
export class ApiError extends Error { constructor(public status: number, message: string, public code?: string) { super(message); } }
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { ...init, credentials: "include", headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers } });
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new ApiError(response.status, body.error?.message ?? "Request failed", body.error?.code); }
  if (response.status === 204) return undefined as T;
  return response.json();
}
export function uploadToS3(url: string, file: File, onProgress: (value: number) => void) {
  return new Promise<void>((resolve, reject) => { const xhr = new XMLHttpRequest(); xhr.open("PUT", url); xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream"); xhr.upload.onprogress = e => e.lengthComputable && onProgress(Math.round(e.loaded / e.total * 100)); xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("Storage upload failed")); xhr.onerror = () => reject(new Error("Storage upload failed")); xhr.send(file); });
}
export const formatBytes = (value: string | number) => { const bytes = Number(value); if (!bytes) return "0 B"; const units = ["B", "KB", "MB", "GB", "TB"]; const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1); return `${(bytes / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`; };
