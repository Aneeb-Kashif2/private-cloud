# Monitoring implementation status

The repository contains the complete monitoring configuration: Prometheus,
Grafana, Loki, Alloy, cAdvisor, Node Exporter, Nginx/PostgreSQL/Redis exporters,
private Fastify metrics, seven provisioned dashboards, persistent volumes,
retention/resource limits, setup scripts and operations documentation.

The existing WhatsApp scripts and their environment variables were preserved.
Alloy now includes read-only collection of `.runtime/cloudflared.log`; it does not
invoke those scripts, send WhatsApp messages, or collect their credential files.

## Confirmed before runtime access was blocked

- Application images built and the instrumented backend was deployed.
- PostgreSQL and Redis were adopted with their original volumes; their published
  ports now bind only to localhost. Metadata counts and stored-byte totals matched
  the pre-adoption snapshot.
- Application upload/list/search/download/delete and quota behavior worked through
  the running Nginx proxy; the temporary verification account/files were removed.
- Prometheus scraped backend, host, Nginx, PostgreSQL, Redis, and Loki successfully.
- Grafana served `/grafana/` through Nginx, listed seven provisioned dashboards,
  and reported successful connections to both Prometheus and Loki.
- Alloy's Docker pipeline configuration validated and its container started.

## Not yet confirmed or applied

- cAdvisor image/startup and container metrics were not confirmed.
- End-to-end Loki log ingestion and all ten targets simultaneously healthy were
  not confirmed.
- The final native-cloudflared log mount/source, Grafana plugin-install setting,
  and Grafana HA loopback setting require Compose reconciliation.
- Host logrotate scheduling for a continuously running native tunnel is manual.

Automatic approval review blocked further Docker inspection due to a session
usage limit. No additional tests were run after the user asked to skip them.
Do not describe this as a fully verified running stack until the remaining
runtime checks have been completed.

Apply the final configuration from the repository root:

```bash
docker compose up -d
```

Grafana: http://localhost:8080/grafana/ (username `admin`; generated password in
`monitoring/runtime/grafana_admin_password`). Do not start the optional Compose
`tunnel` profile while using the existing WhatsApp/native tunnel scripts.
