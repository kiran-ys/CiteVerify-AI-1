# CiteVerify AI Project Status

Last inspected: 2026-11-19

## Repository baseline

- Repository: `https://github.com/kiran-ys/CiteVerify-AI-1`
- Active implementation branch: `feature/pdf-upload`
- Baseline commit: `1f09692` (`Build CiteVerify frontend dashboard`)
- Working tree before documentation: clean
- Application stack: Bun, Turborepo, TypeScript, React, Vite, Tailwind CSS, Hono, Prisma, SQLite

## Status summary

| Area                 | Status                       | Evidence and limitation                                                                                   |
| -------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| Monorepo scaffolding | Implemented and verified     | Apps and packages exist; install, lint, typecheck, and build previously passed from a fresh clone.        |
| Responsive frontend  | Implemented and verified     | Dashboard, upload screen, result filtering, evidence drawer, and report preview are implemented in React. |
| Demo labelling       | Implemented and verified     | Demo claims remain visibly separate from the live PDF extraction result.                                  |
| API health route     | Implemented and verified     | `GET /api/health` returns `{ "status": "ok" }`.                                                           |
| PDF upload           | Implemented and verified     | React sends multipart PDF data to `POST /api/documents/extract` and displays the response.                |
| Worker               | Placeholder                  | It logs `[worker] started`; no job consumption exists.                                                    |
| Document parser      | Implemented and verified     | `unpdf` 2.2.1 returns full text, page text, page count, warnings, and parser metadata.                    |
| Citation engine      | Placeholder                  | Package exports nothing.                                                                                  |
| Verification engine  | Placeholder                  | Package exports nothing.                                                                                  |
| Shared contracts     | Implemented                  | Upload limits and typed success/error contracts are shared by the API, parser, and web client.            |
| Shared UI package    | Placeholder                  | Package exports nothing.                                                                                  |
| Database             | Configured, no domain models | Prisma client and SQLite URL resolution exist; schema contains no models.                                 |
| Automated tests      | Implemented and passing      | 13 Bun tests cover parser, API multipart/error behavior and status mapping, and the browser API client.  |
| Deployment           | Planned                      | No CI, container, or hosting configuration exists.                                                        |

## Completed milestone

Build one real end-to-end slice:

`React upload -> Hono API -> document parser -> extracted text -> React display`

Completed on `feature/pdf-upload`. The endpoint validates one `application/pdf` file up to 25 MB, checks its signature, parses at most 500 pages with a 15-second response timeout, and returns page-aware output. Files and extracted text are processed in memory and are not persisted.

## Next milestone

Phase 2 adds durable document and processing-job models, controlled storage references, worker execution, status polling, and retry-safe state transitions. Claim extraction remains deferred until that processing foundation is reviewed and implemented.

## Phase 1 validation

Executed successfully on 2026-11-19 with Bun 1.4.4:

- `bun install`
- `bun run lint` - 9 workspace lint tasks passed
- `bun run typecheck` - 10 workspace typecheck tasks passed, including Prisma Client generation
- `bun run test` - 11 tests passed across parser, API, and web packages
- `bun run build` - API, worker, and web production builds passed
- Browser smoke test - a generated one-page PDF produced the exact text `CiteVerify live browser extraction succeeded.` through `unpdf` 2.2.1

Contract alignment follow-up, 2026-11-19: extraction timeouts now return `503 EXTRACTION_TIMEOUT`, unexpected parser failures return `500 EXTRACTION_FAILED`, the success body matches the documented shape exactly, and the web client reports non-JSON error responses clearly. Re-run with `--force`: lint 9/9, typecheck 10/10, 13 tests passed, build 4/4.

## Known limitations and deferred work

- OCR is not implemented; image-only PDFs return `NO_EXTRACTABLE_TEXT`.
- The 15-second timeout ends the HTTP request but does not stop the parser; a document still loading when the timeout fires is not cleaned up.
- Processing is synchronous and in memory; the timeout does not yet provide durable cancellation or resumability.
- Automated coverage does not yet include a real encrypted fixture, a 25 MB boundary fixture, or a representative multi-column scientific paper.
- CI, persistence, worker jobs, authentication, and deployment remain unimplemented.
- Define retention policy before persisting uploaded files.
