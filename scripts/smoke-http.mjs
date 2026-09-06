import assert from "node:assert/strict";
const api = process.env.SMOKE_API;
const web = process.env.SMOKE_WEB;
async function ready(url) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await fetch(url).then(r => r.ok).catch(() => false)) return;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`Not ready: ${url}`);
}
await Promise.all([ready(`${api}/health`), ready(`${web}/login`)]);
const origin = "https://smoke.trycloudflare.com";
const preflight = await fetch(`${api}/api/files/upload`, { method: "OPTIONS", headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": "content-type" } });
assert.equal(preflight.status, 204);
assert.equal(preflight.headers.get("access-control-allow-origin"), origin);
assert.equal(preflight.headers.get("access-control-allow-credentials"), "true");
let cookie;
async function request(path, method = "GET", body, binary = false) {
  const response = await fetch(`${api}/api${path}`, {
    method,
    headers: { origin, "x-forwarded-proto": "https", ...(cookie && { cookie }), ...(body !== undefined && { "content-type": binary ? "application/octet-stream" : "application/json" }) },
    body: body === undefined ? undefined : binary ? body : JSON.stringify(body),
  });
  assert.ok(response.ok, `${method} ${path}: ${response.status} ${response.ok ? "" : await response.text()}`);
  return response;
}
const registration = await request("/auth/register", "POST", { name: "Smoke Test", email: "smoke@example.com", password: "SmokeTestPass1!", confirmPassword: "SmokeTestPass1!" });
cookie = registration.headers.get("set-cookie").split(";")[0];
const { folders } = await (await request("/folders")).json();
const bytes = Buffer.from("secure-cloud container round-trip");
const query = new URLSearchParams({ filename: "smoke.txt", size: String(bytes.length), mimeType: "text/plain", folderId: folders[0].id });
const { file } = await (await request(`/files/upload?${query}`, "POST", bytes, true)).json();
assert.equal((await (await request("/files?search=smoke")).json()).files.length, 1);
assert.equal(await (await request(`/files/${file.id}/download`)).text(), bytes.toString());
const usage = await (await request("/storage")).json();
assert.equal(usage.storageUsed, String(bytes.length));
assert.equal(usage.storageLimit, "5368709120");
assert.equal((await fetch(`${web}/files/${file.id}`)).status, 200);
await request(`/files/${file.id}`, "DELETE");
assert.equal((await (await request("/storage")).json()).storageUsed, "0");
console.log("Nginx container smoke tests passed: CORS, pages, auth, upload, list, download, quota, delete.");
