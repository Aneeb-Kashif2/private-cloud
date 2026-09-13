# Split EC2 / Ubuntu deployment

**Current repository state:** the split deployment manifests are implemented but are
not running automatically and have not replaced the existing root Compose stack. The
root `compose.yaml` remains the rollback/development single-host deployment. Use the
files in `deploy/ec2/` and `deploy/ubuntu/` for the two-machine production topology.

## What changed from the previous single-host deployment

Previously, one root Compose project started Next.js, Fastify, Nginx, PostgreSQL,
Redis, the migration job and (through an include) the monitoring stack on the Ubuntu
laptop. Its Nginx sent both pages and `/api` to localhost services, and the documented
public access path was a temporary Quick Tunnel.

The checked-in split change adds:

- `deploy/ec2/docker-compose.yml`: frontend, public-edge Nginx and an optional named `cloudflared` service only.
- `deploy/ec2/nginx/default.conf.template`: `/` to local Next.js and `/api/*` over the configurable Ubuntu Tailscale MagicDNS hostname.
- `deploy/ubuntu/docker-compose.yml`: PostgreSQL, Redis, Prisma migration, Fastify and private-side Nginx only.
- `deploy/ubuntu/nginx/default.conf`: `/api/*` and `/health` to local Fastify; no frontend or public tunnel.
- Separate EC2 and Ubuntu environment examples so backend/database/Redis/storage secrets stay on Ubuntu.
- Named Cloudflare Tunnel token-file configuration; Quick Tunnel scripts remain legacy/development only.
- `.github/workflows/deploy-split.yml` with independent EC2 and Ubuntu self-hosted runner jobs.

Application code, Prisma models, authentication, quota enforcement, local filesystem
storage, upload/download behavior and relative `/api` URLs were not redesigned.
Monitoring is no longer part of either split application Compose file; run it
independently only when needed. The existing root stack and monolithic workflow remain
available during migration and rollback.

Production uses two machines. EC2 runs the public web edge; the Ubuntu laptop remains the data plane:

```text
Browser -> Cloudflare named Tunnel -> EC2 Nginx
                                      | / -> Next.js :3000
                                      ` /api/* -> Tailscale MagicDNS -> Ubuntu Nginx :8080 -> Fastify :4000
                                                                     -> PostgreSQL / Redis / /srv/secure-cloud-storage
```

The browser keeps `NEXT_PUBLIC_API_URL=/api`, so cookies and API requests remain same-origin. PostgreSQL, Redis and Fastify are never published publicly. Monitoring is separate from both application Compose files and is opt-in.

### Current service ownership

| Machine | Services | Data kept there |
| --- | --- | --- |
| EC2 | `frontend`, `nginx`, optional `cloudflared` | Next.js runtime/build output and tunnel token file only |
| Ubuntu laptop | `postgres`, `redis`, `migrate`, `backend`, `nginx` | PostgreSQL/Redis volumes, backend secrets, metadata and `/srv/secure-cloud-storage` |
| Optional monitoring host/Ubuntu | Prometheus, Grafana, Loki, Alloy, exporters | Monitoring data only; not required by the app |

## Ubuntu laptop

Install and authenticate Tailscale, enable MagicDNS, and choose a stable hostname such as `ubuntu-secure-cloud.<tailnet>.ts.net`. The Tailscale ACL should allow only the EC2 node to reach TCP 8080 on the laptop. Do not expose 8080, 4000, 5432 or 6379 through the router or public firewall.

Copy `deploy/ubuntu/.env.example` to an untracked `deploy/ubuntu/.env`, copy `backend.env.example` to `backend.env`, and provide the existing PostgreSQL credentials in `postgres.env`. Set the real database password, random `AUTH_SECRET`, and exact public frontend origin in the backend file. Keep all three files root-readable only. Ensure the storage path exists with ownership matching `APP_UID`/`APP_GID`.

```bash
sudo install -d -m 0700 /srv/secure-cloud-storage
cd deploy/ubuntu
docker compose --env-file .env up -d postgres redis
docker compose --env-file .env run --rm migrate
docker compose --env-file .env up -d backend nginx
docker compose ps
curl http://127.0.0.1:8080/health
```

The Ubuntu Compose file uses existing external PostgreSQL and Redis volume names by default. Verify those names before starting it; never start two PostgreSQL or Redis containers against the same volume. Run the root-only backup/restore scripts from the repository checkout as documented in `deploy/BACKUP_RESTORE.md`.

The Ubuntu Nginx listener is intentionally the Tailscale/private-side hop. Enforce
that boundary with the host firewall and Tailscale ACLs: allow TCP 8080 from the EC2
Tailscale identity only, keep Fastify on the host's internal listener, and keep
PostgreSQL/Redis bound to `127.0.0.1`.

## EC2

Install Docker Compose and Tailscale, authenticate the instance, and confirm it can resolve and reach the Ubuntu MagicDNS name:

```bash
tailscale ping ubuntu-secure-cloud.<tailnet>.ts.net
curl http://ubuntu-secure-cloud.<tailnet>.ts.net:8080/health
```

Copy `deploy/ec2/.env.example` to an untracked `deploy/ec2/.env`, set the Ubuntu MagicDNS hostname, and store the named Cloudflare tunnel token in the root-readable file referenced by `CLOUDFLARE_TUNNEL_TOKEN_FILE` (mode 0600). This file contains no backend, database, Redis, storage or authentication secret.

```bash
cd deploy/ec2
docker compose --env-file .env up -d frontend nginx
docker compose --env-file .env --profile cloudflare up -d cloudflared
docker compose ps
```

EC2 exposes only its Nginx/Cloudflare edge. Do not publish port 3000 directly to
the internet; the frontend container listens on host networking for the local Nginx
hop. The Cloudflare hostname is configured in Zero Trust and is not generated by the
repository.

The EC2 Nginx template is rendered by the official Nginx image using `UBUNTU_TAILSCALE_HOST`. It preserves query strings, cookies, methods and request bodies, disables buffering for API uploads/downloads, and allows the existing 5 GiB upload behavior. Cloudflare terminates browser HTTPS at the named tunnel; the EC2-to-Ubuntu hop is private Tailscale traffic.

## Named Cloudflare Tunnel

Create a named tunnel in Cloudflare Zero Trust, attach a public hostname to it, and set its origin service to `http://127.0.0.1:8080` on EC2. Store the tunnel token only in the EC2 environment file or a Docker secret. `deploy/ec2/cloudflared/config.yml.example` shows the equivalent credentials-file configuration. Do not use `cloudflared tunnel --url ...` or a `trycloudflare.com` Quick Tunnel for production; the existing native Quick Tunnel scripts are retained only for development/legacy operation and are not part of this split deployment.

Set backend `FRONTEND_ORIGIN` to the exact named-tunnel HTTPS origin. Same-origin requests normally do not require CORS, but this keeps Fastify's existing Origin guard explicit and secure. Never put the tunnel token, database URL, Redis URL or `AUTH_SECRET` in `NEXT_PUBLIC_*` variables.

## Independent image delivery

The backend and frontend are built and published as separate GHCR images. Deploy the backend image only on Ubuntu and the frontend image only on EC2:

```bash
# Ubuntu
docker compose --env-file deploy/ubuntu/.env -f deploy/ubuntu/docker-compose.yml pull backend
docker compose --env-file deploy/ubuntu/.env -f deploy/ubuntu/docker-compose.yml run --rm migrate
docker compose --env-file deploy/ubuntu/.env -f deploy/ubuntu/docker-compose.yml up -d backend nginx

# EC2
docker compose --env-file deploy/ec2/.env -f deploy/ec2/docker-compose.yml pull frontend
docker compose --env-file deploy/ec2/.env -f deploy/ec2/docker-compose.yml up -d frontend nginx
```

The optional split deployment workflow is `.github/workflows/deploy-split.yml`. It expects separate self-hosted runner labels and pre-provisioned environment files; it does not copy secrets between machines. The existing monolithic workflow remains available for rollback until the split hosts are accepted.

## Optional monitoring

Do not include `monitoring/compose.yaml` from either production application Compose file. If monitoring is needed, run it independently on Ubuntu with its prepared runtime secrets, or on a dedicated monitoring host. Its exporters must target private Ubuntu services and Grafana must remain protected. Monitoring is not required for application startup.

## Verification

Before changing running services:

```bash
docker compose --env-file .env config --quiet
docker compose config --images
```

Where Nginx is installed on a host, run `sudo nginx -t`. For the EC2 container, render the template through Compose and run `docker exec <nginx-container> nginx -t`. Verify EC2 `/login`, EC2 `/health`, authenticated `/api/auth/me`, a small upload/download/delete, and that Ubuntu's Fastify port is reachable only from Tailscale. PostgreSQL and Redis must remain bound to `127.0.0.1`.
