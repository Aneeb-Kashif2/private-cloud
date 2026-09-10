#!/usr/bin/env node
// Explicit live verification: creates only a temporary account and test file,
// then cleans up that account and its owned test bytes, including on failure.
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { parse } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { createLocalStorage } from '../../backend/dist/src/lib/storage.js';
const email = `monitoring-${randomBytes(12).toString('hex')}@example.invalid`;
const password = `Aa1!${randomBytes(20).toString('hex')}`;
const env = parse(await readFile(process.env.APP_ENV_FILE || 'backend/.env'));
const prisma = new PrismaClient({ datasourceUrl: env.DATABASE_URL });
const storage = await createLocalStorage(env.STORAGE_PATH || '/srv/secure-cloud-storage');
try {
  const source = (await readFile('scripts/smoke-http.mjs', 'utf8'))
    .replaceAll('smoke@example.com', email).replaceAll('SmokeTestPass1!', password)
    + '\nawait request("/auth/logout", "POST");\n';
  const result = spawnSync(process.execPath, ['--input-type=module'], {
    input: source, encoding: 'utf8', timeout: 120_000,
    env: { ...process.env, SMOKE_API: 'http://127.0.0.1:8080', SMOKE_WEB: 'http://127.0.0.1:8080' },
  });
  if (result.status !== 0) throw new Error(`Live smoke test failed: ${result.stderr || result.stdout}`);
  process.stdout.write(result.stdout);
} finally {
  const user = await prisma.user.findUnique({ where: { email }, include: { files: true } });
  if (user) {
    for (const file of user.files) await storage.remove(file.storageKey);
    await prisma.user.delete({ where: { id: user.id } });
  }
  await prisma.$disconnect();
  console.log('Temporary live verification account and files removed.');
}
