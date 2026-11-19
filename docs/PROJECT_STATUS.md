# CiteVerify AI Project Status

Last inspected: 2026-11-19

## Repository baseline

- Repository: `https://github.com/kiran-ys/CiteVerify-AI-1`
- Active implementation branch: `feature/evidence-retrieval`
- Baseline commit: `a63c58e` (`Add citation extraction and matching within uploaded papers`)
- Milestone 4 changes are uncommitted and awaiting owner review.
- Application stack: Bun, Turborepo, TypeScript, React, Vite, Tailwind CSS, Hono, Prisma, SQLite

## Status summary

| Area                 | Status                       | Evidence and limitation                                                                                                           |
| -------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo scaffolding | Implemented and verified     | Apps and packages exist; install, lint, typecheck, test, and build pass.                                                          |
| Responsive frontend  | Implemented and verified     | Dashboard, upload screen, result filtering, evidence drawer, and report preview are implemented in React.                         |
| Demo labelling       | Implemented and verified     | Demo claims and verdicts remain visibly separate from live extraction and extracted claims.                                       |
| API health route     | Implemented and verified     | `GET /api/health` returns `{ "status": "ok" }`.                                                                                   |
| PDF upload           | Implemented and verified     | `POST /api/documents/extract` validates and parses one PDF in memory.                                                             |
| Claim extraction     | Implemented (committed)      | `POST /api/documents/claims` returns unverified candidate claims with page, offsets, section, and context. Quality is unmeasured. |
| Citation matching    | Implemented (committed)      | `POST /api/documents/citations` links in-text citations to the paper's own reference list; matches are not evidence.              |
| Source retrieval     | Implemented, awaiting review | `POST /api/documents/evidence` resolves cited references and retrieves accessible text; opt-in; never a verdict.                  |
| Worker               | Placeholder                  | It logs `[worker] started`; no job consumption exists.                                                                            |
| Document parser      | Implemented and verified     | `unpdf` 2.2.1 returns full text, page text, page count, warnings, and parser metadata.                                            |
| Claim extractor      | Implemented and tested       | `packages/claim-extractor` rule-based v1.0.0; deterministic and offline; no LLM or paid API.                                      |
| Citation engine      | Implemented and tested       | `packages/citation-engine` rule-based v1.0.0; reference list, metadata, citation detection, and matching; offline, no lookups.    |
| Verification engine  | Placeholder                  | Package exports nothing.                                                                                                          |
| Evidence retrieval   | Implemented and tested       | `packages/evidence-retrieval` v1.0.0; Crossref, OpenAlex, Europe PMC, PubMed Central; free and keyless; term-overlap passages.    |
| Shared contracts     | Implemented                  | Upload, extraction, claim, citation, and error contracts are shared by the API, engines, and web client.                          |
| Shared UI package    | Placeholder                  | Package exports nothing.                                                                                                          |
| Database             | Configured, no domain models | Prisma client and SQLite URL resolution exist; schema contains no models.                                                         |
| Automated tests      | Implemented and passing      | 133 Bun tests pass offline (evidence 36, claims 31, citations 25, API 22, web 15, parser 4); 1 opt-in live network test.          |
| Deployment           | Planned                      | No CI, container, or hosting configuration exists.                                                                                |

## Completed milestones

### Milestone 1 - PDF upload and text extraction (committed `0febd7b`)

`React upload -> Hono API -> document parser -> extracted text -> React display`

The endpoint validates one `application/pdf` file up to 25 MB, checks its signature, parses at most 500 pages with a 15-second response timeout, and returns page-aware output. Files and extracted text are processed in memory and are not persisted. The owner reports a successful test with a 16-page scientific paper (38,731 extracted characters).

### Milestone 2 - Scientific claim extraction (committed `0fe210b`)

`React upload -> POST /api/documents/claims -> parsePdf -> extractClaims -> React "Extracted claims — not yet verified"`

How the rule-based extractor (v1.0.0) works:

1. Splits each page's extracted text into lines, dropping page numbers and running headers or footers (lines repeated on at least half the pages, for documents of three or more pages).
2. Detects standard section headings (Abstract, Introduction, Methods, Results, Discussion, Conclusion, References, and administrative sections), including numbered headings and structured-abstract labels.
3. Splits text blocks into sentences, respecting abbreviations (`et al.`, `Fig.`, `e.g.`), initials, decimals, and figure or table labels.
4. Rejects non-claims: Methods, References, and administrative sections; incomplete or page-spanning fragments; questions; title-case lines and author lists; contact and affiliation lines; publication metadata; figure and table captions; reference-style entries; aims and paper outlines; reading pointers such as "see [3-5]"; and uncited Introduction background.
5. Accepts a sentence as a `reported_finding` when it contains first-person or "results show" wording, a statistical result (p-value, confidence interval, effect statistic), significance wording, or a quantified comparison; or as a `cited_claim` when it carries a numeric or author-year citation marker.
6. Returns the exact sentence, page, character offsets into that page's text, section, neighbouring sentences, claim type, and the names of the rules that matched. No verdict or confidence score is produced.

### Milestone 3 - Citation extraction and matching (committed `a63c58e`)

`React upload -> POST /api/documents/citations -> parsePdf -> extractClaims -> extractCitations -> React "Citation matched — evidence not yet verified"`

How the rule-based citation engine (v1.0.0) works:

1. Finds the last References/Bibliography/Literature cited heading and reads lines until an Appendix, Supplementary, Acknowledgements, or similar heading, dropping running headers and page numbers.
2. Splits entries. Numbered lists (`[n]`, `n.`, `n `) start a new entry only at the next expected number, so wrapped years or page numbers cannot start false entries. Author-year lists start a new entry at a "Surname, Initials" or full-name author line that follows a line ending an entry.
3. Reads authors, year, title, and DOI from each entry's own text for IEEE (quoted title), APA/Harvard (parenthesised year), Vancouver, and full-name styles. Unclear fields stay empty; nothing is fetched or inferred.
4. Detects in-text markers outside the reference list: `[1]`, `[2, 3]`, `[4-7]` (ascending ranges of at most 50), `(Smith et al., 2020; Lee and Park, 2019)`, `(Brown, 2020a, 2020b)`, and narrative `Smith et al. (2020)`. Common capitalised words such as "In (2020)" are not read as authors.
5. Matches each cited item: numbers to the entry with that number; author-year items to entries whose first author has the cited surname (plus any second named author) and whose year matches. One candidate is `matched`, none is `unmatched` with a reason, several are `ambiguous` with every candidate listed.
6. Links each marker to the extracted claim containing it. The Upload screen shows each claim's citations with the matched entry's exact text and parsed fields.

### Milestone 4 - Source and evidence retrieval (uncommitted, awaiting review)

`React "Retrieve cited sources" -> POST /api/documents/evidence -> parsePdf -> extractClaims -> extractCitations -> retrieveEvidence -> React "Source retrieved — claim not yet verified"`

How retrieval (`packages/evidence-retrieval` v1.0.0) works:

1. Takes only references that a matched citation inside an extracted claim points to (at most 25 per request).
2. Resolves each one: Crossref DOI lookup when the reference has a DOI, otherwise Crossref bibliographic search, then OpenAlex search. A record is accepted only when its whole title matches the cited title (or the cited title plus a subtitle), it is not a letter or reply, its year is within one, its first author is named in the reference, and its first page appears in the reference when both give pagination. Several survivors are narrowed only by volume and first page; otherwise the result is `ambiguous`.
3. Looks the work up in Europe PMC. Open-access works get full text from Europe PMC, falling back to PubMed Central (NCBI); others get the Europe PMC or Crossref abstract when one exists. Access is reported as `full_text`, `abstract_only`, `metadata_only`, or `unavailable`.
4. Picks at most two sentences per claim that share key terms with it, keeping exact text, section, paragraph, sentence, source URL, and shared terms.
5. Handles timeouts, rate limits (`Retry-After`), server errors, and service outages per source, with a 60-second budget, per-service concurrency (Crossref one at a time), and a 6-hour in-memory cache.

Retrieval is opt-in on the Upload screen because it sends cited-reference details (never the PDF) to external services.

### Real-paper result (genuine open-access paper)

The owner's DREW paper was not available. The genuine open-access paper Ioannidis JPA (2005) "Why most published research findings are false", _PLoS Med_ 2(8): e124 (CC BY), was downloaded from the publisher into the git-ignored `tmp/` folder and run through `POST /api/documents/evidence` on 2026-11-19:

- 6 pages, 37,392 characters, 29 candidate claims; 37 numbered references found; 47 cited items in 30 markers (46 matched, 1 ambiguous).
- 35 references cited within claims; 25 looked up (10 skipped by the per-request limit). Completed in 60.6 s.
- Resolved 24 of 25 to a genuine record (20 via Crossref, 4 via OpenAlex); 1 unresolved (ref 12, a textbook: Kelsey et al., _Methods in Observational Epidemiology_, 2nd ed.).
- Access: 9 abstract only, 15 metadata only, 0 full text; 8 passages selected. Europe PMC timed out on 14 lookups during this run, so many "metadata only" results mean availability could not be checked; the response says so for each source.
- Ref 20 (ICH E9 guideline) resolved via OpenAlex to PubMed record 10532877; that record has no DOI and no authors, so it was accepted on title prefix and year alone.
- Full-text retrieval was verified separately against the same paper's own Europe PMC record (PMC1182327) with the opt-in live test.
- An earlier run exposed letters, replies, and reprints being accepted as matches; the identity check was tightened and regression tests added from those genuine cases.

## Next milestone

Owner review of source retrieval, ideally on the DREW paper. Then Phase 2 durable jobs so retrieval can run in the worker with progress reporting and a shared cache, followed by a measured evaluation of claim, citation, and source resolution accuracy. Verification remains deferred.

## Validation

Milestone 4, executed 2026-11-19 with Bun 1.4.4 (`--force`, no cache replay):

- `bun install` - passed
- `bun run lint` - 11 workspace lint tasks passed
- `bun run typecheck` - 12 workspace typecheck tasks passed
- `bun run test` - 131 tests passed offline; 1 live test skipped by default
- `RUN_NETWORK_TESTS=1 bun test` in `packages/evidence-retrieval` - live test passed twice: once with Ioannidis 2005 resolved by DOI and full text from Europe PMC (2 passages); once while Europe PMC returned HTTP 503, correctly reported as metadata only with the outage listed
- `bun run build` - API, worker, and web production builds passed
- Browser smoke test - the genuine paper uploaded through the Upload screen; extraction showed 37 references with no lookups until "Retrieve cited sources" was clicked; retrieval completed through the Vite proxy (35 sources: 10 abstract only, 13 metadata only, 12 unavailable including 10 skipped), showing labels, access badges, passages, and per-service errors; no horizontal scrolling at desktop width or 375 px; API logs contained no document text.

Milestone 3 validation (2026-11-19): lint 10/10, typecheck 11/11, 87 tests, build 4/4, and a browser smoke test with a generated three-page paper.

Milestone 2 validation (2026-11-19): lint 10/10, typecheck 11/11, 53 tests, build 4/4, and a browser smoke test with a generated four-page paper.

Milestone 1 validation (2026-11-19): lint 9/9, typecheck 10/10, 13 tests, build 4/4, and a browser smoke test with a generated one-page PDF.

## Local development troubleshooting

Investigated 2026-11-19 after a "Failed to fetch" report:

- Run exactly one API. `bun run dev` starts Vite on 5173 (proxying `/api` to 3001) and the API on 3001. If another API process already holds 3001, the new `bun --watch` API fails with `EADDRINUSE` and stays alive without listening; Vite then returns `502` for every `/api` request. Check with `lsof -nP -iTCP:3001 -sTCP:LISTEN` and stop the extra process, then restart `bun run dev`.
- A missing root `.env` is harmless; the `dev` script's `--env-file=../../.env` simply loads nothing.
- "Failed to fetch" means no HTTP response arrived at all, usually because the page's own dev server stopped (for example a page left open on a port that is no longer served). The web client now reports this as "Could not reach the CiteVerify server" with what to check. A stopped API behind a running Vite shows "The extraction service is unavailable (HTTP 502)".
- Vite listens on `[::1]:5173`; use `http://localhost:5173`, not `127.0.0.1`.
- Source retrieval takes about 60 seconds; the Vite proxy and the API (`idleTimeout: 120`) both allow it. Verified through `localhost:5173` with the genuine Ioannidis (2005) paper: 24 of 25 looked-up references resolved and 6 abstract passages returned (Europe PMC timed out 10 times, so full-text availability for those sources is unknown).

## Known limitations and deferred work

Source retrieval:

- A retrieved source is not evidence that the claim is supported. Passages are chosen by shared words, which can surface unrelated or contradicting text.
- Resolution accuracy has not been measured on a labelled set. On one genuine paper, 24 of 25 attempted references resolved; the DREW paper is untested.
- Retrieval runs synchronously inside the HTTP request (about 60 s for 25 references) and repeats the PDF, claim, and citation work; Phase 2 should move it to the worker.
- At most 25 references are looked up per request.
- External services vary: Europe PMC timed out repeatedly during testing. Unreachable services are reported per source, never as "not found".
- Full text is limited to the Europe PMC open-access subset; publisher sites, preprint servers, and repositories are not fetched.
- OpenAlex abstracts are not used because they are stored as word indexes and cannot reproduce exact wording.
- References without a DOI, title, or recognisable author (books, guidelines, reports) often stay unresolved or resolve on weaker evidence, as with the ICH E9 guideline.
- The cache is per process and in memory; several API instances would each query the services.

Citation matching:

- Matching works only **within the uploaded paper**. A match does not show that the cited source exists, is accessible, or supports the claim.
- Accuracy has **not been measured** on real papers, including the owner's DREW paper.
- Superscript numeric citations cannot be distinguished from ordinary digits in extracted text and are not detected.
- Two-column reference lists can be interleaved by `unpdf`, which can merge or split entries.
- Numbered lists must count up from 1 without gaps; other numbering falls back to author-year splitting, which then cannot match numbered citations.
- Author-year matching compares the first author's surname and year; papers citing an author by a different spelling, transliteration, or organisation name will be unmatched.
- Metadata parsing covers common IEEE, APA/Harvard, Vancouver, and full-name styles; other styles may leave fields empty.
- A DOI broken across lines is read only up to the line break.
- Citation styles such as `(Smith 2020, p. 4)` with page locators, `Smith et al., 2020` without parentheses, and footnote citations are not detected.

Claim extraction:

- Rule-based extraction has **no semantic understanding**. It selects sentences by surface wording, so it misses claims phrased without cue words and can select sentences that only mention a citation or a number.
- Precision and recall have **not been measured** on real papers. Do not describe extraction quality until an evaluation set exists.
- Two-column PDFs can interleave columns in `unpdf`'s text order, which can merge or cut sentences. Cut sentences are skipped rather than guessed.
- Sentences that cross a page boundary are skipped; the continuation on the next page is shown only as context.
- Superscript citation numbers are indistinguishable from ordinary digits in extracted text, so superscript-style citations are not detected as citation markers.
- Section detection depends on conventional English headings. Papers without them are treated as one unknown section, where only finding or citation signals apply.
- Methods sections are excluded entirely, including any genuine claims inside them.
- A line-break hyphen is preserved as written (`signifi-cant`) because removing it could alter genuine hyphenated terms.
- At most 300 claims are returned per document; the response says when it was truncated.
- Claim IDs are sequential per response and are not durable until persistence exists.
- The global app header still shows the "DEMO DATA" pill on every screen, including the Upload screen with live results; the live panels are separately labelled.

General:

- OCR is not implemented; image-only PDFs return `NO_EXTRACTABLE_TEXT`.
- The 15-second timeout ends the HTTP request but does not stop the parser; a document still loading when the timeout fires is not cleaned up.
- Processing is synchronous and in memory; the timeout does not yet provide durable cancellation or resumability.
- Automated coverage does not yet include a real encrypted fixture, a 25 MB boundary fixture, or a representative multi-column scientific paper.
- `docs/CITEVERIFY_MASTER_HANDBOOK.md` and its PDF do not yet describe the claim-extractor, citation-engine, or evidence-retrieval work; update and regenerate them after owner review.
- CI, persistence, worker jobs, authentication, and deployment remain unimplemented.
- Define retention policy before persisting uploaded files.
