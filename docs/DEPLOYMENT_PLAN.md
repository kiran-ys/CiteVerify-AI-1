# CiteVerify AI Deployment Plan (hackathon)

Status: **approved by the owner (2026-11-19); not yet deployed.** The server must be rented by the owner. Prices below are approximate and must be checked on the provider's page before anything is rented.

## Recommended architecture

One rented cloud server runs three containers with Docker Compose (`deploy/`):

```
browser ──HTTPS──> web (Caddy: static React app + /api proxy)  ── public, ports 80/443
                         │ /api/*
                         ▼
                   api (Bun + Hono bundle)                      ── private network only
                         │ prompts          │ reference lookups
                         ▼                  ▼
                   ollama (llama3.2)        Crossref, OpenAlex, Europe PMC, NCBI (internet)
                   private, never public
```

- Same origin for the page and the API, so **no CORS** configuration is needed and none is opened.
- Caddy gets an HTTPS certificate automatically for `SITE_ADDRESS` (needs a domain whose DNS points at the server).
- **AI verification without the MacBook:** Ollama runs on the server, so prompts go only to the operator's own model server, as AGENTS.md requires. No hosted AI API is used.
- The API is stateless: it keeps nothing after a request and does not use the database yet, so there is no database or file storage to run.

### Server choice

| Option | Example | Approx. cost | Verification speed | Verdict |
|---|---|---|---|---|
| **A. GPU VM, rented for the demo window (recommended)** | Any VM with Docker and an NVIDIA GPU of 8 GB+ VRAM (e.g. AWS g4dn.xlarge with a T4) | roughly $0.50-1.00 per hour; ~$10-25 for a 1-2 day hackathon if stopped afterwards | expected at or better than the M4 (~7 s per claim) | Fast enough for a live demo |
| B. CPU-only VM, always on | 8 vCPU / 16 GB RAM | roughly $20-60 per month | likely 3-6x slower; many claims would hit the time budget | Cheap but would show many "Unable to verify (time budget)" |
| C. Hosted AI API | — | per-token | fastest | **Not prepared:** sends claim and evidence text to a third party, which AGENTS.md forbids without explicit approval |
| D. Tunnel to the MacBook | — | free | as now | Rejected: depends on the laptop |

GPU "pod" marketplaces that give you a container rather than a VM usually cannot run Docker Compose; pick a provider that gives a full VM.

## Deploy steps (only after approval)

1. Rent the server; install Docker (and the NVIDIA Container Toolkit for option A); point the domain's DNS at it.
2. Copy the repository; `cp deploy/.env.example deploy/.env` and set `SITE_ADDRESS`, `DEMO_PASSWORD_HASH` (required) and optionally `CITEVERIFY_CONTACT_EMAIL`.
3. `docker compose -f deploy/docker-compose.yml [-f deploy/docker-compose.gpu.yml] --env-file deploy/.env up -d --build`
4. `docker compose -f deploy/docker-compose.yml run --rm ollama-pull` (one-time ~2 GB model download).
5. Smoke test: `/api/health`, `/api/verification/status` shows `modelInstalled: true`, then upload a legally shareable PDF through the page.
6. Stop or delete the server after the demo to stop charges.

## Blockers and risks

1. **Long single request.** On the M4, a full verification of PMC7065031 through the production bundle took 3 min 56 s (2026-11-19), just under the API's 240 s connection limit. A slower server or slower scholarly APIs could cut it off. Hackathon mitigation: demo with shorter papers or lower limits; real fix: background jobs with polling (the worker app is still a stub).
2. **No user accounts or rate limiting.** A single shared demo password (Caddy `basic_auth`, required by the config) keeps the public from using the GPU; anyone given the password shares one budget. Share it only with judges.
3. **Verdict accuracy is not measured.** The latest 17-claim run scored 6/14 against AI-assisted labels, with a bias toward "Partially supported". The page must keep saying verdicts need human review.
4. **Containers tested locally, not on a GPU server.** On 2026-11-19 both images were built and run on the M4 with Docker (Ollama on the host instead of the container): password required (401 without it), health check open, page and client-side routes served, 27 MB upload rejected with 413, non-PDF rejected with 415, and the Ioannidis paper verified end to end in 3 min 45 s (21 claims). The Ollama container, the GPU override, and automatic HTTPS were not exercised.
5. **Uploaded papers are processed on the server.** They are not stored, but they leave the user's machine; the page should say so.
6. `/api/verification/status` reveals the internal Ollama address (`http://ollama:11434`); harmless but could be hidden.
