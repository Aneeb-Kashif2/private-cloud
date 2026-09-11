#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { parse } from 'dotenv';

async function main() {
  const [mode, envFile, urlFile] = process.argv.slice(2);
  if (!['check', 'send'].includes(mode) || !envFile || (mode === 'send' && !urlFile)) {
    throw new Error('Usage: node scripts/notify-whatsapp.mjs check ENV_FILE | send ENV_FILE URL_FILE');
  }
  let config;
  try { config = { ...parse(await readFile(envFile)), ...process.env }; }
  catch { throw new Error('Cannot read WhatsApp environment file.'); }
  const token = config.WHATSAPP_ACCESS_TOKEN?.trim();
  const phone = config.WHATSAPP_PHONE_NUMBER_ID?.trim();
  const recipient = config.WHATSAPP_RECIPIENT?.trim().replace(/^\+/, '');
  const version = config.WHATSAPP_API_VERSION || 'v23.0';
  const template = config.WHATSAPP_TEMPLATE_NAME?.trim();
  const language = config.WHATSAPP_TEMPLATE_LANGUAGE || 'en_US';
  if (!token || token.startsWith('replace-') || /\s/.test(token)) throw new Error('Set a valid WHATSAPP_ACCESS_TOKEN.');
  if (!/^\d+$/.test(phone || '')) throw new Error('WHATSAPP_PHONE_NUMBER_ID must be the numeric Meta phone-number ID.');
  if (!/^[1-9]\d{6,14}$/.test(recipient || '')) throw new Error('WHATSAPP_RECIPIENT must include the country code, without spaces.');
  if (!/^v\d+\.\d+$/.test(version)) throw new Error('Invalid WHATSAPP_API_VERSION.');
  if (template && !/^[a-z0-9_]+$/.test(template)) throw new Error('Invalid WHATSAPP_TEMPLATE_NAME.');
  if (!/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(language)) throw new Error('Invalid WHATSAPP_TEMPLATE_LANGUAGE.');
  if (mode === 'check') return;
  let url;
  try { url = new URL((await readFile(urlFile, 'utf8')).trim()); }
  catch { throw new Error('Cannot read a valid tunnel URL.'); }
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.trycloudflare\.com$/.test(url.hostname) || url.port || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('URL file must contain a Cloudflare Quick Tunnel HTTPS origin.');
  }
  try {
    const health = await fetch(`${url.origin}/health`, { signal: AbortSignal.timeout(10000), redirect: 'error' });
    if (health.status !== 200) throw new Error();
    await health.body?.cancel();
  } catch { throw new Error('Tunnel health check failed; no WhatsApp request sent.'); }
  const payload = { messaging_product: 'whatsapp', to: recipient, ...(template ? {
    type: 'template', template: { name: template, language: { code: language }, components: [
      { type: 'body', parameters: [{ type: 'text', text: url.origin }, { type: 'text', text: 'HTTP 200 (OK)' }] },
    ] },
  } : { type: 'text', text: { preview_url: false, body: `Secure Cloud Quick Tunnel: ${url.origin}\nHealth: HTTP 200 (OK)` } }) };
  let response;
  try {
    response = await fetch(`https://graph.facebook.com/${version}/${phone}/messages`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch { throw new Error('WhatsApp request failed or timed out; delivery is unknown. No automatic retry was made to avoid duplicates.'); }
  const result = await response.json().catch(() => null);
  if (!response.ok || typeof result?.messages?.[0]?.id !== 'string') {
    // Never print raw provider responses: they can contain personal data.
    const code = Number.isInteger(result?.error?.code) ? result.error.code : 'unknown';
    throw new Error(`WhatsApp rejected the notification (HTTP ${response.status}, code ${code}). Check token permissions, recipient eligibility, and an approved template for notifications outside the messaging window.`);
  }
  console.log('WhatsApp accepted the notification. Delivery is not confirmed without a status webhook.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
