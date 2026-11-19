# CiteVerify

Scientific claim and citation verification system.

Monorepo built with **Bun** + **Turborepo** + **TypeScript**.

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

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.4 (Node.js is not required)

## Setup

```bash
bun install
cp .env.example .env
bun run db:generate     # generate the Prisma client
bun run db:push         # create/sync the SQLite database (once models exist)
bun run dev             # start web, api, and worker
```

- Web: http://localhost:5173 (proxies `/api/*` to the API)
- API: http://localhost:3001/api/health

## Commands (run from the repo root)

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

## Environment

See `.env.example`. A relative SQLite `DATABASE_URL` (e.g. `file:./dev.db`) always resolves inside `packages/database/`, whichever app is running.
