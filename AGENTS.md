# CiteVerify AI Agent Instructions

## Mission

CiteVerify AI helps a reviewer trace scientific claims to citations and source evidence. The project must favor evidence integrity, honest uncertainty, reproducibility, and human review over impressive but unsupported output.

The current milestone is deterministic citation extraction and matching within real uploaded PDF text, building on reviewed claim extraction. Extracted claims and citation matches are unverified. Do not implement claim verification, source retrieval, or AI verdict generation until citation matching has been reviewed by the project owner.

## Architecture boundaries

- `apps/web` contains the React interface. It may depend on `packages/ui` and `packages/shared`. It must not access the database or processing engines directly.
- `apps/api` contains the Hono HTTP API. It may depend on `packages/database` and `packages/shared`. Keep request validation, persistence, and job creation here; keep heavy processing out. Until worker jobs exist, the synchronous upload routes may call `packages/document-parser`, `packages/claim-extractor`, and `packages/citation-engine` directly within the documented limits.
- `apps/worker` runs background processing and may use the database, shared contracts, parser, claim extractor, citation engine, and verification engine.
- `packages/shared` owns cross-workspace types, schemas, constants, and API contracts.
- `packages/database` owns Prisma configuration, schema, client creation, and database helpers.
- `packages/document-parser` owns document text extraction and page-level provenance.
- `packages/claim-extractor` owns deterministic identification of candidate claims in extracted text. It never assigns verdicts or confidence scores.
- `packages/citation-engine` owns citation extraction and reference resolution within the uploaded paper. A citation match links a marker to a reference entry; it is never evidence that a source supports a claim.
- `packages/verification-engine` owns evidence-constrained verdict logic.
- `packages/ui` owns reusable React UI components without application data access.
- `packages/config` owns shared TypeScript configuration.

Preserve the Bun, TypeScript, Hono, React, Vite, Tailwind CSS, Turborepo, Prisma, and SQLite development architecture. Do not add Python to the application or replace the backend without explicit approval.

## Coding conventions

- Use TypeScript with strict typing. Avoid `any`; validate data at trust boundaries.
- Prefer small pure functions and explicit result types for fallible parsing work.
- Keep API request and response shapes in `packages/shared`.
- Return stable machine-readable error codes plus safe human-readable messages.
- Do not log document contents, credentials, tokens, or private source passages.
- Keep files focused. Add dependencies only when the standard platform and existing packages cannot meet the requirement.
- Follow the existing Biome formatting and lint rules.
- Keep demo mode visibly separate from live data. Never silently mix demo records with uploaded documents.

## Evidence integrity rules

- Never invent a citation, DOI, source passage, page number, result, or confidence score.
- A metadata match does not prove access to full text and does not prove that a source supports a claim.
- Every substantive verdict must retain source identity, exact evidence text, and page or section provenance when available.
- If required evidence cannot be retrieved or parsed, return `Unable to verify` with the reason.
- Distinguish model confidence from measured validation accuracy.
- Preserve the original claim text and enough surrounding context for human review.
- Treat uploaded papers as untrusted input. Enforce type and size limits and avoid unsafe filenames.

## Required validation

Run from the repository root:

```bash
bun install
bun run lint
bun run typecheck
bun run build
```

Run relevant tests when test scripts exist. Do not say a check passed unless its command completed successfully. If a package gains tests, add a root-level test script so validation is discoverable.

## Git safety

- The primary repository is `https://github.com/kiran-ys/CiteVerify-AI-1`.
- Create focused feature branches such as `feature/pdf-upload`.
- Keep commits small and describe the user-visible outcome.
- Do not force-push, rewrite shared history, change remotes, delete branches, deploy, or push without user approval.
- Do not commit `.env`, uploaded papers, database files, generated build output, tokens, or credentials.
- Use `Kiran Y S <251000745+kiran-ys@users.noreply.github.com>` for user-authored commits when configured.

## Definition of done

A feature is done only when:

1. Its observable behavior matches an agreed acceptance criterion.
2. Input validation, failure states, and privacy implications are handled.
3. Relevant unit and integration tests pass.
4. `bun run lint`, `bun run typecheck`, and `bun run build` pass.
5. Demo content remains clearly labelled and separate from live results.
6. `docs/PROJECT_STATUS.md` and affected contracts or checklists are updated.
7. Remaining limitations are reported plainly.

## Progress documentation

- Update `docs/PROJECT_STATUS.md` when implementation status changes.
- Update `docs/IMPLEMENTATION_ROADMAP.md` when sequencing or acceptance criteria change.
- Update `docs/API_CONTRACT.md` before or with API behavior changes.
- Update `docs/DEPLOYMENT_CHECKLIST.md` when infrastructure requirements change.
- Update `docs/CITEVERIFY_MASTER_HANDBOOK.md` only for durable architectural or workflow changes, then regenerate and visually verify its PDF.
