#!/usr/bin/env node
// Run once before Compose. Does not stop containers or modify application data.
import { readFile, writeFile, mkdir, access, chmod } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { parse } from 'dotenv';
import { PrismaClient } from '@prisma/client';
async function prepare() {
const root = resolve(import.meta.dirname, '../..');
const runtime = resolve(process.env.MONITORING_RUNTIME_DIR || resolve(root, 'monitoring/runtime'));
await mkdir(runtime, { recursive: true, mode: 0o700 });
await chmod(runtime, 0o700);
const tunnelRuntime = resolve(process.env.CLOUDFLARED_RUNTIME_DIR || resolve(root, '.runtime'));
await mkdir(tunnelRuntime, { recursive: true, mode: 0o700 });
await writeFile(resolve(runtime, 'cloudflared-logrotate.conf'), `${JSON.stringify(resolve(tunnelRuntime, 'cloudflared.log'))} {
  size 5M
  rotate 2
  compress
  copytruncate
  missingok
  notifempty
}
`, { mode: 0o600 });
const env = parse(await readFile(process.env.APP_ENV_FILE || resolve(root, 'backend/.env')));
const db = new URL(env.DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(db.hostname)) throw new Error('This setup expects the existing local PostgreSQL server.');
const writeSecret = async (name, value, mode = 0o600) => {
  const file = resolve(runtime, name);
  try { await access(file); } catch { await writeFile(file, value, { mode, flag: 'wx' }); }
};
await writeSecret('grafana_admin_password', randomBytes(24).toString('hex') + '\n', 0o644);
const postgresEnv = { POSTGRES_USER: decodeURIComponent(db.username), POSTGRES_PASSWORD: decodeURIComponent(db.password), POSTGRES_DB: db.pathname.slice(1) };
// JSON quoting is supported in Compose env files and prevents accidental expansion.
await writeSecret('postgres.env', Object.entries(postgresEnv).map(([k,v]) => `${k}=${JSON.stringify(v)}`).join('\n')+'\n');
await writeSecret('monitor_password', randomBytes(24).toString('hex'));
const password = (await readFile(resolve(runtime, 'monitor_password'), 'utf8')).trim();
if (!/^[a-f0-9]{48}$/.test(password)) throw new Error('Invalid monitoring credential file');
const prisma = new PrismaClient({ datasourceUrl: env.DATABASE_URL });
try {
  await prisma.$executeRawUnsafe(`DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'secure_cloud_monitor') THEN CREATE ROLE secure_cloud_monitor LOGIN; END IF; END $$`);
  await prisma.$executeRawUnsafe(`ALTER ROLE secure_cloud_monitor PASSWORD '${password}'`);
  await prisma.$executeRawUnsafe('GRANT pg_monitor TO secure_cloud_monitor');
} finally { await prisma.$disconnect(); }
const exporter = new URL(env.DATABASE_URL);
exporter.username = 'secure_cloud_monitor'; exporter.password = password;
exporter.search = '?sslmode=disable';
await writeFile(resolve(runtime, 'postgres-exporter.env'), `DATA_SOURCE_NAME=${JSON.stringify(exporter.toString())}\n`, { mode: 0o600 });
for (const volume of ['self-cloud-prj_postgres_data', 'self-cloud-prj_redis_data']) {
  execFileSync('docker', ['volume', 'inspect', volume], { stdio: 'ignore' });
}
console.log('Monitoring credentials prepared; existing database volumes verified. No credentials printed.');

}
prepare().catch(() => {
  console.error("Monitoring setup failed. Check database access, role-administration permissions, expected volumes, and runtime directory permissions. Sensitive error details were omitted.");
  process.exitCode = 1;
});
