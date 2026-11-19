# CiteVerify AI Master Project Handbook

**Tagline:** Every Claim. Verified by Evidence.  
**Hackathon:** SAPTHAHACKS'26, November 19-20, 2026  
**Repository:** `https://github.com/kiran-ys/CiteVerify-AI-1`  
**Documentation baseline:** 2026-11-19, commit `1f09692`

> This handbook distinguishes historical reports, verified repository facts, demonstration-only behavior, and future plans. Sample claims, citations, evidence, scores, and reports in the frontend are illustrative and are not scientific findings.

## How to use this handbook

Use this as the durable project guide. Use `docs/PROJECT_STATUS.md` for the current snapshot, `docs/IMPLEMENTATION_ROADMAP.md` for delivery sequence, `docs/API_CONTRACT.md` for interface changes, and `docs/DEPLOYMENT_CHECKLIST.md` for launch readiness. When implementation changes a durable fact, update the relevant concise document first and then revise this handbook.

---

## Chapter 1 - Project introduction

CiteVerify AI is a scientific claim and citation review application. A user should be able to upload a research paper, inspect extracted claims and references, locate the original cited research when it is legitimately accessible, compare each claim with traceable evidence passages, and receive a cautious verdict for human review.

The problem is not simply detecting whether a citation string exists. A real citation can be irrelevant, misunderstood, outdated, or inconsistent with a manuscript claim. Conversely, a failed retrieval does not prove that a citation is false. The product must therefore preserve provenance and uncertainty throughout the pipeline.

Target users include researchers, reviewers, editors, students, research-integrity teams, and hackathon judges evaluating an explainable workflow. Expected outputs are document metadata, extracted text, candidate claims, parsed references, claim-to-citation associations, retrieved source records, evidence passages, verdicts, explanations, and a human-review report. Each output must record how it was produced and what remains uncertain.

### Successful MVP

A successful hackathon MVP completes one honest end-to-end path with a legally accessible, text-based scientific PDF. It uploads and parses the paper, extracts at least a small set of reviewable claims and citations, retrieves at least one accessible source, presents an exact evidence passage with provenance, and produces a cautious evidence-grounded verdict. If retrieval or parsing fails, the UI must show the failure rather than substituting demo content.

Minimum quality conditions:

- The live path is clearly separated from demo mode.
- No scientific evidence is fabricated.
- A judge can trace a verdict to an actual source passage.
- Unsupported inputs fail safely and understandably.
- The application can be demonstrated repeatedly from a clean start.

---

## Chapter 2 - Complete development history

### Historical reports supplied by the project owner

The project began from a teammate-oriented CiteVerify monorepo architecture in `kiran-ys/CiteVerify`. Git, Node.js, npm, Python, and Bun were installed or verified, with Bun reported as version 1.4.4. Dependencies were installed with `bun install`. The Vite frontend reportedly ran at `http://localhost:5173`, and the Hono health endpoint reportedly responded at `http://localhost:3001/api/health`.

The initial frontend was described as a plain placeholder. Codex then built a responsive dashboard with navigation, statistics, an upload interface, searchable and filterable verification results, evidence comparison, status badges, confidence indicators, review controls, and report-oriented screens. All scientific records were deliberately labelled as illustrative.

Lint, typecheck, and build were reported as passing. The dashboard was committed to `feature/frontend-dashboard`. A push was initially rejected by GitHub's GH007 email privacy protection; the Git author email was changed to `251000745+kiran-ys@users.noreply.github.com`, the commit was amended, and commit `1f09692` was pushed successfully.

An independent public repository, initially named `CiteVerify-AI-Personal`, was created and populated without rewriting the original repository. It was renamed to `CiteVerify-AI-1`. The owner then cloned it to `~/Desktop/CiteVerify-AI-1`.

### Verified during the current inspection

- The working directory is `/Users/kiranys/Desktop/CiteVerify-AI-1`.
- Active branch `feature/pdf-upload` was created from `origin/main` at `1f09692`; the Phase 1 changes are not committed or pushed.
- `origin` is `https://github.com/kiran-ys/CiteVerify-AI-1.git`.
- The repository has two commits: monorepo initialization and frontend dashboard implementation.
- The React dashboard and explicit demo warnings are present.
- The Hono API contains a health route and a synchronous multipart PDF extraction route.
- The worker and engine packages are placeholders.
- Prisma is configured for local SQLite but has no domain models.
- Eleven Bun tests cover the parser, extraction API, and web API client. CI workflows, containers, and deployment manifests are not present.
- A fresh clone completed `bun install`, lint, typecheck, and build during repository migration. Validation is run again after documentation changes and reported separately.

Historical reports are useful context, but they are not substitutes for current tests or current external-service verification.

---

## Chapter 3 - Technology stack

### Frontend

React 19 provides component state and rendering. TypeScript defines compile-time contracts. Vite supplies local development, API proxying, and production bundling. Tailwind CSS v4 is configured through the Vite plugin, although much of the current visual system is implemented as authored CSS in `apps/web/src/index.css`.

### Backend and processing

Hono provides a small HTTP layer running on Bun. Bun is the package manager, script runner, server runtime, and bundler for API and worker code. Turborepo coordinates workspace tasks and caching. The worker is intended to isolate longer parsing, retrieval, and verification work from request handling.

### Data

Prisma supplies the schema and generated client. Development uses SQLite through the libSQL adapter. SQLite is appropriate for a single local process but must not be treated as a shared database across separately hosted API and worker services. Production should use a persistent managed database, commonly PostgreSQL, after compatibility and migration work.

### Component communication

The browser calls `/api` over HTTP. Vite proxies local `/api/*` requests to port 3001, with environment overrides available for isolated testing. The implemented extraction route validates and parses PDFs synchronously without persistence. In Phase 2, the API will persist controlled metadata and create jobs; the worker will consume those jobs and store results. Shared TypeScript contracts prevent the frontend and backend from drifting. The frontend must never import database or engine packages.

---

## Chapter 4 - Repository architecture

```text
apps/web                 React UI and browser-side API client
apps/api                 Hono routes, validation, persistence, job creation
apps/worker              Background job execution
packages/shared          Shared types, schemas, constants, API contracts
packages/database        Prisma schema, generated client, database helpers
packages/document-parser PDF and text extraction
packages/citation-engine Citation parsing and reference resolution
packages/verification-engine Evidence-constrained verdict logic
packages/ui              Reusable React components
packages/config          Shared TypeScript configurations
```

The intended data flow is:

```text
User -> React -> Hono API -> database/job -> worker
                                    |        |
                                    |        +-> document parser
                                    |        +-> citation engine
                                    |        +-> verification engine
                                    v
                            status and results -> React
```

The React interface, health route, extraction route, document parser, shared extraction contracts, and API client now contain meaningful behavior. Worker, persistence, and scientific engines remain placeholders. Package boundaries are documented in the README and should be enforced as implementation grows.

---

## Chapter 5 - Current implementation status

| Feature                                    | Classification           | Current evidence                                       |
| ------------------------------------------ | ------------------------ | ------------------------------------------------------ |
| Monorepo, workspace scripts, configuration | Implemented and verified | Bun workspaces and Turborepo tasks exist.              |
| Responsive navigation and dashboard        | Implemented and verified | React UI includes desktop and mobile rules.            |
| Search and status filter                   | Implemented and verified | Operates on in-memory demo claims.                     |
| Evidence drawer and report preview         | Demonstration-only       | Displays explicitly illustrative content.              |
| PDF selection and client checks            | Implemented and tested   | Enforces PDF selection and the shared 25 MB limit.     |
| Upload and text display                    | Implemented and verified | Live multipart request displays actual extracted text. |
| Hono health endpoint                       | Implemented and verified | Returns a stable health response.                      |
| Document extraction endpoint               | Implemented and tested   | Validates and parses one PDF synchronously.            |
| Background processing                      | Planned                  | Worker only logs startup.                              |
| PDF text extraction                        | Implemented and tested   | `unpdf` 2.2.1 returns page-aware text and metadata.    |
| Claims, citations, evidence, verification  | Planned                  | Engine packages are empty.                             |
| Database domain schema                     | Planned                  | No models exist.                                       |
| Automated tests                            | Implemented              | 11 parser, API, and web tests pass.                    |
| Production deployment                      | Planned                  | No configuration exists.                               |

The UI must not be used as evidence that scientific verification works. Its current purpose is interaction design and a clearly marked preview.

---

## Chapter 6 - PDF upload and parsing

Phase 1 implements `POST /api/documents/extract`. The React screen sends one multipart field named `file`. The API validates the declared content type, PDF signature, single-file request, and 25 MB maximum. Filenames are sanitized display metadata only and are never trusted as paths.

The `packages/document-parser` interface returns normalized full text, page count, page-level text, warnings, and parser name/version. `unpdf` 2.2.1 is pinned behind that interface. Malformed, encrypted, empty, and unexpected failures are mapped to stable safe error codes. OCR is not implemented; an image-only PDF returns `NO_EXTRACTABLE_TEXT`.

Extraction is bounded to 500 pages and a 15-second response timeout, with image-resource limits passed to the parser. The route processes bytes in memory and does not persist uploads or extracted text. Representative multi-column papers, encrypted fixtures, exact size boundaries, and adversarial resource-exhaustion cases still require deeper evaluation before production use.

Implemented parser interface:

```ts
type ParsedPage = { page: number; text: string };
type ParseWarning = { code: string; message: string; page?: number };
type ParsedDocument = {
  text: string;
  pageCount: number;
  pages?: ParsedPage[];
  warnings: ParseWarning[];
};
```

Tests generate a small valid text PDF in memory and cover malformed/signature, wrong media type, missing file, and empty-text behavior. Future hardening must add an encrypted fixture, a precise 25 MB boundary case, an image-only document fixture at the API boundary, and a representative multi-column scientific sample.

---

## Chapter 7 - Scientific claim extraction

A scientific claim is a statement that can be evaluated against evidence, not every sentence. Candidate extraction should prioritize causal, comparative, quantitative, prevalence, safety, efficacy, association, and novelty statements. Methods descriptions, headings, rhetorical transitions, and purely subjective language often require different treatment.

Each candidate should retain exact text, character offsets, page or section, surrounding context, extraction method/version, and uncertainty. The system must allow human correction before verification. Long or compound claims should be split only when meaning and qualifiers are preserved.

Claim extraction can combine deterministic sentence segmentation, domain rules, and a structured model response. Any model output must be schema-validated. A model must not rewrite the claim into a stronger statement. Evaluation should measure boundary accuracy, claim relevance, and preservation of negation, population, intervention, comparator, outcome, timeframe, and uncertainty.

---

## Chapter 8 - Citation extraction and matching

The citation pipeline has two distinct tasks: recognize in-text citation markers and parse bibliography entries. It then associates one or more markers with one or more claims. Styles may be numeric, author-year, footnote-based, ranges, grouped citations, or malformed.

Reference resolution should prefer stable identifiers such as DOI, PMID, or another authoritative identifier. Metadata matching may compare normalized title, authors, venue, and year, but similarity must not silently convert an ambiguous match into certainty. Store candidate matches and confidence factors for review.

One claim may cite several sources; one citation may apply to several clauses; a citation marker at paragraph end may have broad scope. Preserve ambiguity instead of choosing a convenient source. A metadata match confirms a likely record, not support for a claim and not full-text availability.

---

## Chapter 9 - Original research retrieval

Use legitimate metadata and open-access mechanisms. Candidate services include Crossref for DOI metadata, OpenAlex for scholarly metadata and access indicators, PubMed/NCBI services for biomedical records, Unpaywall for open-access locations, and publisher or repository endpoints permitted by their terms. Service selection and current limits must be verified before implementation.

For every retrieved object, record canonical identifier, title, authors, publication date, source URL, access route, retrieval time, content type, license or access indication, and checksum where appropriate. Prefer publisher or trusted repository copies over unverified mirrors.

Never assume that matching metadata grants access to the paper. Paywalled, removed, rate-limited, or inaccessible sources must remain explicit. Do not bypass authentication or access controls. If the required full text is unavailable, the later verdict is `Unable to verify` unless another legitimate source directly supports the same cited evidence and the substitution is disclosed.

---

## Chapter 10 - Evidence extraction

Evidence extraction begins only after trustworthy source content is available. Split source text into traceable passages while retaining page, section, paragraph, and character offsets when available. Retrieve candidates using lexical and semantic similarity, then rerank for relevance to the exact claim and its qualifiers.

Store the exact quoted passage separately from generated explanation. Do not let normalization change scientific meaning. Include enough context to show negation, conditions, population, comparator, and limitations. Tables and figures require special handling; a caption alone may not carry the needed evidence.

The reviewer should be able to open the source, locate the passage, and understand why it was selected. Evidence that only discusses the topic is not necessarily evidence for the claim.

---

## Chapter 11 - AI verification

Verification must be constrained to retrieved evidence. The input bundle should include the exact claim, manuscript context, cited-source identity, exact evidence passages with provenance, and known retrieval limitations. The model must return a validated structure, not free-form hidden reasoning.

Supported verdicts:

- **Supported:** evidence directly supports the material claim and qualifiers.
- **Partially supported:** evidence supports only part or a narrower form.
- **Unsupported:** accessible evidence does not provide the asserted support.
- **Contradictory:** evidence directly conflicts with a material part of the claim.
- **Potentially outdated:** later or date-sensitive evidence may materially change the conclusion.
- **Unable to verify:** required source or sufficient evidence is unavailable, ambiguous, or unparseable.

Every substantive verdict requires cited evidence and a concise explanation linking claim elements to the passage. Absence of evidence is not automatically contradiction. If evidence is unavailable, return `Unable to verify`. Model confidence describes the model's internal certainty under the provided context; it is not independently measured accuracy. Accuracy requires evaluation against human-labelled cases.

---

## Chapter 12 - Backend API contract

The current API convention uses Hono with base path `/api` and JSON responses. `GET /api/health` and `POST /api/documents/extract` are implemented.

The extraction contract is defined in `docs/API_CONTRACT.md`. It uses multipart input and a stable JSON envelope. Error responses include a machine code and safe message. Implemented statuses include 400, 413, 415, 422, 500, and 503.

Later job-oriented APIs should use opaque IDs and explicit state transitions: `queued`, `processing`, `completed`, and `failed`. Job retries must be idempotent. Avoid holding an HTTP request open for retrieval or AI verification. Validate all route parameters and body data at the boundary.

---

## Chapter 13 - Database design

Proposed core models:

- **Document:** owner, safe display name, media type, size, checksum, storage reference, status, timestamps.
- **DocumentPage:** document, page number, extracted text or controlled reference, parser metadata.
- **ProcessingJob:** type, state, attempt count, progress, error code, timestamps, lease data.
- **Claim:** document, exact text, location, context, extraction metadata, review state.
- **Citation:** document, raw marker, parsed fields, bibliography location.
- **SourceRecord:** canonical identifiers, metadata, access status, retrieval provenance.
- **ClaimCitation:** claim-to-citation association with ambiguity data.
- **Evidence:** source record, exact passage, page/section provenance, retrieval/ranking metadata.
- **VerificationResult:** claim, verdict, explanation, model/version, confidence, evidence links, timestamp.
- **HumanReview:** reviewer action, note, prior and new status, timestamp.

Use foreign keys, unique constraints on stable identifiers where safe, timestamps, and explicit enums. Do not overwrite historical verification or review records; append versions for auditability.

SQLite is suitable for local single-machine development. Separate production services cannot safely share a local SQLite file. A managed relational database such as PostgreSQL is the likely production path, with reviewed migrations, backups, restore tests, connection limits, and transaction semantics.

---

## Chapter 14 - Frontend integration

Retain the current interface but introduce an explicit data source boundary. Demo mode continues to use fixture data and remains visibly labelled. Live mode calls the API and must never fall back silently to demo claims.

The upload screen needs idle, validating, uploading, extracting, success, empty-text, and error states. Progress should represent known phases or real byte/job progress; remove the simulated timer from live mode. The results screen should initially show extracted document text and warnings. Claim tables appear only after claim extraction exists.

Provide actionable errors for invalid type, excessive size, encryption, malformed PDF, image-only content, timeout, network failure, and server failure. Preserve accessibility: labelled controls, keyboard navigation, focus management, status announcements, and reduced-motion behavior.

---

## Chapter 15 - Testing and quality assurance

Current exact root commands:

```bash
bun install
bun run lint
bun run typecheck
bun run test
bun run build
bun run dev
bun run db:generate
bun run db:push
bun run db:studio
```

The root `test` script runs Bun tests through Turborepo. Eleven tests currently cover parser success and safe failures, API multipart validation and extraction, and web client success/error handling. A manual browser smoke test uploaded a generated one-page fixture and confirmed that the exact phrase `CiteVerify live browser extraction succeeded.` appeared in the live result.

Remaining Phase 1 hardening includes encrypted, exact-size-boundary, multi-column, mobile, and browser error-state coverage. Future end-to-end automation should preserve the same exact-text assertion used by the smoke test.

Security checks should include dependency review, secret scanning, malicious filenames, oversized requests, malformed PDFs, decompression/resource exhaustion, log redaction, CORS, and temporary-file cleanup. Manual QA should include Safari and at least one Chromium browser at desktop and mobile widths.

No test should assert scientific truth using invented fixture claims. Later verification evaluation needs expert-labelled cases and documented metrics.

---

## Chapter 16 - Deployment

A practical deployment separates static frontend delivery from persistent backend processing. Vercel or Railway may host the frontend; Railway is a candidate for Bun API and worker services. Current runtime support, limits, regions, pricing, and storage behavior must be verified before selection.

Recommended production shape:

```text
Browser -> HTTPS frontend -> HTTPS API -> managed PostgreSQL
                                      -> private object storage
                                      -> durable queue -> worker
```

The API and worker need the same managed database and queue, not one local SQLite file. PDF storage, if enabled, needs private access, encryption, signed URLs where appropriate, and lifecycle deletion. Environment variables belong in platform secret storage. CORS should allow only intended origins. Health checks should distinguish process liveness from dependency readiness.

Monitoring should cover request latency, error rate, upload rejection, extraction duration, queue depth, stuck jobs, worker failures, database connections, storage, and external API failures. Logs need correlation IDs but no paper text or evidence passages. Establish backups, restore drills, cost alerts, and rollback before public launch.

---

## Chapter 17 - Git and GitHub workflow

Use `CiteVerify-AI-1` as the primary development destination. Begin work from updated `main`, create a focused branch, make a small change with tests and documentation, run checks, review the diff, commit, push the feature branch with approval, and open a pull request.

Suggested commands:

```bash
git status
git switch main
git pull --ff-only
git switch -c feature/pdf-upload
git diff
git add <specific-files>
git commit -m "Implement real PDF text extraction"
git push -u origin feature/pdf-upload
```

Use author identity `Kiran Y S <251000745+kiran-ys@users.noreply.github.com>` to avoid GH007 email privacy rejection. Never commit `.env`, database files, uploaded papers, tokens, or build output. Do not force-push shared branches. Recovery should favor new corrective commits, reflog-assisted local recovery, and explicit discussion before any history rewrite.

---

## Chapter 18 - Hackathon demo preparation

Select a legally accessible, redistribution-safe, text-based scientific paper with a stable URL and at least one accessible cited source. Record the expected extracted phrase, citation, source identifier, and evidence passage before the demo. Obtain permission or use an openly licensed sample if the PDF will be bundled.

Judge flow:

1. Explain that demo fixtures and live results are separate.
2. Upload the known PDF.
3. Show actual extracted text and page count.
4. Show a candidate claim in its manuscript context.
5. Show the parsed citation and canonical source record.
6. Open the exact source evidence with page or section provenance.
7. Show the verdict explanation and human-review control.
8. Export or preview a traceable report.

Prepare a second small PDF and a recorded local screen capture. Cache only content whose terms permit it and disclose the cache. If source retrieval fails live, show `Unable to verify` and explain the fallback; never replace the missing source with invented text. Rehearse from a clean clone and confirm that no secret or private paper appears on screen.

---

## Chapter 19 - Troubleshooting

### Bun and PATH

If `bun` is not found, verify `/Users/kiranys/.bun/bin/bun --version` and add `~/.bun/bin` to the shell PATH. Turborepo also needs Bun discoverable on PATH, even when Bun was invoked by absolute path.

### Dependencies and Vite

Run `bun install` at the repository root. If Vite fails, confirm the workspace dependencies and port 5173 availability. Check browser console and terminal output. Do not delete lockfiles as a first response.

### API, CORS, and worker

Confirm `.env` exists locally, `API_PORT` is available, and `GET /api/health` responds. In development, Vite proxies `/api`; production requires explicit origins and HTTPS. The current worker only logs startup, so no processing should be expected until jobs are implemented.

### PDF parsing

Differentiate invalid, encrypted, image-only, and text-encoding failures. Reproduce with a minimal permitted fixture. Record parser version and warning output. Do not send private PDFs to third-party debugging services.

### TypeScript and Prisma

Run `bun run typecheck` from the root. Prisma generation may need write access to its engine cache. Run `bun run db:generate` after schema changes and review migrations or `db push` effects before modifying shared data. The baseline schema has no models.

### GitHub

Check `git remote -v`, authentication, and branch before pushing. GH007 means a commit exposes an email protected by GitHub privacy settings; configure the noreply email and amend only the unpublished or explicitly approved commit. Never paste tokens into source or chat.

### Deployment

Check environment variables, runtime compatibility, database connectivity, migrations, CORS, health checks, persistent storage, and worker logs. A successful build alone does not prove the service can persist data or process jobs.

---

## Chapter 20 - Final acceptance checklist

### Foundation

- [ ] Clean clone installs with the pinned Bun version.
- [ ] Lint, typecheck, tests, and build pass in CI.
- [ ] README and status documents match actual behavior.

### PDF extraction

- [x] A controlled real PDF uploads and produces actual text.
- [x] Page count and page-level text are returned where supported.
- [ ] Invalid, oversized, malformed, encrypted, and image-only cases are tested.
- [x] Uploaded content is not logged, committed, or retained without policy.

### Claims and citations

- [ ] Claims retain exact text, location, context, and uncertainty.
- [ ] Bibliography and in-text markers are associated with reviewable ambiguity.
- [ ] DOI or metadata matches are not described as evidence support.

### Retrieval and evidence

- [ ] Retrieval uses legitimate access routes and records provenance.
- [ ] Paywalled or unavailable sources remain explicit.
- [ ] Evidence quotes are exact and traceable to page or section.

### Verification

- [ ] Verdicts use only supplied evidence.
- [ ] Every substantive verdict links evidence and explanation.
- [ ] Missing evidence returns `Unable to verify`.
- [ ] Accuracy is measured independently from model confidence.

### User experience and reports

- [x] Demo mode and live extraction are visibly separated.
- [ ] Loading, empty, error, and unavailable states are accessible.
- [ ] Reports preserve source identity, evidence, model metadata, and human review.

### Deployment and operations

- [ ] API, worker, managed database, queue, and storage survive restart tests.
- [ ] HTTPS, restricted CORS, authentication, secret storage, and deletion are verified.
- [ ] Backups, restore, monitoring, cost alerts, and rollback are tested.
- [ ] Public deployment has explicit approval.

### Hackathon demonstration

- [ ] The chosen PDF and sources are legally accessible.
- [ ] The complete flow is rehearsed from a clean environment.
- [ ] Fallback behavior shows honest limitations.
- [ ] No claim of real verification is made without actual evidence.

---

## Immediate next action

Review and commit the completed `feature/pdf-upload` slice after inspecting the diff. Then begin Phase 2 with document and processing-job models, controlled storage references, worker execution, status polling, and retry-safe state transitions. Do not begin claim extraction or verification until durable processing is designed and tested.
