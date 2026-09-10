#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const get = async (url, options) => {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
  assert.equal(response.ok, true, `${url}: HTTP ${response.status}`);
  return response.json();
};
for (const url of ['http://127.0.0.1:3100/ready', 'http://127.0.0.1:12345/-/ready', 'http://127.0.0.1:8083/healthz']) {
  assert.equal((await fetch(url, { signal: AbortSignal.timeout(5000) })).status, 200, `${url} not ready`);
}
const health = await get('http://127.0.0.1:8080/health');
assert.equal(health.status, 'ok');
assert.equal((await fetch('http://127.0.0.1:8080/login')).status, 200);
assert.equal((await fetch('http://127.0.0.1:8080/api/files')).status, 401);
assert.equal((await fetch('http://127.0.0.1:8080/metrics')).status, 404);
const targets = (await get('http://127.0.0.1:9090/api/v1/targets')).data.activeTargets;
assert.equal(targets.length, 10);
for (const target of targets) assert.equal(target.health, 'up', `${target.labels.job}: ${target.lastError}`);
console.log('All 10 Prometheus scrape targets are healthy.');
for (const query of ['nginx_up', 'pg_up', 'redis_up', 'secure_cloud_storage_collection_success']) {
  const data = await get(`http://127.0.0.1:9090/api/v1/query?query=${encodeURIComponent(query)}`);
  assert(data.data.result.length > 0, `${query}: no series`);
  assert(data.data.result.every(x => x.value[1] === '1'), `${query} is not healthy`);
}
const password = (await readFile(process.env.MONITORING_RUNTIME_DIR ? `${process.env.MONITORING_RUNTIME_DIR}/grafana_admin_password` : new URL('../runtime/grafana_admin_password', import.meta.url), 'utf8')).trim();
const headers = { authorization: `Basic ${Buffer.from(`admin:${password}`).toString('base64')}` };
for (const source of ['prometheus', 'loki']) {
  const result = await get(`http://127.0.0.1:8080/grafana/api/datasources/uid/${source}/health`, { headers });
  assert.equal(result.status, 'OK', `${source} data source: ${result.message}`);
}
const prom = await get('http://127.0.0.1:8080/grafana/api/datasources/proxy/uid/prometheus/api/v1/query?query=up', { headers });
assert(prom.data.result.length >= 10);
for (const service of ['nginx', 'backend', 'frontend', 'postgres', 'redis']) {
  const query = encodeURIComponent(`{service="${service}"}`);
  const result = await get(`http://127.0.0.1:8080/grafana/api/datasources/proxy/uid/loki/loki/api/v1/query_range?query=${query}&limit=5`, { headers });
  assert(result.data.result.length > 0, `No ${service} logs in Loki through Grafana`);
}
const dashboards = await get('http://127.0.0.1:8080/grafana/api/search?type=dash-db', { headers });
assert.equal(dashboards.filter(x => x.uid.startsWith('secure-cloud-')).length, 7);
const rows = execFileSync('docker', ['compose', 'ps', '--all', '--format', 'json'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).map(x => JSON.parse(x));
for (const c of rows) {
  if (c.Service === 'migrate') { assert.equal(c.ExitCode, 0); continue; }
  assert.equal(c.State, 'running', `${c.Service}: ${c.State}`);
  if (c.Health) assert.equal(c.Health, 'healthy', `${c.Service}: ${c.Health}`);
}
console.log('Containers, exporter connections, 7 dashboards, Grafana data sources and log queries verified.');
console.log('/health, frontend login, protected API and non-public metrics routes verified.');
