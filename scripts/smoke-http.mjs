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
let cookie;
async function request(path, method = "GET", body, binary = false) {
  const response = await fetch(`${api}/api${path}`, {
    method,
    headers: { origin: "http://localhost:3000", ...(cookie && { cookie }), ...(body !== undefined && { "content-type": binary ? "application/octet-stream" : "application/json" }) },
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
console.log("Container smoke tests passed: pages, auth, upload, list, download, quota, delete.");
