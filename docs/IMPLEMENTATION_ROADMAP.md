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

Goal: link each extracted claim's in-text citations to entries in the same paper's reference list, with explicit unmatched and ambiguous results.

1. [x] Implement `packages/citation-engine` (rule-based v1.0.0): find the reference list, split numbered and author-year entries (including full-name ML-style lists), and drop running headers.
2. [x] Read authors, year, title, and DOI from each entry's own text only; leave unclear fields empty.
3. [x] Detect numeric (`[1]`, `[2, 3]`, `[4-7]`) and author-year (parenthetical and narrative) citations with exact markers and page offsets.
4. [x] Match cited items by number, or by first-author surname and year; report `unmatched` and `ambiguous` with reasons instead of choosing.
5. [x] Add `POST /api/documents/citations`, reusing upload validation, `parsePdf`, and `extractClaims`.
6. [x] Show matched references under each extracted claim, labelled "Citation matched — evidence not yet verified".
7. [x] Test numbered, ranged, listed, author-year, narrative, missing, ambiguous, repeated, and no-reference-list cases, plus a real generated PDF through the API.
8. [ ] Validate on representative real papers (including the owner's 16-page DREW paper and two-column layouts) and record measured match accuracy.
9. [ ] Resolve DOIs and metadata against external registries conservatively (Phase 5 dependency).
10. [ ] Let reviewers correct or confirm ambiguous and unmatched citations.

Acceptance evidence:

- [x] Every marker and single-page reference entry maps back to the returned page text by offsets.
- [x] Responses contain no verdicts, support labels, or confidence scores.
- [ ] Measured matching accuracy on real papers.

## Phase 5 - Source retrieval and evidence extraction

Sequencing note (2026-11-19): built synchronously, in memory, and opt-in from the Upload screen before Phase 2 durable jobs, at the project owner's direction.

1. [x] Add `packages/evidence-retrieval` (v1.0.0) using only free, keyless services: Crossref, OpenAlex, Europe PMC, and PubMed Central (NCBI E-utilities).
2. [x] Resolve each reference that a claim cites: DOI lookup with an identity check, then bibliographic search; accept a record only when whole title, year (within one), first author, and (when given) first page agree with the reference; report `ambiguous` and `unresolved` with reasons.
3. [x] Classify access as `full_text` (Europe PMC open-access subset, with PubMed Central fallback), `abstract_only`, `metadata_only`, or `unavailable`, and never describe an unreachable service as "not found".
4. [x] Select passages by term overlap with the claim, keeping exact sentence text, section, paragraph, sentence, source URL, and shared terms.
5. [x] Handle timeouts, HTTP 429 with `Retry-After`, server errors, per-service concurrency, an overall time budget, and a per-request source limit.
6. [x] Add `POST /api/documents/evidence` and an opt-in "Retrieve cited sources" control labelled "Source retrieved — claim not yet verified".
7. [x] Test with fixtures trimmed from real service responses, real-paper identity cases, and an opt-in live test against a genuine open-access paper.
8. [ ] Move retrieval to the worker with durable jobs, a shared cache, and progress reporting (Phase 2 dependency).
9. [ ] Measure resolution precision and recall on a labelled set of real reference lists.
10. [ ] Replace term overlap with a reviewed passage-relevance method; keep it separate from verification.

Acceptance evidence:

- [x] Every returned title, DOI, URL, and passage comes from a service response or from identifiers those services returned.
- [x] No verdicts, support labels, or confidence scores are produced.
- [ ] Measured resolution accuracy on real papers.

## Phase 6 - Evidence-constrained verification

- Produce Supported, Partially supported, Unsupported, Contradictory, Potentially outdated, or Unable to verify.
- Require evidence for substantive verdicts.
- Add evaluation datasets and measure performance separately from model confidence.

## Phase 7 - Reports and deployment

- Generate traceable human-review reports.
- Migrate production persistence away from a local SQLite file when services are separated.
- Add CI, managed database, controlled object storage, HTTPS, CORS policy, monitoring, backups, and incident procedures.
