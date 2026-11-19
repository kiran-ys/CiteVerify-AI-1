# CiteVerify AI Deployment Checklist

No deployment configuration currently exists. Do not deploy until the applicable boxes are evidenced.

## Application readiness

- [ ] Lint, typecheck, tests, and production build pass in CI.
- [ ] Demo and live modes cannot be confused.
- [ ] Health and readiness endpoints reflect real dependencies.
- [ ] API and worker shut down cleanly and recover from restarts.
- [ ] Upload limits, timeouts, temporary-file cleanup, and safe error responses are tested.

## Architecture

- [ ] Frontend hosting is selected (Vercel or Railway are candidates, subject to current platform verification).
- [ ] Bun-compatible API and worker hosting is verified with a minimal staging deployment.
- [ ] API and worker use a persistent managed database in production.
- [ ] Do not use one local SQLite file across separate cloud services.
- [ ] Private object storage and lifecycle rules are defined if PDFs are retained.
- [ ] Queue or job coordination survives process restarts.

## Security and privacy

- [ ] Secrets exist only in platform secret storage.
- [ ] Production CORS allows only intended frontend origins.
- [ ] HTTPS is mandatory.
- [ ] Authentication and authorization protect documents and reports.
- [ ] PDF inputs are treated as untrusted and resource limits are enforced.
- [ ] Retention, deletion, backup, and restore policies are documented and tested.
- [ ] Logs exclude document contents, evidence text, tokens, and personal data.
- [ ] Dependency and secret scanning are enabled.

## Data and operations

- [ ] Production migrations have a reviewed rollout and rollback procedure.
- [ ] Backups and a restore drill are complete.
- [ ] Monitoring covers latency, errors, queue depth, stuck jobs, storage, and database health.
- [ ] Structured logs include request/job correlation IDs.
- [ ] Alerts have owners and actionable thresholds.
- [ ] Cost limits and usage alerts are configured before paid services are enabled.
- [ ] Outbound HTTPS is allowed to `api.crossref.org`, `api.openalex.org`, `www.ebi.ac.uk` (Europe PMC), and `eutils.ncbi.nlm.nih.gov` (PubMed Central) for source retrieval.
- [ ] `CITEVERIFY_CONTACT_EMAIL` is set to an operator mailbox (not a user's) so Crossref and NCBI requests use their polite pools, or deliberately left empty.
- [ ] The API host and any proxy allow requests of at least 70 seconds for `POST /api/documents/evidence` (Bun `idleTimeout` is set to 120 s).
- [ ] A shared cache or rate-limit budget is in place before multiple API instances query the scholarly services.

## Release evidence

- [ ] Staging end-to-end test uses a legally accessible PDF.
- [ ] Real extracted text is visibly distinguishable from demo content.
- [ ] Evidence links and unavailable-source behavior are honest.
- [ ] Browser smoke tests cover upload, extraction, errors, and mobile layout.
- [ ] Rollback is tested.
- [ ] Final public deployment has explicit owner approval.
