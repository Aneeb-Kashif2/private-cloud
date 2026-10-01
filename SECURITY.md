# Security policy

## Supported versions

Only the `main` branch is supported. Secure Cloud is a self-hosted single-operator
deployment, so there are no long-term support branches or backports.

## Reporting a vulnerability

Do **not** open a public issue for a security problem.

Report it privately through **GitHub Security Advisories**
(*Security → Report a vulnerability* on this repository), including:

- the affected route, file or configuration,
- reproduction steps or a proof of concept,
- the impact you believe it has (for example: read another user's file, exceed quota,
  reach a private service),
- any suggested fix.

**Expected response:** acknowledgement within 3 working days, an assessment within 7
working days, and a coordinated disclosure once a fix is available.

Please do not run automated scanners against a deployment you do not own, do not attempt
denial of service, and do not access, modify or exfiltrate other people's data while
testing.

## Scope

In scope:

- Authentication and session handling (`backend/src/plugins/auth.ts`,
  `backend/src/modules/auth/routes.ts`)
- Storage path handling and file I/O (`backend/src/lib/storage.ts`)
- Access-control bypass between users (files, folders, shares)
- Quota-accounting bypass or corruption
- Public share-token handling (`backend/src/modules/shares/routes.ts`)
- Container, Compose, Nginx and Terraform configuration in this repository

Out of scope:

- Findings that require an already-compromised host, root access, or a malicious
  operator (for example: reading `/srv/secure-cloud-storage` directly)
- Missing hardening that is documented as a known limitation
- Reports produced only by a scanner, without a demonstrated impact
- Social engineering, physical access, and third-party services (Cloudflare, Tailscale,
  Meta WhatsApp API, Docker Hub, GHCR)

## Security controls, in one place

This project is built to be defensible. The controls below are implemented and, where
possible, covered by tests:

| Area | Control |
|---|---|
| Passwords | Argon2id hashing; 12+ characters with upper, lower, digit and symbol |
| Sessions | Opaque 32-byte token; only its SHA-256 hash is stored; `HttpOnly`, `SameSite=Lax`, `Secure` in production; server-side revocation |
| Authorisation | Ownership (`userId`) is part of every query, so foreign IDs return 404 rather than leaking existence |
| Quota | Atomic SQL reservation (`used + reserved + size <= limit`), streamed byte verification, transactional commit, cleanup on failure |
| File I/O | Strict UUID v4 storage keys, `O_EXCL`, `O_NOFOLLOW`, mode `0600`, `realpath`-checked storage root |
| Share links | Only a SHA-256 token hash is stored; atomic download-limit claiming; owner revocation; one generic error for every failure mode |
| Input | Zod validation on every body, query and param; stable machine-readable error codes |
| Transport | Credentialed CORS without a literal wildcard, plus an Origin guard on state-changing methods |
| Secrets | Generated locally with the OS CSPRNG, mode `0600`, never committed and never printed; no secret in any `NEXT_PUBLIC_*` variable |
| Containers | Non-root user, `cap_drop: [ALL]`, `no-new-privileges`, read-only config mounts |
| Network | PostgreSQL, Redis, metrics and monitoring bind to `127.0.0.1`; only Nginx is reachable |
| Privacy | No user ID, filename, URL or token ever becomes a metric label, log field or Nginx log value |
| Supply chain | Images built once, smoke-tested, then deployed by immutable digest |

## Known limitations (not vulnerabilities)

These are documented gaps rather than secrets: there is no virus or content scanning, no
recoverable trash, no per-IP account lockout beyond rate limits, and no automatic
scheduled backup. See the limitations table in `INTERVIEW_GUIDE.md` and
`CURRENT_ARCHITECTURE_AND_FLOW.md` for the full, honest list.
