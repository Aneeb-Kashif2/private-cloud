# WhatsApp tunnel notifications

The native scripts start a Quick Tunnel to Nginx on port 8080, wait for its public
`/health` endpoint, then submit the URL and health status to Meta's WhatsApp Cloud
API. They do not modify application authentication or local file storage.

Requirements: Ubuntu, Node 22+, project dependencies (`npm ci`), cloudflared,
curl, and `flock` (util-linux). Configure these values in the root `.env`:

```dotenv
WHATSAPP_ACCESS_TOKEN=your-meta-access-token
WHATSAPP_PHONE_NUMBER_ID=your-numeric-meta-phone-number-id
WHATSAPP_RECIPIENT=923001234567
WHATSAPP_API_VERSION=v23.0
# Optional approved template for proactive notifications:
WHATSAPP_TEMPLATE_NAME=secure_cloud_tunnel
WHATSAPP_TEMPLATE_LANGUAGE=en_US
```

Use a token authorized to send messages for the configured Meta phone-number ID.
The recipient must be eligible for your Meta account; development/test numbers
may restrict recipients. Real credentials must never be committed. Environment
variables override values in the file; `ENV_FILE` selects another file.

Without `WHATSAPP_TEMPLATE_NAME`, the sender uses a free-form text message, which
requires an open customer-service messaging window. For proactive notifications,
configure an approved template with exactly two positional **body** parameters:
`{{1}}` is the full tunnel URL and `{{2}}` is `HTTP 200 (OK)`. Its name and language
must match the approved Meta template. Templates with required header/button or
named parameters need a different payload and are not supported by this helper.
See [Meta's template payload reference](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/messages/template/).

```bash
bash scripts/start-cloudflare.sh
bash scripts/stop-cloudflare.sh
```

The tunnel survives closing the terminal. Start and stop share an exclusive lock;
stop checks the recorded PID, process start time, boot identity, executable name
and owner before signaling it. A PID file from the older implementation has no
identity record: if its process is still running, inspect and stop that specific
legacy tunnel manually before using these scripts. Do not delete PID files to
bypass a running-process warning or start the optional Docker tunnel alongside it.

A notification failure leaves a healthy tunnel running. Retry the notification
without creating another tunnel:

```bash
node scripts/notify-whatsapp.mjs send .env .runtime/cloudflare-url
```

For a custom `RUNTIME_DIR` or `ENV_FILE`, use their actual paths in that command.
The sender checks public health again before submitting. It reports HTTP status
and a numeric Meta error code without printing raw responses or credentials.
A successful response means Meta **accepted** the message, not that WhatsApp
confirmed delivery; delivery status webhooks are not implemented. Network timeouts
are not automatically retried because Meta might already have accepted the message.

Alloy continues reading `.runtime/cloudflared.log`. The new identity and lock files
are local runtime state and are not collected. If `RUNTIME_DIR` changes, keep
Compose's `CLOUDFLARED_RUNTIME_DIR` aligned with it.

This update was reviewed from source only: no tests, tunnel startup, API calls,
or WhatsApp messages were executed.
