# CiteVerify AI Project Status

Last inspected: 2026-11-19

## Repository baseline

- Repository: `https://github.com/kiran-ys/CiteVerify-AI-1`
- Active implementation branch: `feature/claim-extraction`
- Baseline commit: `0febd7b` (`Add live PDF upload and text extraction`)
- Milestone 2 changes are uncommitted and awaiting owner review.
- Application stack: Bun, Turborepo, TypeScript, React, Vite, Tailwind CSS, Hono, Prisma, SQLite

## Status summary

| Area                 | Status                       | Evidence and limitation                                                                                                           |
| -------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo scaffolding | Implemented and verified     | Apps and packages exist; install, lint, typecheck, test, and build pass.                                                          |
| Responsive frontend  | Implemented and verified     | Dashboard, upload screen, result filtering, evidence drawer, and report preview are implemented in React.                         |
| Demo labelling       | Implemented and verified     | Demo claims and verdicts remain visibly separate from live extraction and extracted claims.                                       |
| API health route     | Implemented and verified     | `GET /api/health` returns `{ "status": "ok" }`.                                                                                   |
| PDF upload           | Implemented and verified     | `POST /api/documents/extract` validates and parses one PDF in memory.                                                             |
| Claim extraction     | Implemented, awaiting review | `POST /api/documents/claims` returns unverified candidate claims with page, offsets, section, and context. Quality is unmeasured. |
| Worker               | Placeholder                  | It logs `[worker] started`; no job consumption exists.                                                                            |
| Document parser      | Implemented and verified     | `unpdf` 2.2.1 returns full text, page text, page count, warnings, and parser metadata.                                            |
| Claim extractor      | Implemented and tested       | `packages/claim-extractor` rule-based v1.0.0; deterministic and offline; no LLM or paid API.                                      |
| Citation engine      | Placeholder                  | Package exports nothing.                                                                                                          |
| Verification engine  | Placeholder                  | Package exports nothing.                                                                                                          |
| Shared contracts     | Implemented                  | Upload limits, extraction, claim, and error contracts are shared by the API, extractor, and web client.                           |
| Shared UI package    | Placeholder                  | Package exports nothing.                                                                                                          |
| Database             | Configured, no domain models | Prisma client and SQLite URL resolution exist; schema contains no models.                                                         |
| Automated tests      | Implemented and passing      | 53 Bun tests: claim extractor 31, API 11, web client 7, parser 4.                                                                 |
| Deployment           | Planned                      | No CI, container, or hosting configuration exists.                                                                                |

## Completed milestones

### Milestone 1 - PDF upload and text extraction (committed `0febd7b`)

`React upload -> Hono API -> document parser -> extracted text -> React display`

The endpoint validates one `application/pdf` file up to 25 MB, checks its signature, parses at most 500 pages with a 15-second response timeout, and returns page-aware output. Files and extracted text are processed in memory and are not persisted. The owner reports a successful test with a 16-page scientific paper (38,731 extracted characters).

### Milestone 2 - Scientific claim extraction (uncommitted, awaiting review)

`React upload -> POST /api/documents/claims -> parsePdf -> extractClaims -> React "Extracted claims — not yet verified"`

How the rule-based extractor (v1.0.0) works:

1. Splits each page's extracted text into lines, dropping page numbers and running headers or footers (lines repeated on at least half the pages, for documents of three or more pages).
2. Detects standard section headings (Abstract, Introduction, Methods, Results, Discussion, Conclusion, References, and administrative sections), including numbered headings and structured-abstract labels.
3. Splits text blocks into sentences, respecting abbreviations (`et al.`, `Fig.`, `e.g.`), initials, decimals, and figure or table labels.
4. Rejects non-claims: Methods, References, and administrative sections; incomplete or page-spanning fragments; questions; title-case lines and author lists; contact and affiliation lines; publication metadata; figure and table captions; reference-style entries; aims and paper outlines; reading pointers such as "see [3-5]"; and uncited Introduction background.
5. Accepts a sentence as a `reported_finding` when it contains first-person or "results show" wording, a statistical result (p-value, confidence interval, effect statistic), significance wording, or a quantified comparison; or as a `cited_claim` when it carries a numeric or author-year citation marker.
6. Returns the exact sentence, page, character offsets into that page's text, section, neighbouring sentences, claim type, and the names of the rules that matched. No verdict or confidence score is produced.

## Next milestone

Owner review of claim extraction on real papers. Then either Phase 2 (durable documents and processing jobs) or claim-extraction hardening: a measured evaluation set, human correction of claims, and two-column layout handling. Citation association and verification remain deferred.

## Validation

Milestone 2, executed 2026-11-19 with Bun 1.4.4 (`--force`, no cache replay):

- `bun install` - passed
- `bun run lint` - 10 workspace lint tasks passed
- `bun run typecheck` - 11 workspace typecheck tasks passed
- `bun run test` - 53 tests passed across claim-extractor, API, web, and parser packages
- `bun run build` - API, worker, and web production builds passed
- Browser smoke test - a generated four-page paper uploaded through the real Upload screen produced 8 candidate claims on the expected pages; titles, authors, affiliation, Methods, a figure caption, a "see [3-5]" pointer, an aims sentence, and references were excluded. The claim-type filter, details toggle, and 375 px mobile layout were checked. The API log contained no document text.

Milestone 1 validation (2026-11-19): lint 9/9, typecheck 10/10, 13 tests, build 4/4, and a browser smoke test with a generated one-page PDF.

## Known limitations and deferred work

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
- `docs/CITEVERIFY_MASTER_HANDBOOK.md` and its PDF do not yet describe the claim-extractor package; update and regenerate them after owner review.
- CI, persistence, worker jobs, authentication, and deployment remain unimplemented.
- Define retention policy before persisting uploaded files.
