# CiteVerify AI Implementation Roadmap

## Phase 0 - Documentation baseline

- [x] Inspect current repository and separate implemented behavior from placeholders.
- [x] Add agent instructions, project status, proposed API contract, deployment checklist, and master handbook.
- [x] Review documentation with the project owner and proceed to implementation.

## Phase 1 - Real PDF upload and extraction

Goal: upload one text-based scientific PDF and display real extracted text.

1. [x] Add shared upload response and error types.
2. [x] Select and pin a Bun-compatible parser (`unpdf` 2.2.1) after a compatibility spike.
3. [x] Return document text, page count, per-page text, warnings, and parser metadata.
4. [x] Add `POST /api/documents/extract` with multipart validation.
5. [x] Enforce PDF signature, MIME allowlist, 25 MB maximum, single-file request, timeout, page limit, and safe errors.
6. [x] Connect the React upload screen to the endpoint.
7. [x] Add loading, error, empty-text, and success views; remove simulated progress from live extraction.
8. [x] Add parser, API integration, and web API-client tests.
9. [x] Generate controlled PDF fixtures in memory so document bytes are not committed.
10. [x] Run lint, typecheck, tests, build, and a browser smoke test; update status documents.

Acceptance evidence:

- [x] A real PDF produces actual extracted text in the browser.
- [ ] Invalid, oversized, malformed, encrypted, and image-only inputs all have dedicated fixtures. Current automated coverage verifies valid, malformed/signature, wrong media type, missing file, and empty-text behavior; remaining boundary fixtures are deferred.
- [x] No uploaded document or text is logged, committed, or persisted.
- [x] Demo mode remains visibly separate.

Phase 1 is functionally complete and ready for review. The unchecked fixture matrix above is hardening work, not permission to claim OCR, encryption support, or production readiness.

## Phase 2 - Durable processing jobs

- Add document and processing-job models.
- Store metadata and controlled file references, not arbitrary filenames.
- Move expensive parsing to the worker when synchronous limits become restrictive.
- Add job status polling and retry-safe state transitions.

## Phase 3 - Claim extraction

Sequencing change (2026-11-19): at the project owner's direction, a synchronous, in-memory first slice of claim extraction was built before Phase 2 durable jobs. Phase 2 remains required before persistence or long-running processing.

Goal: show unverified candidate claims from the real uploaded paper, with exact wording and page provenance.

1. [x] Add a deterministic, offline `packages/claim-extractor` (rule-based v1.0.0) that reuses the parser's per-page text.
2. [x] Detect section headings; exclude front-matter metadata, Methods, References, and administrative sections; keep Introduction sentences only when they are cited or preview this paper's results.
3. [x] Return claim ID, exact text, page, character offsets, section, neighbouring-sentence context, claim type, method, version, and matched rules.
4. [x] Add `POST /api/documents/claims`, reusing upload validation and `parsePdf`.
5. [x] Show "Extracted claims — not yet verified" on the Upload screen, separate from demo verification results.
6. [x] Test genuine findings, cited claims, non-claims, page mapping (including a generated multi-page PDF), empty documents, and truncation.
7. [ ] Evaluate precision and recall on a set of representative real papers, including two-column layouts, before relying on the rules.
8. [ ] Add human correction (accept, reject, edit boundaries) before downstream verification.

Acceptance evidence:

- [x] Claims are slices of the server's own extracted page text; offsets are tested against the returned pages.
- [x] No verdicts, confidence scores, or demo content appear in claim output.
- [ ] Measured extraction quality on real papers. Rule-based output is unmeasured until item 7 is done.

## Phase 4 - Citation extraction and association

- Parse bibliography entries and in-text citations.
- Resolve DOI and metadata conservatively.
- Associate claims with citations and expose ambiguous matches for review.

## Phase 5 - Source retrieval and evidence extraction

- Query legitimate metadata and open-access services.
- Track access status, license, retrieval time, and canonical source identity.
- Extract passages with page or section provenance and relevance scores.

## Phase 6 - Evidence-constrained verification

- Produce Supported, Partially supported, Unsupported, Contradictory, Potentially outdated, or Unable to verify.
- Require evidence for substantive verdicts.
- Add evaluation datasets and measure performance separately from model confidence.

## Phase 7 - Reports and deployment

- Generate traceable human-review reports.
- Migrate production persistence away from a local SQLite file when services are separated.
- Add CI, managed database, controlled object storage, HTTPS, CORS policy, monitoring, backups, and incident procedures.
