import { createServer } from "node:http";
import { statfs } from "node:fs/promises";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from "@prometheus-io/client";

// Never use URLs, query strings, user IDs, file names, or headers as labels/log fields.
export function requestDimensions(request: FastifyRequest) {
  return {
    method: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(request.method) ? request.method : "OTHER",
    route: request.routeOptions.url ?? "unmatched",
  };
}
export function instrument(app: FastifyInstance) {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry, prefix: "secure_cloud_" });
  const registers = [registry];
  const requests = new Counter({ name: "secure_cloud_http_requests_total", help: "Completed HTTP requests", labelNames: ["method", "route", "status_code"], registers });
  const duration = new Histogram({ name: "secure_cloud_http_request_duration_seconds", help: "Time through response completion", labelNames: ["method", "route"], buckets: [0.005, 0.025, 0.1, 0.5, 1, 5, 30, 120], registers });
  const errors = new Counter({ name: "secure_cloud_http_errors_total", help: "HTTP errors", labelNames: ["class"], registers });
  const uploads = new Counter({ name: "secure_cloud_uploads_total", help: "Upload responses (not bytes)", labelNames: ["outcome"], registers });
  const downloads = new Counter({ name: "secure_cloud_downloads_total", help: "Download responses", labelNames: ["outcome"], registers });
  const uploadFailures = new Counter({ name: "secure_cloud_upload_failures_total", help: "Rejected, failed, or aborted uploads", registers });
  const authFailures = new Counter({ name: "secure_cloud_authentication_failures_total", help: "401 responses and rejected login attempts", registers });
  const started = new WeakMap<FastifyRequest, bigint>();
  const aborted = new WeakSet<FastifyRequest>();
  app.addHook("onRequest", async request => { started.set(request, process.hrtime.bigint()); });
  app.addHook("onRequestAbort", async request => {
    aborted.add(request);
    if (request.routeOptions.url === "/api/files/upload" && request.method === "POST") {
      uploads.inc({ outcome: "aborted" }); uploadFailures.inc();
    }
  });
  app.addHook("onResponse", async (request, reply) => {
    const labels = requestDimensions(request);
    const seconds = Number(process.hrtime.bigint() - (started.get(request) ?? process.hrtime.bigint())) / 1e9;
    const status = reply.statusCode;
    requests.inc({ ...labels, status_code: String(status) });
    duration.observe(labels, Math.max(0, seconds));
    if (status >= 400) errors.inc({ class: status >= 500 ? "5xx" : "4xx" });
    const outcome = status < 400 ? "success" : "failure";
    if (labels.route === "/api/files/upload" && labels.method === "POST" && !aborted.has(request)) {
      uploads.inc({ outcome }); if (status >= 400) uploadFailures.inc();
    }
    if (labels.route === "/api/files/:id/download" && labels.method === "GET") downloads.inc({ outcome });
    if (status === 401 || (labels.route === "/api/auth/login" && status >= 400)) authFailures.inc();
    app.log.info({ event: "http_request", ...labels, status, duration_seconds: Math.max(0, seconds) });
  });
  app.addHook("onClose", async () => { registry.clear(); });
  return registry;
}

// A separate socket means Nginx/API routing cannot accidentally publish metrics.
export async function startMetrics(app: FastifyInstance, port = 4001) {
  const registers = [app.metrics];
  const gauge = (name: string, help: string) => new Gauge({ name: `secure_cloud_${name}`, help, registers });
  const used = gauge("storage_used_bytes", "Sum of user metadata storage usage");
  const reserved = gauge("storage_reserved_bytes", "Bytes reserved by uploads");
  const quota = gauge("storage_quota_bytes", "Sum of user quotas");
  const users = gauge("users", "Number of registered users");
  const files = gauge("files", "Number of files in metadata");
  const free = gauge("storage_filesystem_available_bytes", "Available bytes on storage filesystem");
  const success = gauge("storage_collection_success", "Whether last aggregate collection succeeded");
  const timestamp = gauge("storage_collection_timestamp_seconds", "Last successful aggregate collection");
  let collecting = false;
  const collect = async () => {
    if (collecting) return;
    collecting = true;
    try {
      const [aggregate, count, fs] = await Promise.all([
        app.prisma.user.aggregate({ _count: true, _sum: { storageUsed: true, storageReserved: true, storageLimit: true } }),
        app.prisma.file.count(), statfs(app.config.STORAGE_PATH),
      ]);
      used.set(Number(aggregate._sum.storageUsed ?? 0)); reserved.set(Number(aggregate._sum.storageReserved ?? 0));
      quota.set(Number(aggregate._sum.storageLimit ?? 0)); users.set(aggregate._count); files.set(count);
      free.set(fs.bavail * fs.bsize); success.set(1); timestamp.set(Date.now() / 1000);
    } catch { success.set(0); app.log.warn({ event: "storage_metrics_collection_failed" }); }
    finally { collecting = false; }
  };
  const server = createServer(async (request, response) => {
    if (request.method !== "GET" || request.url !== "/metrics") { response.writeHead(404).end(); return; }
    try { response.writeHead(200, { "Content-Type": app.metrics.contentType }); response.end(await app.metrics.metrics()); }
    catch { response.writeHead(503).end(); }
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  void collect();
  const timer = setInterval(() => { void collect(); }, 60_000); timer.unref();
  app.addHook("onClose", async () => { clearInterval(timer); await new Promise<void>(resolve => server.close(() => resolve())); });
  return server;
}
