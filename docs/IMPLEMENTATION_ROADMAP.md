# CiteVerify AI Implementation Roadmap

## Phase 0 - Documentation baseline

- [x] Inspect current repository and separate implemented behavior from placeholders.
- [x] Add agent instructions, project status, proposed API contract, deployment checklist, and master handbook.
- [ ] Review documentation with the project owner.

## Phase 1 - Real PDF upload and extraction

Goal: upload one text-based scientific PDF and display real extracted text.

1. Add shared upload response and error types.
2. Select a maintained Bun-compatible TypeScript PDF extraction library after a small compatibility spike.
3. Implement parser output with document text, page count, per-page text when supported, warnings, and extraction metadata.
4. Add `POST /api/documents/extract` with multipart validation.
5. Enforce PDF signature, MIME allowlist, 25 MB maximum, single-file request, request timeout, and safe errors.
6. Connect the existing React upload screen to the endpoint.
7. Add loading, error, empty-text, and success views; remove simulated progress from live mode.
8. Add unit tests for validation and parser behavior plus an API integration test.
9. Add legally redistributable fixtures: one small text PDF, one malformed file, and one image-only PDF.
10. Run lint, typecheck, tests, and build; update status documents.

Acceptance evidence:

- A real PDF produces actual extracted text in the browser.
- Invalid, oversized, malformed, encrypted, and image-only inputs fail safely or return explicit warnings.
- No uploaded document or text is logged or committed.
- Demo mode remains visibly separate.

## Phase 2 - Durable processing jobs

- Add document and processing-job models.
- Store metadata and controlled file references, not arbitrary filenames.
- Move expensive parsing to the worker when synchronous limits become restrictive.
- Add job status polling and retry-safe state transitions.

## Phase 3 - Claim extraction

- Identify candidate scientific claims with source offsets and context.
- Preserve exact manuscript text and uncertainty.
- Add human correction before downstream verification.

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

