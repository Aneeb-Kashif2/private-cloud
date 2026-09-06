import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { FastifyInstance } from "fastify";
const apps: FastifyInstance[] = [];
const directories: string[] = [];
async function create(origins: string) {
  const directory = await mkdtemp(join(tmpdir(), "secure-cloud-cors-"));
  directories.push(directory);
  const app = await buildApp({
    config: loadConfig({ NODE_ENV: "test", DATABASE_URL: "postgresql://localhost/unused", AUTH_SECRET: "a".repeat(32), STORAGE_PATH: directory, FRONTEND_ORIGIN: origins }),
    redis: { getJson: async () => null, setJson: async () => {}, del: async () => {}, close: async () => {} },
  });
  apps.push(app);
  return app;
}
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
it("reflects changing tunnel origins with credentials and Vary", async () => {
  const app = await create("*");
  for (const origin of ["https://first.trycloudflare.com", "https://second.trycloudflare.com", "http://192.168.1.20:8080"]) {
    const response = await app.inject({ method: "OPTIONS", url: "/api/files/upload", headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": "content-type" } });
    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe(origin);
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
    expect(response.headers.vary).toContain("Origin");
  }
});
it("allows wildcard-origin POSTs to reach validation while keeping authentication", async () => {
  const app = await create("*");
  const headers = { origin: "https://new.trycloudflare.com" };
  const invalid = await app.inject({ method: "POST", url: "/api/auth/login", headers, payload: {} });
  expect(invalid.statusCode).toBe(400);
  const privateData = await app.inject({ method: "GET", url: "/api/files", headers });
  expect(privateData.statusCode).toBe(401);
  expect(privateData.headers["access-control-allow-origin"]).toBe(headers.origin);
});
it("retains explicit allowlist enforcement", async () => {
  const app = await create("https://cloud.example.com");
  const response = await app.inject({ method: "POST", url: "/api/auth/login", headers: { origin: "https://unlisted.example.com" }, payload: {} });
  expect(response.statusCode).toBe(403);
  expect(response.headers["access-control-allow-origin"]).toBeUndefined();
});
it("rejects opaque and invalid origins even in wildcard mode", async () => {
  const app = await create("*");
  for (const origin of ["null", "javascript:bad", "https://example.com/path"]) {
    const response = await app.inject({ method: "POST", url: "/api/auth/login", headers: { origin }, payload: {} });
    expect(response.statusCode).toBe(403);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  }
});
