# Nginx and mobile access through Cloudflare Quick Tunnel

Your command `cloudflared tunnel --url http://localhost:3000` creates a **Quick Tunnel**, not DNS proxying with router port forwarding. Cloudflare supplies a temporary HTTPS hostname. For the Nginx setup, use:

```bash
cloudflared tunnel --url http://localhost:8080
```

Keep that command running and open the generated `https://...trycloudflare.com` URL on your phone. No router port forwarding or local TLS certificate is needed for this tunnel. The temporary hostname changes when a new Quick Tunnel is created.

## Verified current status

At approximately **20:23 PKT on 6 September 2026**, Nginx, frontend and backend containers were healthy; the Prisma migration job exited with code 0. Existing PostgreSQL/Redis containers were healthy. Nginx returned 200 for `/login`, 401 for unauthenticated `/api/files`, and API health reported Redis `ready`. No running `cloudflared` process was observed, so the tunnel must be started separately. Public HTTPS/mobile access was not tested in this documentation update.

## Request flow

```text
Phone → HTTPS Cloudflare URL → cloudflared → Nginx :8080
                                           ├─ /api/* → Fastify :4000
                                           └─ /*     → Next.js :3000
```

The browser uses **`/api`**, so it calls the same public hostname it used to open the page. It never calls `localhost:4000` on your phone. Nginx preserves `/api`, forwards host/protocol headers, supports WebSocket upgrades, disables API caching and upload buffering, and permits request bodies up to 5 GiB. It does not expose the filesystem directory.

## Start the stack

The existing PostgreSQL/Redis services must remain running and `/srv/secure-cloud-storage` must exist with the app user's ownership. Stop standalone frontend/backend processes occupying ports 3000 and 4000 before starting containers.

```bash
# From the repository root; current backend/.env supplies PostgreSQL/Redis/auth settings.
export NEXT_PUBLIC_API_URL=/api
export APP_UID=$(id -u)
export APP_GID=$(id -g)
docker compose up -d --build --wait --wait-timeout 120
cloudflared tunnel --url http://localhost:8080
```

For an already running host backend/frontend, start just Nginx:

```bash
docker compose up -d --no-deps nginx
```

Open the tunnel's HTTPS URL for login. Production cookies are Secure and should stay that way; plain HTTP LAN access is not equivalent to HTTPS tunnel access. Sign in again when the temporary tunnel hostname changes, since cookies belong to the previous hostname.

The Next.js development server also rewrites `/api/*` to the local backend, so the old tunnel command pointing to port 3000 can still work after restarting/rebuilding the frontend. Port 8080 is the entry point that actually uses Nginx.

## Requested wildcard CORS

`FRONTEND_ORIGIN=*` is configured in the local backend environment and templates. It means “accept any valid HTTP(S) origin.” With cookie authentication, browsers reject a literal `Access-Control-Allow-Origin: *`. Fastify instead echoes the request's origin and sends `Access-Control-Allow-Credentials: true` plus `Vary: Origin`. OPTIONS preflights and the state-changing request origin guard use the same policy. Invalid/opaque origins such as `null` remain rejected. Authentication and per-user authorization are unchanged.

This broad setting permits other web origins to request credentialed access when browser cookie policies allow it. For a stable public hostname, you can restrict `FRONTEND_ORIGIN` to that hostname again. The same-origin Nginx path avoids needing cross-site cookies; `SameSite=Lax` has not been weakened.

CORS headers are added by Fastify only. Do not add a second wildcard CORS header in Cloudflare or Nginx: conflicting/duplicate headers can make otherwise valid responses fail.

## Configuration and rebuilds

- `frontend/lib/api.ts` defaults to `/api`.
- Root `.env` and `.env.example` use `NEXT_PUBLIC_API_URL=/api`.
- Frontend Docker builds and GitHub Actions default to `/api`; if a GitHub repository variable already contains an old localhost API URL, change it to `/api`.
- `backend/.env` uses `FRONTEND_ORIGIN=*`. For manual GitHub deployment, make the same setting in `/etc/secure-cloud/backend.env` on the server.
- `deploy/nginx/default.conf` is mounted read-only into the Nginx service.
- If frontend browser code was already built with an absolute localhost API URL, rebuild the frontend image. Changing a runtime environment variable cannot change an existing browser bundle.

After editing the Nginx configuration:

```bash
docker compose exec nginx nginx -t
docker compose exec nginx nginx -s reload
```

## Verification

```bash
curl -i http://localhost:8080/health
curl -i -X OPTIONS http://localhost:8080/api/files/upload \
  -H 'Origin: https://example.trycloudflare.com' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type'
```

The preflight should return 204, echo the example origin and allow credentials. `/api/files` without a session should return 401: that demonstrates routing is working while authentication is enforced.

A Cloudflare 413 response for a large file is **not a CORS problem**. Cloudflare imposes its own plan/zone request-body limits; Nginx's 5 GiB limit and the application's quota cannot override them. This app sends each file in a single HTTP request and does not currently split uploads into resumable chunks.

References: [credentialed CORS rules](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS), [Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/), [Cloudflare upload limits](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/4xx-client-error/error-413/), [Nginx proxy module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html).
