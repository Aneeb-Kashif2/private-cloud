## What changed

<!-- One or two sentences. What behaviour is different after this pull request? -->

## Why

<!-- The problem, the trigger, or the issue this closes. Link issues with #123. -->

## How it was verified

<!-- Be specific: which command did you run, and what did you see? -->

- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] Manual check (describe the steps and the observed result)

## Type of change

- [ ] Bug fix (no schema or API contract change)
- [ ] Feature
- [ ] Database migration (a new file under `backend/prisma/migrations/`)
- [ ] API contract change (request, response or status code)
- [ ] Infrastructure, Compose, Nginx, CI/CD or Terraform
- [ ] Documentation only

## Checklist

- [ ] No secret, password, token, private key or `.env` file is added to the diff
- [ ] No secret is placed in a `NEXT_PUBLIC_*` variable (those are shipped to the browser)
- [ ] New queries scope by `userId`, or the endpoint is intentionally public
- [ ] New error paths use `AppError` with a stable `code`, not a bare `500`
- [ ] New metric labels or log fields contain no user ID, filename, URL or token
- [ ] `STORAGE_PATH` and quota invariants are unchanged (quota is 5 GiB by design)
- [ ] Documentation updated when behaviour, ports, volumes or configuration changed

## Migrations, rollout and rollback

<!-- Delete this section if not applicable. -->

- Migration is backwards compatible with the running version: yes / no
- Deploy order required (stop writers → migrate → start): yes / no
- Rollback plan:
- Estimated downtime:

## Risk

<!-- What could break in production, and how would you notice? Low / medium / high. -->
