# Docker and GitHub Actions deployment

The Ubuntu laptop remains the server. Compose runs the application containers and Nginx, uses Linux host networking to reach the existing PostgreSQL and Redis services through host ports, and bind-mounts `/srv/secure-cloud-storage` into the API at the identical path. Uploaded bytes use no named Docker volume or external file storage. The older PostgreSQL and Redis containers currently use their existing named volumes; this Compose file does not manage those containers or volumes. File metadata remains in the existing PostgreSQL database.

## Run containers on Ubuntu

Install Docker Engine with the Compose v2+ plugin. The current deployment already has PostgreSQL and Redis in older containers exposing ports 5432 and 6379. Keep them running. On a fresh host, provision PostgreSQL and Redis separately and configure their connection URLs before starting this Compose stack. Back up the existing database and files before first deployment.

```bash
# Use the UID/GID that already owns uploaded files. Do not recursively change existing ownership.
id -u
id -g
sudo install -d -m 0700 -o "$(id -u)" -g "$(id -g)" /srv/secure-cloud-storage
sudo install -d -m 0750 -o "$(id -u)" -g "$(id -g)" /etc/secure-cloud
install -m 0600 deploy/backend.env.example /etc/secure-cloud/backend.env
# Edit the above file with the real PostgreSQL/Redis connections,
# a strong AUTH_SECRET and the HTTPS frontend origin.
```

`DATABASE_URL` and `REDIS_URL` use `127.0.0.1` because these Linux containers share the host network. Database passwords containing URL-special characters must be percent-encoded. Use the database containing the current file metadata, not a fresh empty one.

Stop your native frontend/backend dev or production processes before starting Compose; the containers use the same ports 3000 and 4000. PostgreSQL and Redis continue running.

```bash
export APP_ENV_FILE=/etc/secure-cloud/backend.env
export APP_UID=$(id -u)
export APP_GID=$(id -g)
export NEXT_PUBLIC_API_URL=/api

docker compose build
docker compose up -d --wait --wait-timeout 120
docker compose ps
docker compose logs --tail=100 nginx backend frontend migrate
```

The migration container must succeed before the API starts; the frontend waits for API health, and Nginx waits for both application containers. The API drains in-flight requests on shutdown; Compose allows up to five minutes before forcing it to stop. Schedule deployments outside long uploads, and follow the main README recovery procedure after a forced shutdown. Both application containers run without root privileges. The storage bind mount refuses to create a missing host directory. UID/GID must match the existing file owner. Keep the same exported settings for subsequent Compose commands, or provide them through your local `.env` (never commit credentials).

Nginx is included on port 8080 with `/api/` routed to `127.0.0.1:4000` and other paths to `127.0.0.1:3000`. It allows 5 GiB bodies and streams API traffic without request buffering or proxy caching. The current mobile-access method is `cloudflared tunnel --url http://localhost:8080`: Cloudflare supplies public HTTPS, while Nginx receives local HTTP. No tunnel process was running in the latest runtime snapshot; Compose does not start one automatically.

Production cookies require the HTTPS access flow. The browser API base defaults to `/api`, so the temporary tunnel hostname does not require rebuilding images. An explicit API URL override is baked into the frontend and would require a rebuild to change. Cloudflare's own request-size limits still apply. Do not expose the uploaded-file directory as web content.

## GitHub setup

The checked-in workflow is `.github/workflows/pipeline.yml`.

1. In repository **Settings → Secrets and variables → Actions → Variables**, set `NEXT_PUBLIC_API_URL` to `/api` (also the workflow default). Optionally set `APP_UID` and `APP_GID` to the storage owner's IDs (default 1000).
2. Allow Actions to use `GITHUB_TOKEN` for package publication. GHCR authentication uses that token automatically; no registry password is stored in the repository. If packages already exist, grant this repository Actions access to them.
3. Push the changes to `main` or open a pull request. Pull requests run only on GitHub-hosted runners, with no publishing or deployment. Main builds publish two tested images: `ghcr.io/<owner>/<repo>-backend:<commit-sha>` and `ghcr.io/<owner>/<repo>-frontend:<commit-sha>`.
4. For deployment, register a **trusted private-repository** self-hosted runner on the Ubuntu laptop with labels `self-hosted`, `Linux`, `X64`, and `secure-cloud`. Its account needs Docker access and read access to `/etc/secure-cloud/backend.env`. Keep the laptop awake and connected. Do not attach this production runner to a public/untrusted repository; use manual Compose deployment there instead.
5. Create a GitHub environment named `production`, restrict it to `main`, and configure reviewers if your release process needs them.
6. Under **Actions → Secure-Cloud CI/CD → Run workflow**, choose `main` and enable `deploy`. This reruns validation, builds and tests both images, publishes them, then deploys their exact registry digests to the laptop. Ordinary pushes publish but do not redeploy the server.

The runner makes outbound connections to GitHub and GHCR. No SSH credentials, inbound SSH exposure, or server secrets in GitHub are needed. Deployment does not replace your host environment file.

## Pipeline stages

- Clean npm installation, Prisma generation and migrations against disposable PostgreSQL.
- Frontend/backend type-check, backend ESLint, all filesystem/database tests, and production builds.
- Multi-stage Docker builds with separate BuildKit caches, followed by real-container smoke tests using disposable PostgreSQL, Redis and a temporary host directory.
- Smoke tests exercise CORS preflights, page rendering, registration, upload, list, download, 5 GiB quota reporting and permanent deletion through a disposable Nginx container, followed by graceful backend shutdown.
- Publish only tested images on `main`, tagged by commit SHA; record immutable image digests for deployment.
- Optional manual deployment serializes releases, pulls images before stopping the app, applies migrations with writers stopped, and waits for container health. Migration or health failure fails the job. No automatic database rollback is attempted.

## Rollback and maintenance

Record both image digests from the deployment job summary. For a compatible application rollback, set `BACKEND_IMAGE` and `FRONTEND_IMAGE` to the earlier digest references, keep the host environment and UID/GID settings, then run:

```bash
docker compose pull
docker compose up -d --no-build --no-deps --wait backend frontend nginx
```

This does not reverse schema migrations. Restore a coordinated database/files backup or use a forward fix when the earlier application is incompatible with the migrated schema. `docker compose down` removes application containers, leaving host PostgreSQL, Redis and uploaded files intact.

Run the exact container checks locally without touching real application data:

```bash
docker build -f backend/Dockerfile -t secure-cloud-backend:ci .
docker build -f frontend/Dockerfile -t secure-cloud-frontend:ci .
bash scripts/smoke-containers.sh
```

References: [Docker's GitHub Actions integration](https://docs.docker.com/build/ci/github-actions/), [Next.js standalone output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output), and [GitHub runner security](https://docs.github.com/en/actions/reference/security/secure-use).

Nginx is now included on port 8080. For the configured Cloudflare Quick Tunnel flow, use [Nginx and Cloudflare](NGINX_CLOUDFLARE.md).
