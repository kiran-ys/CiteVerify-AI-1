# CiteVerify AI

Trace scientific claims to their citations and the source evidence behind them, with honest uncertainty and human review.

## 🌐 Live Demo

**[https://citeverify-ai.onrender.com](https://citeverify-ai.onrender.com)**

Upload a research paper (PDF, up to 25 MB) to see its claims, citations, and retrieved sources. The free hosting tier sleeps when idle, so the first request can take up to a minute.

### Deployment status

The frontend and API are deployed on **Render (Free tier)**. Checked against the live site on 2026-11-19:

| Feature | Live website |
| --- | --- |
| PDF upload and text extraction | ✅ Working |
| Claim extraction | ✅ Working |
| Citation matching and internal-consistency checks | ✅ Working |
| Source retrieval (Crossref, OpenAlex, Europe PMC, PubMed) | ✅ Working |
| AI claim verification (local Ollama model) | ⚠️ Temporarily unavailable |

AI verification runs on a self-hosted [Ollama](https://ollama.com) model (`llama3.2`), which Render Free cannot host. On the live site every claim is reported as **Unable to verify** with that reason; no verdicts are invented. AI verification works when the project runs locally with Ollama (see [Local Development](#local-development)).

## Project Features

- **PDF parsing** with page-level provenance, including superscript citation markers read from the PDF layout.
- **Claim extraction**: rule-based detection of cited claims and the paper's own findings, with surrounding context.
- **Citation matching**: links in-text citations (numbered, bracketed, superscript, author-year) to the paper's reference list.
- **Internal-consistency checks**: compares the paper's own reported numbers, confidence intervals, and p-values with each other.
- **Source retrieval**: identifies cited works through PubMed, Crossref, OpenAlex, and Europe PMC with strict identity checks, and collects abstract or open-access text. Only reference details are sent, never the uploaded paper.
- **Evidence-grounded verification** (local only): a local model compares each claim's population, intervention, outcome, and findings with retrieved passages. Every verdict cites stored source text checked in code; otherwise the result is *Unable to verify* with the reason.
- **Honest limits**: verdicts are model judgements that need human review; accuracy has not yet been measured on a reviewed dataset.

## Tech Stack

Monorepo built with **Bun** + **Turborepo** + **TypeScript**: React + Vite + Tailwind CSS frontend, Hono API on Bun, Prisma + SQLite, Biome, and Ollama for local AI verification.

## Architecture

```
apps/
  web/                    React + Vite + Tailwind frontend        (UI only)
  api/                    Hono HTTP API on Bun                    (requests, persistence, job creation)
  worker/                 Background processing                   (runs the engines)
packages/
  config/                 Shared tsconfig presets
  shared/                 Types, schemas, constants shared everywhere
  database/               Prisma schema + client (SQLite)
  ui/                     Shared React components
  document-parser/        Document text extraction                (worker only)
  citation-engine/        Citation extraction / resolution        (worker only)
  verification-engine/    Claim-vs-source verification            (worker only)
```

Dependency rules:

| Workspace        | May depend on                                                                     |
| ---------------- | --------------------------------------------------------------------------------- |
| `web`            | `ui`, `shared`                                                                    |
| `api`            | `database`, `shared`                                                              |
| `worker`         | `database`, `shared`, `document-parser`, `citation-engine`, `verification-engine` |
| engines / parser | `shared`                                                                          |

The frontend never touches the database or the processing engines. Heavy processing lives in the worker, not in the API.

Internal packages export TypeScript source directly (`"exports": "./src/index.ts"`), so they have no build step.

## Local Development

### Prerequisites

- [Bun](https://bun.sh) ≥ 1.4 (Node.js is not required)
- Optional, for AI verification: [Ollama](https://ollama.com) with `ollama pull llama3.2`

### Setup

```bash
bun install
cp .env.example .env
bun run db:generate     # generate the Prisma client
bun run db:push         # create/sync the SQLite database (once models exist)
bun run dev             # start web, api, and worker
```

### Local URLs

| Service | URL |
| --- | --- |
| Local frontend | http://localhost:5173 (proxies `/api/*` to the API) |
| Local API health | http://localhost:3001/api/health |

These addresses work only on the machine running `bun run dev`. For the public site, use the [Live Demo](#-live-demo).

### Commands (run from the repo root)

| Command               | Description                      |
| --------------------- | -------------------------------- |
| `bun run dev`         | Run all apps in watch mode       |
| `bun run build`       | Build all apps                   |
| `bun run lint`        | Lint all workspaces with Biome   |
| `bun run typecheck`   | Type-check all workspaces        |
| `bun run format`      | Format the repo with Biome       |
| `bun run db:generate` | Generate the Prisma client       |
| `bun run db:push`     | Push the Prisma schema to SQLite |
| `bun run db:studio`   | Open Prisma Studio               |

To run a single app: `bunx turbo run dev --filter=@citeverify/api`

### Environment

See `.env.example`. A relative SQLite `DATABASE_URL` (e.g. `file:./dev.db`) always resolves inside `packages/database/`, whichever app is running.

## Deployment

The live demo runs on Render Free without AI verification. A single-server Docker setup that includes a private Ollama model is in [`deploy/`](deploy/), with the plan, costs, and limits in [`docs/DEPLOYMENT_PLAN.md`](docs/DEPLOYMENT_PLAN.md).
