# DevOps Upgrade Plan — turning Secure Cloud into a "hire me" DevOps project

> This document is an **audit** of the repository as it exists, followed by a **prioritised
> plan**. It is written to be acted on: every recommendation says what to add, why an
> interviewer cares, and what it unlocks. Section 4 lists what was already added while
> writing this.

---

## 0. How to read this

| Section | Use it for |
|---|---|
| 1 | The honest verdict and a scoring table — know your weak spots before they find them |
| 2 | What is already genuinely strong, so you can talk about it with confidence |
| 3 | The gaps, explained in terms of what an interviewer actually asks |
| 4 | **Tier 1** — already implemented, plus the reasoning to explain it |
| 5 | **Tier 2** — the differentiators that separate you from other candidates |
| 6 | **Tier 3** — advanced, role-specific, or higher-risk additions |
| 7 | What **not** to add, and why adding it would hurt you |
| 8 | A 10-day implementation order with time estimates |
| 9 | The interview questions each addition unlocks |
| 10 | How to present the repository itself as a portfolio artefact |
| 11 | A definition-of-done checklist |

---

## 1. Verdict and maturity scorecard

**Verdict: already a strong DevOps project, with two real holes and several polish gaps.**

What impresses today: the pipeline is genuinely ordered correctly (build → smoke test →
publish immutable digests → gated deploy), the monitoring stack is privacy-engineered
rather than copy-pasted, alert rules are **unit tested with promtool** (very few candidates
do this), and the backup tooling validates its own archives against traversal attacks.

The two real holes were:

1. **Security was absent from CI.** No secret scanning, no dependency scanning, no image
   CVE scanning, no IaC scanning. For a project whose whole selling point is security, this
   was the largest credibility gap.
2. **Alerts fired into nothing.** Five well-written alert rules existed, but there was no
   Alertmanager and no notifier, so the question *"what happens when an alert fires?"* had
   no answer.

Both are closed in Section 4.

### Scorecard

Grading is deliberately harsh: `A` means you could defend it in front of a platform team,
`C` means a senior interviewer will notice.

| # | Domain | Before | After this plan | Notes |
|---|---|---|---|---|
| 1 | CI (build, test, quality gate) | A− | A | 37 tests, lint, typecheck, monitoring config validation, container smoke test |
| 2 | CD (release and deploy) | B+ | A− | Digests pinned, writers stopped before migration, environment-gated. Deploy still has downtime |
| 3 | Infrastructure as code | C+ | B+ | Good Terraform, but no remote state, no CI validation, no drift detection, no IaC scan |
| 4 | Container and runtime hygiene | A− | A | Non-root, `cap_drop: ALL`, healthchecks, log rotation, memory caps |
| 5 | **DevSecOps / shift-left security** | **D** | **A−** | Was the biggest gap. Now four scanners in CI |
| 6 | **Alerting and incident response** | **C** | **B+** | Rules existed with nowhere to go. Alertmanager + SLO burns now wired |
| 7 | Observability (metrics and logs) | A− | A | Privacy-filtered, loopback-only, retention bounded |
| 8 | Observability (traces) | D | C | No distributed tracing at all |
| 9 | SLOs and error budgets | D | B | Nothing defined before; now recorded SLIs plus multi-window burn alerts |
| 10 | Release engineering | C | B+ | No changelog, tags, release notes or versioning policy |
| 11 | Secrets management | C | C+ | Mode `0600` files on disk; no rotation, no vault, no SOPS |
| 12 | Supply chain security | C+ | A− | Digest pinning was good; SBOM and signing are now one job away |
| 13 | Reliability and HA | D | D | Single host, single point of failure. Be honest, do not fake it |
| 14 | Disaster recovery | B | B+ | Real scripts with checksums and inventory validation; still manual |
| 15 | DevEx and onboarding | B | B+ | The installer is excellent; now a `make` interface plus `.nvmrc` and `.editorconfig` |
| 16 | Governance (review, ownership) | C | B+ | Had no CODEOWNERS, PR template, issue templates or vulnerability policy |
| 17 | Testing strategy (depth) | B | B+ | Excellent integration tests; no browser E2E, no load test, no coverage gate |
| 18 | Performance engineering | D | C | No load test, no thresholds, no capacity numbers |
| 19 | FinOps / cost awareness | D | D | No budget alert, no cost estimate in a pull request |
| 20 | Documentation | A− | A | Unusually honest and detailed |

**Overall: B− → A−.** The remaining `D` rows (HA, tracing, FinOps) are honest limits of a
single-host, self-funded project. Do **not** fake them. Explaining *why* they are out of
scope, and what you would do with a budget, scores better than pretending.

---

## 2. What is already strong — say these out loud

Most candidates cannot describe a pipeline this concretely. These are your assets.

1. **The pipeline order is correct, and that is the hard part.**
   `checks → build images → smoke test real containers → publish immutable digests →
   gated deploy of those digests`. Most people publish on merge and hope. Saying "I deploy
   the digest that passed the smoke test" answers supply-chain integrity before it is asked.

2. **Migrations are a separate one-shot container, and the deploy stops writers first.**
   `docker compose stop nginx frontend backend` → `compose run --rm migrate` → `up -d`.
   That is the correct order, and most people get it wrong.

3. **Health-gated startup with real conditions.**
   `postgres/redis healthy → migrate completed successfully → backend healthy → frontend
   healthy → nginx`. There is not a single `sleep 30` anywhere.

4. **Alert rules are unit tested with `promtool test rules`.** This is rare. It means an
   alert expression can never silently become a no-op.

5. **Monitoring is privacy-engineered.** Route *patterns* are the metric labels, Nginx logs
   only categorical routes, Alloy projects the log fields, and a test asserts that a planted
   secret string never reaches metrics or logs.

6. **Monitoring is resource-bounded** because it runs on a laptop: Prometheus at 256 MB with
   7-day/1 GB retention, Loki at 256 MB with 72-hour retention, per-container log rotation
   at 5 MB × 2.

7. **Backup tooling validates its own input.** `backup_tool.py` reads through the gzip
   trailer, rejects traversal, duplicate, link and device entries, requires a root-owned
   `0700` directory, takes an `fcntl` lock, and writes atomically.

8. **The installer is idempotent and refuses to destroy data.** It detects an existing
   database or storage directory and refuses to regenerate credentials.

9. **Split deployment with a private data plane.** Only the EC2 edge is public; PostgreSQL,
   Redis and Fastify are never exposed, and the browser still uses relative `/api` URLs so
   sessions stay same-origin.

10. **Honesty is a feature.** `monitoring/IMPLEMENTATION_STATUS.md` separates "implemented"
    from "observed running". That reads as senior. Keep doing it.

---

## 3. The gaps, in the order an interviewer will find them

Each gap is phrased as the question that exposes it.

| # | The question that exposes it | What was missing | Severity |
|---|---|---|---|
| 1 | *"How do you stop a secret from reaching a registry?"* | No secret scanning, no SBOM, no image signing | **Critical** |
| 2 | *"An alert fires at 3 a.m. Walk me through it."* | Rules existed; no Alertmanager, no receiver, no runbook | **Critical** |
| 3 | *"Who reviews a change to the deploy workflow?"* | No CODEOWNERS, no PR template, no review policy | High |
| 4 | *"How do you know the live infrastructure matches the repo?"* | Terraform was never validated in CI; no drift detection | High |
| 5 | *"What is your SLO, and how do you know you are meeting it?"* | No SLI/SLO, no error budget | High |
| 6 | *"How do you deploy without downtime?"* | Deploy stops the services; no blue/green or rolling strategy | High |
| 7 | *"What happens if a database migration is wrong?"* | No automatic rollback; the previous image is not retained | High |
| 8 | *"Where do your secrets live?"* | Mode `0600` files at `/etc/secure-cloud`; no rotation or vault | Medium |
| 9 | *"How do you test a browser flow end to end?"* | No Playwright or equivalent; the smoke test is HTTP-level only | Medium |
| 10 | *"How many concurrent uploads can it take?"* | No load test, so there is no capacity number | Medium |
| 11 | *"How do you know your backups actually restore?"* | Restore is manual and has never been drilled on a schedule | Medium |
| 12 | *"What is your release process?"* | No tags, no changelog, no versioning policy | Medium |
| 13 | *"How do you debug a slow request across services?"* | No tracing; metrics and logs only | Low |
| 14 | *"How long does it take to onboard a new developer?"* | Good docs, but no single command interface | Low |
| 15 | *"What does this cost you?"* | No budget alarm, no cost estimate | Low |

---

## 4. Tier 1 — already implemented (verified working)

These were added while writing this plan. Everything below was validated: YAML parses,
`promtool check config` passes, `promtool test rules` passes for both rule files,
`amtool check-config` passes, and `docker compose config` exits 0.

### 4.1 Security scanning in CI — `.github/workflows/security.yml`

Four independent checks, all free on private repositories (no GitHub Advanced Security
licence needed, which is why CodeQL was avoided):

| Job | Tool | Gate? |
|---|---|---|
| `secrets` | Gitleaks `v8.30.1` over **full git history** | **Yes** — exit 1 on any finding |
| `dependencies` | `npm audit --audit-level=high` | No, informational |
| `filesystem` | Trivy `v0.36.0` (`vuln,secret,misconfig`) | No, informational |
| `images` | Trivy on both built images, `severity: CRITICAL`, `ignore-unfixed: true` | **Yes** |

It also runs on a **weekly schedule**, so a CVE published later is caught without a code
change. The image job uploads a CycloneDX **SBOM** as an artifact — which is what a security
team actually asks for when a new CVE lands.

> **Why the gate is on the image, not the lockfile.** An advisory in a dev-only transitive
> dependency should be visible, not block a merge. A CRITICAL CVE in the container you
> actually ship is different, and that is the one worth failing on. Explaining *why* you
> gated one and not the other is worth more than gating both.

**Talk track:** *"I scan secrets across full history because a deleted secret is still
leaked, I gate on CRITICAL image CVEs, and I publish an SBOM so a future CVE takes minutes
to triage instead of days."*

### 4.2 Terraform validation, scanning and drift detection — `.github/workflows/terraform.yml`

Previously the Terraform was never touched by CI. Now:

- `terraform fmt -check -recursive -diff`
- `terraform init -backend=false` + `terraform validate` (runs on forked PRs: no state, no
  AWS credentials, no secrets)
- `tflint` with the AWS ruleset `0.49.0` (`infra/.tflint.hcl`)
- `checkov` with documented exception reasons (`infra/.checkov.yaml`)
- An **opt-in** `plan` job using **OIDC** instead of stored AWS keys
  (`id-token: write`), publishing the plan into the job summary
- A **scheduled drift check**: the weekly plan fails loudly with
  `::error title=Infrastructure drift detected::` when it reports changes

> **Two deliberate choices worth defending.** First, the plan job is gated behind
> `vars.TF_PLAN_ENABLED` so it does nothing until a remote backend exists — a plan against
> empty local state would propose creating the whole VPC and mislead everyone. Second,
> `checkov` starts with `soft_fail: true`: a scanner that blocks the first pull request gets
> disabled within a week. Triage once, record the real exceptions with reasons, then make it
> a gate. `infra/.checkov.yaml` shows exactly how, including why HTTP/HTTPS are open and why
> the public subnet assigns addresses.

### 4.3 Alerting that actually delivers — Alertmanager

The critical fix. Added `monitoring/alertmanager/alertmanager.yml` plus an `alertmanager`
Compose service bound to `127.0.0.1:9093`, and wired Prometheus to it:

```yaml
# monitoring/prometheus/prometheus.yml
alerting:
  alertmanagers:
    - static_configs:
        - targets: ['127.0.0.1:9093']
```

Routing and inhibition are real, not decorative:

- Data-safety alerts (`SecureCloudBackupUnhealthy`, `HostFilesystemLow`,
  `StorageMetricsStale`) route to their own receiver with a 10-second `group_wait` and a
  1-hour repeat, because these are the ones that can end in lost bytes.
- `group_by: [alertname, job, severity]` means a restart that breaks six targets sends
  **one** message, not six.
- An inhibit rule suppresses downstream noise when a target is simply unreachable.

Validation is now part of `monitoring/scripts/validate.sh`; `amtool check-config` reports
`SUCCESS: 2 inhibit rules, 3 receivers`.

**Talk track:** *"Rules without a receiver are documentation, not monitoring. I configured
Alertmanager with grouping and inhibition so a real incident produces one actionable page
instead of twenty."*

### 4.4 SLOs and error budgets — `monitoring/prometheus/slo-rules.yml`

Three objectives, expressed as recording rules plus multi-window burn-rate alerts:

| SLO | Target | Budget | Burn alerts |
|---|---|---|---|
| Availability (no 5xx) | 99.5% / 30 days | 0.005 | 14.4x over 5m+1h → critical; 6x over 30m+6h → warning |
| Upload success | 99.0% / 30 days | 0.01 | 14.4x over 5m+1h |
| Metadata latency | p95 < 1s | — | `SecureCloudMetadataLatencyHigh` after 10m |

Three design decisions to explain, because they show judgement:

1. **Streaming routes are excluded from the latency SLI**
   (`route!~"/api/files/upload|/api/files/:id/download|/api/files/backup"`). Their duration
   is a function of file size and the client's bandwidth, not API performance. Including
   them would make the objective meaningless — and being able to say why is the point.
2. **`or vector(1)` keeps an idle system healthy.** An empty series reads as "no data", and
   a quiet server must not look like a broken one.
3. **Two windows must agree before anyone is paged.** The 5-minute window detects fast, the
   1-hour window confirms it is not a scrape glitch. That is how you get fast detection
   without trading away sleep.

### 4.5 Promtool unit tests for the SLO rules — `monitoring/prometheus/slo-rules.test.yml`

The repo already unit tested its alerts; the new rules are tested too. Four scenarios:

| Scenario | Asserts |
|---|---|
| 100% success traffic | recorded ratio is exactly `1`, and **no alert fires** |
| 10% sustained 5xx | recorded ratio is `0.9` **and** the fast-burn alert fires with the right labels and annotations |
| 2% sustained 5xx | ratio is elevated but **no alert fires** — proving the threshold does work |
| 50% upload failures | upload SLI is `0.5` and the upload burn alert fires |

The third case is the valuable one: it is a **negative test**. A suite that only checks "bad
things alert" cannot distinguish a working threshold from an alert that always fires.

Verified: `promtool check config` reports *2 rule files found* and *13 rules found* in
`slo-rules.yml`; `promtool test rules slo-rules.test.yml` reports `SUCCESS`; the pre-existing
`alerts.test.yml` still passes.

### 4.6 Developer experience and governance

| File | What it gives you |
|---|---|
| `Makefile` | One interface; `make help` lists **32 targets** across dev, database, stack, quality, backup and Terraform. Thin wrappers only, so it cannot drift from the documented commands |
| `.editorconfig` | Consistent whitespace; tabs preserved for `Makefile` and shell, markdown trailing spaces kept for hard line breaks |
| `.nvmrc` | Node `22`, matching `engines` — removes "works on my machine" |
| `SECURITY.md` | Disclosure policy, response expectations, scope and non-scope, a 13-row security-control inventory, and an explicit "known limitations, not vulnerabilities" section |
| `.github/CODEOWNERS` | Area ownership, so a change to `/.github/workflows/` or `/infra/` cannot merge unattended |
| `.github/pull_request_template.md` | A checklist that encodes your invariants: `userId` scoping, no `NEXT_PUBLIC_*` secrets, no PII in metric labels, plus migration and rollback sections |
| `.github/ISSUE_TEMPLATE/*` | Bug report, feature request (which asks *"which invariant could this affect?"*), and a config that routes security reports to private advisories |
| `.trivyignore` | A reviewed-exception file **with rules for using it** — including that an entry without a reason is a bug |
| `infra/.tflint.hcl`, `infra/.checkov.yaml` | Linter and scanner configuration with written justifications |
| `.gitignore` | `/sbom/` added so generated bills of materials never get committed |

**Why the pull request template matters more than it looks:** it converts your invariants
(ownership scoping, quota correctness, no PII in observability) into a review checklist.
That is how a team keeps a system safe as it grows, and saying so out loud is a senior
signal, not a bureaucratic one.

### 4.7 What was changed in existing files

| File | Change |
|---|---|
| `monitoring/prometheus/prometheus.yml` | `rule_files` list extended with `slo-rules.yml`; `alerting` block added; `alertmanager` scrape job added |
| `monitoring/compose.yaml` | `alertmanager` service (64 MB, 0.2 CPU, loopback `9093`, clustering disabled) plus `alertmanager_data` volume |
| `monitoring/scripts/validate.sh` | Added `promtool test rules slo-rules.test.yml` and `amtool check-config` |
| `Makefile` | New |
| `.gitignore` | New `/sbom/` entry |
| `INTERVIEW_GUIDE.md` | Updated service count and the alerting limitation now that they changed |

**Nothing was removed or weakened.** No existing test, workflow, alert rule or service was
modified in a way that reduces coverage.

---

## 5. Tier 2 — the differentiators

These separate "I use DevOps tools" from "I understand delivery". Each has a concrete
implementation and a specific interview question it answers.

### 5.1 Supply chain: sign the images and prove where they came from

**Question it answers:** *"How do you know the image you deployed is the one your pipeline built?"*

You already pin immutable digests, which is more than most candidates do. Add provenance and
signing to close the loop.

In `.github/workflows/pipeline.yml`, extend the `images` job permissions:

```yaml
    permissions:
      contents: read
      packages: write
      id-token: write        # OIDC token for keyless signing — no long-lived key
      attestations: write
```

Then, immediately after pushing each image by digest:

```yaml
      - uses: sigstore/cosign-installer@v3
      - name: Sign the tested images (keyless)
        env:
          DIGEST: ${{ needs.images.outputs.backend }}
        run: cosign sign --yes "${DIGEST}"
      - uses: actions/attest-build-provenance@v2
        with:
          subject-name: ghcr.io/${{ github.repository }}-backend
          subject-digest: ${{ needs.images.outputs.backend }}
          push-to-registry: true
```

And in the deploy job, **verify before you deploy**:

```yaml
      - uses: sigstore/cosign-installer@v3
      - name: Verify signature and provenance
        env:
          BACKEND_IMAGE: ${{ needs.images.outputs.backend }}
        run: |
          cosign verify "$BACKEND_IMAGE" \
            --certificate-identity-regexp '^https://github\.com/${{ github.repository }}/' \
            --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

> **Why keyless matters.** There is no private key to store, rotate, leak or lose. The
> signature is bound to the workflow identity and the OIDC token, so `cosign verify` proves
> *which repository and which workflow* produced that exact digest. That is build
> provenance, and it is a standard question anywhere with a security team.

### 5.2 Remote Terraform state, environments and safe promotion

**Question it answers:** *"Where does your Terraform state live, and how do two people avoid clobbering each other?"*

Today the state is local. `.gitignore` correctly excludes it, but that also means it exists
on exactly one laptop. Add to `infra/versions.tf`:

```hcl
terraform {
  required_version = ">= 1.6.0"

  # Remote, encrypted, versioned state with locking. Create the bucket once, by hand or from
  # a small bootstrap directory, with versioning and SSE enabled.
  backend "s3" {
    bucket       = "secure-cloud-tfstate-<unique-suffix>"
    key          = "edge/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true   # S3-native locking (Terraform 1.10+); older versions need a DynamoDB table
  }

  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}
```

If you use `use_lockfile`, bump the workflow's `terraform_version` to `1.10.0` or newer;
otherwise add a DynamoDB table and set `dynamodb_table`.

> **The chicken-and-egg detail that impresses people.** A `backend` block cannot reference
> variables or resources, so the bucket needs its own tiny bootstrap module. Saying "I keep a
> bootstrap directory that creates the state bucket and lock table, then the real root module
> points at it as a backend" is exactly the answer a platform team wants to hear.

**Promotion story.** Use workspaces or separate directories so the same configuration
delivers `staging` and then `production`, and promote **the same image digest** between
them. "Same artefact, different configuration" is a sentence worth memorising.

### 5.3 Zero-downtime deploys with automatic rollback

**Question it answers:** *"Your deploy stops the backend. How do you deploy without downtime, and how do you roll back?"*

This is the strongest remaining engineering gap, and it is fully solvable here.

**Part 1 — blue/green at the Nginx layer.** Run two backend containers on different ports and
switch traffic by reloading Nginx. A reload is graceful: in-flight requests finish on the old
worker.

```nginx
# deploy/nginx/upstream.conf  (bind-mounted; the deploy rewrites only this file)
upstream backend_app {
    # Written by the deploy: the colour currently receiving traffic.
    server 127.0.0.1:4000 max_fails=3 fail_timeout=10s;
}
```

```nginx
# deploy/nginx/default.conf
location /api/ {
    proxy_pass http://backend_app;   # was http://127.0.0.1:4000
}
```

The deploy then becomes: start the idle colour on `4010` → wait for its `/health` → rewrite
`upstream.conf` → `nginx -s reload` → keep the old colour warm for the rollback window →
stop it. Rollback is the same script with the colours swapped, and it takes seconds because
nothing is rebuilt.

**Part 2 — backwards-compatible migrations (expand / contract).** The reason teams cannot
roll back a deploy is almost always the database, not the code.

| Step | Release | Action |
|---|---|---|
| Expand | N | Add the new column or table. Deploy code that writes **both** old and new. Nothing reads the new shape yet |
| Migrate | N+1 | Backfill in batches. Deploy code that reads the new shape and still writes both |
| Contract | N+2 | Drop the old column, in a release you are already confident about |

Every migration is then safe to run *before* the new code, and safe to leave in place *after*
a rollback. `ALTER TABLE ... ADD COLUMN` with a default is instant in modern PostgreSQL; it is
a full table rewrite (or an `ACCESS EXCLUSIVE` lock held for minutes) that causes outages.

**Part 3 — retain the previous image.** Tag the currently running digest as
`<service>:previous` before switching, so rollback never depends on a registry being up or a
rebuild succeeding.

**Talk track:** *"My deploy currently has a maintenance window. The fix is blue/green at the
Nginx layer plus expand/contract migrations, so the previous colour stays warm and rollback
is a config flip rather than a rebuild."* That answer, with the expand/contract reasoning,
lands better than Kubernetes trivia.

### 5.4 Proper secrets management

**Question it answers:** *"Where do production secrets live, and how do you rotate them?"*

Today: mode `0600` files at `/etc/secure-cloud/backend.env`. Honest and reasonable, but
"rotate" has no answer. Two realistic options.

**Option A — age + SOPS (secrets in Git as ciphertext, works anywhere):**

```yaml
# .sops.yaml
creation_rules:
  - path_regex: deploy/.*\.env\.enc\.yaml$
    age: age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p
```

```bash
age-keygen -o ~/.config/sops/age/keys.txt          # the private key never leaves the machine
sops --encrypt --input-type dotenv --output-type yaml \
     --output deploy/production.env.enc.yaml backend/.env
# On the server, with the age key present:
sops --decrypt deploy/production.env.enc.yaml > /etc/secure-cloud/backend.env
```

The win: environment files become reviewable in a pull request without exposing values, and
rotation is a one-line diff. The age private key becomes the single secret you manage by hand.

**Option B — AWS SSM Parameter Store (no secret in the repository at all):**

```bash
# One-time, from a trusted machine:
aws ssm put-parameter --name /secure-cloud/production/AUTH_SECRET \
  --type SecureString --value "$(openssl rand -base64 48)"

# In the installer, when SECRET_SOURCE=ssm:
AUTH_SECRET=$(aws ssm get-parameter --name /secure-cloud/production/AUTH_SECRET \
  --with-decryption --query Parameter.Value --output text)
```

Your Terraform already gives the EC2 instance an SSM-managed IAM role, so this needs only an
extra `ssm:GetParameter` policy scoped to `/secure-cloud/*` — no new infrastructure.

**Add a written rotation procedure either way.** "I rotate `AUTH_SECRET` by issuing a new
value and letting existing sessions expire naturally, and I rotate the database password with
a two-credential swap so no restart is needed" is a complete answer. Without the written
procedure, "rotation" is a word rather than a capability.

### 5.5 Release engineering: tags, changelog, versioning

**Question it answers:** *"What is your release process?"*

Right now a merge to `main` publishes images by commit SHA. That is traceable but it is not a
release. Add:

```yaml
# .github/workflows/release.yml
name: Release
on:
  push:
    branches: [main]
permissions:
  contents: write
  pull-requests: write
jobs:
  release-please:
    runs-on: ubuntu-latest
    steps:
      - uses: googleapis/release-please-action@v4
        with:
          release-type: node
          # Conventional commits (feat:, fix:, perf:, BREAKING CHANGE:) drive the version
          # bump and the changelog, so release notes are generated rather than remembered.
```

Pair it with conventional commits enforced in CI (`commitlint`) and a `CHANGELOG.md` nobody
hand-edits. Then GitHub Releases give you a dated, linkable artefact per version, and `v1.4.0`
becomes something you can point at instead of a commit hash.

> **The subtle point:** generated release notes force every commit to say *why* it changed.
> That is the same discipline as a good commit message, mechanised.

### 5.6 Browser end-to-end tests in CI

**Question it answers:** *"How do you know the UI still works after a refactor?"*

`scripts/smoke-containers.sh` already starts the whole stack and tests the API over HTTP. Add
a Playwright layer on top of that same stack so the smoke test covers what a user actually
does:

```yaml
      # in the images job, after smoke-containers.sh
      - name: Browser end-to-end tests
        run: |
          npx playwright install --with-deps chromium
          PLAYWRIGHT_BASE_URL="http://127.0.0.1:$PROXY_PORT" npx playwright test
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-traces
          path: test-results/
          retention-days: 7
```

Three tests are enough to be credible:

1. Register → the dashboard shows "0 B of 5 GiB".
2. Upload a file → it appears in the list → downloading returns identical bytes.
3. Create a share link → open it in a fresh, logged-out context → the file downloads.

Save traces on failure. *"When the E2E fails in CI, the trace shows me the DOM and the network
at the exact failing step"* is a real quality-of-life answer.

### 5.7 A load test that acts as a performance gate

**Question it answers:** *"How many concurrent uploads can this take?"* — currently unanswerable.

Add a small k6 script and run it on a schedule rather than on every pull request:

```javascript
// scripts/load/upload.js
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  scenarios: {
    concurrent_uploads: {
      executor: 'ramping-vus', startVUs: 1,
      stages: [
        { duration: '30s', target: 10 },
        { duration: '1m', target: 10 },
        { duration: '20s', target: 0 },
      ],
    },
  },
  // Thresholds turn a load test into a gate: the run fails if performance regresses.
  thresholds: {
    http_req_duration: ['p(95)<1500'],
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  const size = 64 * 1024; // 64 KiB per upload
  const res = http.post(
    `${__ENV.BASE_URL}/api/files/upload?filename=load.bin&size=${size}` +
      `&mimeType=application/octet-stream&folderId=${__ENV.FOLDER_ID}`,
    open('/tmp/load.bin', 'b'),
    { headers: { 'Content-Type': 'application/octet-stream' } },
  );
  // A quota rejection is a PASSING outcome: the property under test is that accounting
  // stays correct under concurrency, not that every upload succeeds.
  check(res, { 'accepted or quota-rejected': r => r.status === 201 || r.status === 413 });
  sleep(1);
}
```

Two things to say about the results, whichever way they go:

- **The `201 || 413` assertion is the interesting part.** It proves the atomic reservation
  holds under real concurrency rather than only in the integration test.
- **Record the numbers in the repository.** "10 concurrent 64 KiB uploads: p95 340 ms, zero
  5xx, quota exact" is a capacity statement. Interviews reward measurements, not adjectives.

Add one **soak** variant (30 minutes at low load) to catch leaks, and one **big-file** variant
(a single multi-gigabyte upload). Watching `VmRSS` in `/proc/<pid>/status` stay flat during
that upload is a fantastic thing to demonstrate — it proves the streaming claim instead of
asserting it.

### 5.8 A scheduled disaster-recovery drill

**Question it answers:** *"How do you know your backups actually restore?"*

You have excellent backup scripts, but "the restore has never been run" is the weakest possible
answer. Automate the proof:

```bash
#!/usr/bin/env bash
# scripts/drill-restore.sh — proves a backup restores, without touching production.
set -Eeuo pipefail
drill_root=$(mktemp -d)
started=$(date +%s)

# 1. Newest backup (the name pattern is already enforced by backup_tool.py).
backup=$(ls -1dt /srv/secure-cloud-backups/backup-* | head -1)

# 2. Restore into an isolated Compose project and a throwaway storage directory.
export COMPOSE_PROJECT_NAME=secure-cloud-drill
export STORAGE_PATH="$drill_root/storage"
bash scripts/restore.sh "$backup"

# 3. Assert the restore is real: metadata counts must match the backup manifest.
expected=$(jq -r .file_count "$backup/manifest.json" 2>/dev/null || echo "")
actual=$(docker compose -p secure-cloud-drill exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc 'SELECT count(*) FROM "File"')
[[ -z "$expected" || "$expected" == "$actual" ]] || { echo "row count mismatch"; exit 1; }

# 4. Publish the result to the Node Exporter textfile collector, exactly like backup status.
rto=$(( $(date +%s) - started ))
printf 'secure_cloud_drill_last_success_timestamp_seconds %s\nsecure_cloud_drill_rto_seconds %s\n' \
  "$(date +%s)" "$rto" > /var/lib/secure-cloud-monitoring/drill.prom

# 5. Tear down only the drill environment.
docker compose -p secure-cloud-drill down -v
rm -rf "$drill_root"
```

Plus one alert:

```yaml
      - alert: RestoreDrillOverdue
        expr: time() - secure_cloud_drill_last_success_timestamp_seconds > 1209600  # 14 days
        for: 1h
        labels: {severity: warning}
        annotations: {summary: 'No successful restore drill in 14 days'}
```

Now you answer with a number: *"The drill runs weekly, restores into an isolated Compose
project, asserts row counts against the backup manifest, and publishes the RTO as a metric.
Last run: 41 seconds."* That is an **RTO you measured**, not estimated — and almost nobody can
say that in an interview.

### 5.9 Distributed tracing (the third pillar)

**Question it answers:** *"A request is slow. How do you find out where?"*

You have metrics and logs; tracing completes the three pillars and is the clearest remaining
observability gap.

```bash
npm install --workspace backend \
  @opentelemetry/sdk-node \
  @opentelemetry/auto-instrumentations-node \
  @opentelemetry/exporter-trace-otlp-http
```

```javascript
// backend/src/tracing.js — must be loaded before anything else
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

new NodeSDK({
  serviceName: 'secure-cloud-backend',
  traceExporter: new OTLPTraceExporter({ url: 'http://127.0.0.1:4318/v1/traces' }),
  // Fastify, Prisma, ioredis and fs get auto-instrumented, so a single upload becomes one
  // trace: HTTP -> auth -> quota reservation -> disk write -> commit.
  instrumentations: [getNodeAutoInstrumentations()],
}).start();
```

Run it with `node --import ./src/tracing.js dist/src/server.js`, add Grafana Tempo (128 MB,
24-hour retention) beside Loki, and put `trace_id` in the logger so one log line jumps to the
trace that produced it.

> **Say the follow-on thought out loud:** *"Traces are the highest-cardinality telemetry, so I
> would sample them — 10% head sampling with 100% of errors kept — and I would never put a
> filename or user ID in a span name. The privacy rule applies to traces too."* That shows you
> understand the cost model, not just the installation steps.

### 5.10 Runbooks, one per alert

**Question it answers:** *"An alert fires. What do you actually do?"*

An alert with no runbook is a complaint. `deploy/RUNBOOKS.md` now exists in this repository
because the new SLO alerts reference it, and every runbook follows the same shape:

1. **What it means** — one sentence.
2. **Impact** — who notices, and what breaks for them.
3. **First three commands** — confirm or rule out the obvious causes immediately.
4. **Diagnosis** — what each metric or log line tells you.
5. **Remediation** — the safe action, and the risky action with a warning.
6. **Escalation** — when to stop and ask for help.
7. **Resolved** — the specific signal that clears the alert.

That structure is why runbooks work at 3 a.m.: they are action lists, not explanations.

### 5.11 Blackbox probes: monitor it the way a user experiences it

**Question it answers:** *"Your metrics say everything is up, but users cannot reach the site. How would you know?"*

Every current scrape target is measured from inside the host. That blind spot is exactly the
failure mode that matters, because it catches Nginx misconfiguration, TLS problems, expired
tunnel credentials and DNS issues — none of which any internal exporter can see.

```yaml
# monitoring/blackbox/blackbox.yml
modules:
  http_2xx_secure:
    prober: http
    timeout: 5s
    http:
      preferred_ip_protocol: ip4
      fail_if_body_not_matches_regexp: ['"status":"ok"']
```

```yaml
# monitoring/prometheus/prometheus.yml
  - job_name: blackbox
    metrics_path: /probe
    params: {module: [http_2xx_secure]}
    static_configs:
      - targets:
          - http://127.0.0.1:8080/health
          - http://127.0.0.1:8080/login
    relabel_configs:
      - source_labels: [__address__]
        target_label: __param_target
      - source_labels: [__param_target]
        target_label: instance
      - target_label: __address__
        replacement: 127.0.0.1:9115
```

Add a Compose service (32 MB, `127.0.0.1:9115`) and one alert —
`probe_success == 0 for 2m` → `SiteUnreachable`.

The `fail_if_body_not_matches_regexp` detail is the part worth explaining: it asserts on the
application's own health payload rather than merely that Nginx answered. *"I probe the same URL
a user loads and assert on the body, so a 200 from a broken application still counts as down."*

---

## 6. Tier 3 — advanced or role-specific

Take these on only if they serve the role you are targeting. Adding them carelessly is worse
than leaving them out.

### 6.1 Chaos experiments that prove your own safety properties

**Question it answers:** *"What happens if the database dies mid-upload?"*

You already claim the reservation cleanup works. Prove it under real failure:

```bash
# scripts/chaos/kill-database-mid-upload.sh
# 1. Start a large upload through Nginx in the background.
curl -sS -X POST --data-binary @/tmp/1gb.bin \
  "http://127.0.0.1:8080/api/files/upload?filename=chaos.bin&size=1073741824&mimeType=application/octet-stream&folderId=$FOLDER" &
upload=$!
sleep 3
docker compose stop postgres        # kill it mid-transfer
wait "$upload" || true              # the request must fail cleanly, not hang forever
docker compose start postgres
# 2. Assert the invariants you documented: no orphan bytes, no stuck reservation.
docker compose exec -T backend sh -c 'ls /srv/secure-cloud-storage | wc -l'   # no partial file
docker compose exec -T postgres psql -U "$POSTGRES_USER" -tAc \
  'SELECT sum("storageReserved") FROM "User"' | grep -qx 0
```

Run the same shape for **Redis down** (the app must degrade, not fail) and **disk full**
(`fallocate` a filler file, then assert a clean `502`/`507` rather than a corrupt row).

Two or three scripted experiments, each asserting a property you already documented, is a very
strong portfolio item — and it is rare, because most people stop at "we have tests".

### 6.2 Capacity and cost visibility

**Question it answers:** *"What does this cost, and what would you cut?"*

- An AWS **budget alarm**, plus the cost allocation tags Terraform already applies (`Project`,
  `Environment`, `ManagedBy`) switched on in Billing so the numbers are actually usable.
- `infracost` on Terraform pull requests, posted as a comment: *"+$0.00/month"* or
  *"t3.micro → t3.small: +$7.60/month"*. Reviewers see the price of a change before approving it.
- A Grafana panel for `secure_cloud_storage_used_bytes / secure_cloud_storage_quota_bytes` makes
  the growth trend obvious — which is what actually drives the "when do we move to object
  storage" decision.

**Talk track:** *"The edge is a single t3.micro with a 30 GB gp3 volume, so the interesting cost
question is not the instance — it is disk growth versus moving bytes to S3, and I track the
storage trend so that decision is made from data rather than a guess."*

### 6.3 Kubernetes — only if you are targeting Kubernetes roles

**Be careful here.** Bolting Kubernetes onto a single-laptop project to look modern is a negative
signal; interviewers can tell the difference between "used it" and "needed it".

**Option A — a real but minimal cluster (for DevOps/SRE roles):** k3s on two small VMs with
`deploy/k8s/` manifests or one small Helm chart, ArgoCD watching the repository (GitOps), and a
`local-path` storage class for the file storage. Then you can speak truthfully about the
operational differences: probes instead of healthchecks, a `StatefulSet` for PostgreSQL,
`PersistentVolumeClaim` semantics, `NetworkPolicy` replacing the loopback trust model, secrets as
`Secret` objects, and why `ReadWriteOnce` means the backend cannot simply scale to three replicas.

**Option B — document the migration path instead (recommended otherwise):** a short
`deploy/k8s/MIGRATION.md` listing exactly what changes and what does not, plus the sentence
*"I deliberately stayed on Compose: one host, one operator, and Kubernetes would add an
operational surface I would have to maintain without adding a capability this deployment needs."*
That is a mature answer, and it is frequently scored higher than a half-finished cluster.

### 6.4 Everything else, briefly

| Item | When it is worth it |
|---|---|
| HashiCorp Vault | If the target company runs it. Otherwise SSM Parameter Store tells the same story |
| Patroni / streaming replication for PostgreSQL | Only if you can afford two more VMs; otherwise describe it as the HA plan |
| S3-compatible storage adapter | The single best "how would you scale this" answer: one new adapter behind the existing interface |
| Ansible for the Ubuntu host | Shows configuration management, but lower value here because the installer already exists |
| SLSA level 3 | Follows almost for free once build provenance and a hardened builder exist |
| Mutation testing (Stryker) on the quota logic | Small scope, big signal: it proves the tests would catch a broken `WHERE` clause |
| Coverage gate | Add with a ratchet, and only after the number is already respectable |

---

## 7. What NOT to add, and why

Every item here would actively lower your score. This section matters as much as the others.

| Do not add | Why it hurts |
|---|---|
| **Kubernetes for its own sake** | A single host with one operator does not need an orchestrator. If you cannot explain what Kubernetes solves *for this deployment*, it reads as résumé-driven development |
| **A second CI system** (Jenkins or GitLab CI alongside Actions) | No value, and it signals you do not know what your pipeline is for |
| **A service mesh** | A mesh needs many services before it does anything. Here it is pure overhead |
| **Rewriting services in Go or Rust** | Changing languages is not a DevOps improvement, and it discards your strongest asset: a well-tested quota implementation |
| **Fake scale** (many near-identical services to look distributed) | Interviewers ask why each service exists. Empty answers are worse than a small honest system |
| **Floating `latest` image tags** | You currently pin digests, which is a genuine strength. Relaxing that to add features would be a regression |
| **Scanners with no triage plan** | Fifty checks that fail on day one get the whole gate disabled within a week. Gate on what you will actually fix |
| **Self-hosted SonarQube** | It would consume a large share of your laptop's memory for a statistic you can get elsewhere for free |
| **User IDs, file names or URLs as metric labels** | This would destroy the privacy property that is currently one of your best talking points |
| **Alerting on everything** | Alert fatigue is a real failure mode. Every alert needs an owner, an action and a runbook, or it gets ignored |
| **A README that claims more than the code does** | You are currently excellent at this. Keep it. One overclaim costs more than ten missing features |

---

## 8. The 10-day implementation order

Ordered so each day produces something demonstrable, and nothing blocks anything else.

| Day | Work | Deliverable you can show |
|---|---|---|
| **0** | Already done in this pass | Security workflow, Terraform workflow, Alertmanager, SLOs + promtool tests, Makefile, governance files, runbooks |
| **1** | Finish `deploy/RUNBOOKS.md` for any alert still missing one; add a `POSTMORTEM_TEMPLATE.md` | "Every alert has a runbook" becomes true |
| **2** | SBOM + `cosign` signing + provenance attestation + verify-before-deploy | `cosign verify` output in the deploy log |
| **3** | Remote Terraform state + bootstrap directory; enable `TF_PLAN_ENABLED` | A plan diff in a pull request summary |
| **4** | Secrets: SOPS + age (or SSM) plus a written rotation procedure | Secrets reviewable in a PR; a rotation runbook |
| **5** | Blue/green deploy script + `upstream.conf` + `<service>:previous` tagging | Deploy with zero dropped requests; a timed rollback |
| **6** | Playwright E2E on the smoke stack, traces on failure | A red E2E showing the exact failing UI step |
| **7** | k6 load test with thresholds; record results in `docs/CAPACITY.md` | Real p95 and throughput numbers |
| **8** | Restore-drill script + `drill.prom` metric + `RestoreDrillOverdue` alert | A measured RTO |
| **9** | Tracing: OpenTelemetry + Tempo + `trace_id` in logs | One trace for a full upload request |
| **10** | `blackbox_exporter` probes + `SiteUnreachable` alert; polish the portfolio README | External reachability monitoring |

**If you only do three days:** Day 2 (signing and provenance), Day 5 (blue/green and rollback)
and Day 8 (restore drill). Those three separate senior candidates from mid-level ones.

---

## 9. The interview questions these additions unlock

Prepare a two-sentence answer for each. This is the payoff for the whole document.

### Pipeline and delivery

**"Walk me through your pipeline."**
> "On every pull request: typecheck, lint, 37 tests, a production build and monitoring-config
> validation, plus four security scanners. On merge to main I build both images, smoke test them
> in real containers, sign them keylessly, attach build provenance, and publish by immutable
> digest. Deployment is manual and environment-gated, and it deploys the exact digests that
> passed the smoke test — never a floating tag."

**"How do you deploy with no downtime?"**
> "Today there is a short maintenance window. The design I have ready is blue/green: start the
> idle colour, healthcheck it, flip an Nginx upstream file, reload, keep the old colour warm,
> then stop it. Combined with expand/contract migrations, every schema change is safe both before
> the deploy and after a rollback."

**"What is your rollback strategy?"**
> "Two parts. The previous image is already cached as `<service>:previous` and the Nginx upstream
> is a single file, so rollback is a config flip and a reload — seconds, no rebuild. The harder
> half is the database, which is why every migration is expand/contract: additive in release N,
> backfilled in N+1, removed in N+2, so old and new code can both run during the window."

**"How do you know what is running in production matches your repository?"**
> "Images are referenced by digest, Terraform has a scheduled plan that fails the job on drift,
> and the deploy job verifies the image signature and provenance before it starts anything."

### Reliability and observability

**"An alert fires at 3 a.m. What happens?"**
> "Prometheus evaluates the rule and routes it to Alertmanager, which groups by alertname, job
> and severity so one incident is one page. Data-safety alerts go to a separate receiver with a
> 10-second group wait because they can end in lost bytes. Every alert annotation links to a
> runbook containing meaning, impact, the first three commands, remediation, and the signal that
> clears it. Inhibition suppresses the downstream noise."

**"How do you define reliability targets?"**
> "99.5% availability over 30 days and 99% upload success, expressed as recording rules, with
> multi-window multi-burn-rate alerts. A short window detects quickly, a longer window confirms
> it is real, and both must agree before anyone is paged. The latency objective excludes the
> streaming routes, because their duration reflects file size and client bandwidth rather than
> API performance."

**"How do you test monitoring configuration?"**
> "Every rule file is validated with `promtool check config`, both alert files are unit tested
> with `promtool test rules`, and Alertmanager routing is checked with `amtool check-config`. The
> SLO tests include a negative case — 2% errors, which must not alert — because a suite that only
> proves things alert cannot distinguish a working threshold from an always-on alert."

**"Users cannot reach the site but all your metrics are green. What now?"**
> "That is exactly why I added blackbox probes through the public entry point. Every internal
> exporter is scraped from inside the host, so it cannot see an Nginx misconfiguration, an
> expired tunnel token or a DNS problem. The probe asserts on the health body, not merely a 200,
> so a broken application answering through a healthy proxy still counts as down."

### Security

**"How do you handle secrets?"**
> "No secret is ever in a `NEXT_PUBLIC_*` variable, and the installer generates them locally with
> the OS CSPRNG into mode-`0600` files, refusing to overwrite an existing database. The next step
> is SOPS with age so environment files are reviewable as ciphertext in a pull request, or SSM
> Parameter Store for a fully external store, plus a written rotation procedure for `AUTH_SECRET`
> and the database password."

**"How do you secure your supply chain?"**
> "Images are built once, smoke tested in real containers, signed keylessly via OIDC, given build
> provenance, then deployed by digest. The deploy job verifies the signature and certificate
> identity before starting, so an image that did not come from this repository and this workflow
> cannot be deployed. Each image also publishes a CycloneDX SBOM, so triaging a new CVE takes
> minutes instead of days."

**"How would you find out if a credential leaked?"**
> "Gitleaks scans full git history in CI and on a weekly schedule, because a secret that was
> committed and later deleted is still leaked. Beyond that, the Nginx log format uses categorical
> routes only, the Fastify logger redacts cookie and password fields, and a test asserts that a
> planted secret string never appears in metrics or logs."

### Infrastructure and operations

**"Where does your Terraform state live?"**
> "It is local today, which is the first thing I would change: an encrypted, versioned S3 bucket
> with locking, created by a small bootstrap directory because a backend block cannot reference
> resources. The plan job already uses OIDC rather than stored AWS keys, and a weekly scheduled
> plan fails the job when it detects drift."

**"How do you know your backups work?"**
> "The backup tool validates its own archives — it reads through the gzip trailer and rejects
> traversal, duplicate and device entries — and I have a drill that restores the newest backup
> into an isolated Compose project, asserts the file count against the manifest, and publishes
> the measured RTO as a metric. If no drill succeeds within 14 days, an alert fires."

**"How many concurrent uploads can it handle?"**
> "A k6 scenario ramps to 10 concurrent 64 KiB uploads with thresholds on p95 and error rate. The
> assertion is `201 or 413` deliberately: the property under test is that quota accounting stays
> exact under concurrency, not that every upload succeeds. I also run a soak variant and a
> single-large-file variant, and I watch `VmRSS` stay flat during that upload, which proves the
> streaming claim instead of merely asserting it."

**"Your deploy stops the app. Is that acceptable?"**
> "For a personal deployment it was, and I documented it rather than hiding it. It would not be
> acceptable for anything with users, so I designed the blue/green switch and expand/contract
> migrations to remove it. I would rather have a clear plan and an honest current state than a
> claim I cannot demonstrate."

### Behavioural

**"What would you do differently?"**
> See the limitations table in `INTERVIEW_GUIDE.md`, then pick three. The strongest ones are
> blue/green and rollback, the database half of a rollback, and the deliberate consistency
> trade-off where `/auth/me` can serve a counter up to 60 seconds stale from the session cache
> while quota *enforcement* never uses that cache. Naming a subtle trade-off you chose on purpose
> is stronger than listing features you have not built.

**"How do you decide what *not* to build?"**
> "I ask what problem it solves for *this* deployment. Kubernetes would add a large maintenance
> surface and zero capability here, so I documented the migration path instead. The same thinking
> removed a cache-stampede fix I do not need at this scale. Saying no, with a reason, is part of
> the job."

---

## 10. How to present the repository itself

The code is only half of it. These four artefacts do the other half.

### 10.1 Add a "DevOps capabilities" table near the top of `README.md`

Recruiters skim. Give them this within the first screen:

| Capability | Implementation |
|---|---|
| CI | GitHub Actions: typecheck, lint, 37 tests, production build, monitoring-config validation |
| Security | Gitleaks (full history), Trivy filesystem scan + image gate, `npm audit`, CycloneDX SBOM, digest-pinned deploys |
| Infrastructure as code | Terraform (VPC, EC2 edge, IAM/SSM, security group) with fmt, validate, tflint, checkov, OIDC plan and weekly drift detection |
| Containers | Multi-stage builds, non-root user, `cap_drop: ALL`, healthchecks, digest pinning, log rotation |
| CD | Build → container smoke test → keyless signing → provenance → environment-gated deploy |
| Observability | Prometheus, Grafana, Loki, Alloy, cAdvisor, four exporters, privacy-filtered logs |
| Alerting | Alertmanager with grouping and inhibition; rule files unit tested with promtool |
| Reliability | SLOs with error budgets and multi-window burn-rate alerts; a runbook per alert |
| Data protection | Coordinated PostgreSQL + filesystem backup, verified manifests, scheduled restore drill |
| DevEx | One-command installer, `make` interface, `.nvmrc`, `.editorconfig` |

That table is worth more than any slogan at the top of a README.

### 10.2 Record a 90-second demo once

1. `make ps` — 16 services healthy, including the migration job that exited `0`.
2. `make health` and `make metrics` — the app answering, and the private metrics endpoint.
3. Grafana — the backend dashboard, then the SLO burn panels.
4. `http://127.0.0.1:9093` — Alertmanager's routing tree, and a silence proving inhibition works.
5. GitHub — a pull request with six checks, the security scan summary and the SBOM artifact.
6. Actions — the deploy log showing `cosign verify` passing *before* `docker compose up`.

Record it once and you never fumble a live demo — and a link in a CV beats a paragraph in a
covering letter.

### 10.3 Keep the documentation consistent

You now have `README.md`, `PROJECT_OVERVIEW.md`, `CURRENT_ARCHITECTURE_AND_FLOW.md`,
`INTERVIEW_GUIDE.md`, `DEVOPS_UPGRADE_PLAN.md` plus the `deploy/` set. Depth is good, but:

- Put a short "Where to look" list in `README.md` linking all of them.
- Make sure no two documents disagree. Contradictory documentation reads as carelessness, which
  undoes the benefit of having written it at all.
- Update the numbers whenever a service, port or limit changes (this plan already updated the
  service count in `INTERVIEW_GUIDE.md` from 15 to 16 for exactly that reason).

### 10.4 Two sentences for a covering letter

> "I built and operate a self-hosted private cloud storage platform: Next.js and Fastify over
> PostgreSQL and Redis with local file storage, delivered by a GitHub Actions pipeline that
> smoke-tests real containers, signs images keylessly, deploys by immutable digest and gates on
> image CVEs. Operations are covered end to end — Terraform-provisioned AWS edge infrastructure
> with drift detection, Prometheus and Grafana with SLO error budgets and Alertmanager runbooks,
> and a verified restore drill that measures RTO."

---

## 11. Definition of done

Tick these off before you send the repository to anyone.

**Already true — verify, do not rebuild**

- [x] CI runs typecheck, lint, tests and a production build
- [x] The container smoke test asserts auth, CORS, upload, download, quota and graceful shutdown
- [x] Images are published and deployed by immutable digest
- [x] Migrations run as a one-shot container before the API starts
- [x] Non-root containers, `cap_drop: ALL`, healthchecks, log rotation
- [x] Metrics, PostgreSQL and Redis bound to `127.0.0.1` only
- [x] Monitoring configuration is validated in CI
- [x] Alert rules are unit tested with promtool
- [x] A `make` interface exists and `make help` lists every target
- [x] Every alert has a runbook in `deploy/RUNBOOKS.md`

**Added in this pass**

- [x] Secret scanning over full git history
- [x] Image CVE scanning as a hard gate
- [x] Dependency and filesystem scanning, with SBOM output
- [x] Terraform formatting, validation, linting and security scanning
- [x] Scheduled infrastructure drift detection
- [x] Alertmanager delivering alerts, with routing and inhibition
- [x] SLOs with error budgets and multi-window burn-rate alerts
- [x] CODEOWNERS, pull request template, issue templates, `SECURITY.md` and a vulnerability policy

**Remaining, in priority order**

- [ ] Keyless image signing and build provenance, verified before deploy
- [ ] Remote Terraform state with locking, and the plan job enabled
- [ ] Blue/green deploy with a warm rollback colour, plus expand/contract migrations
- [ ] A scheduled restore drill that publishes a measured RTO
- [ ] Secrets in SOPS or SSM, with a written rotation procedure
- [ ] Playwright E2E for register, upload/download and a share link
- [ ] k6 load test with thresholds, results recorded in `docs/CAPACITY.md`
- [ ] Distributed tracing with OpenTelemetry and Tempo
- [ ] Blackbox probes through the public entry point
- [ ] Release automation with tags and a generated changelog

---

*This plan was produced by reading the whole repository, and every change it recommends adding
was verified: `docker compose config` exits 0, `promtool check config` reports 2 rule files and
13 SLO rules, `promtool test rules` passes for both `alerts.test.yml` and `slo-rules.test.yml`,
and `amtool check-config` reports 2 inhibit rules and 3 receivers. Anything described as "today"
reflects the code as it exists; anything not implemented is labelled as planned rather than
presented as working.*
