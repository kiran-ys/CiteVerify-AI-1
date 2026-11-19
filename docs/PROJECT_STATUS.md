# CiteVerify AI Project Status

Last inspected: 2026-11-19

## Repository baseline

- Repository: `https://github.com/kiran-ys/CiteVerify-AI-1`
- Active implementation branch: `feature/citation-matching`
- Baseline commit: `0fe210b` (`Add rule-based scientific claim extraction`)
- Milestone 3 changes are uncommitted and awaiting owner review.
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
| Citation matching    | Implemented, awaiting review | `POST /api/documents/citations` links in-text citations to the paper's own reference list; matches are not evidence.              |
| Worker               | Placeholder                  | It logs `[worker] started`; no job consumption exists.                                                                            |
| Document parser      | Implemented and verified     | `unpdf` 2.2.1 returns full text, page text, page count, warnings, and parser metadata.                                            |
| Claim extractor      | Implemented and tested       | `packages/claim-extractor` rule-based v1.0.0; deterministic and offline; no LLM or paid API.                                      |
| Citation engine      | Implemented and tested       | `packages/citation-engine` rule-based v1.0.0; reference list, metadata, citation detection, and matching; offline, no lookups.    |
| Verification engine  | Placeholder                  | Package exports nothing.                                                                                                          |
| Shared contracts     | Implemented                  | Upload, extraction, claim, citation, and error contracts are shared by the API, engines, and web client.                          |
| Shared UI package    | Placeholder                  | Package exports nothing.                                                                                                          |
| Database             | Configured, no domain models | Prisma client and SQLite URL resolution exist; schema contains no models.                                                         |
| Automated tests      | Implemented and passing      | 87 Bun tests: claim extractor 31, citation engine 25, API 17, web client 10, parser 4.                                            |
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

### Milestone 3 - Citation extraction and matching (uncommitted, awaiting review)

`React upload -> POST /api/documents/citations -> parsePdf -> extractClaims -> extractCitations -> React "Citation matched — evidence not yet verified"`

How the rule-based citation engine (v1.0.0) works:

1. Finds the last References/Bibliography/Literature cited heading and reads lines until an Appendix, Supplementary, Acknowledgements, or similar heading, dropping running headers and page numbers.
2. Splits entries. Numbered lists (`[n]`, `n.`, `n `) start a new entry only at the next expected number, so wrapped years or page numbers cannot start false entries. Author-year lists start a new entry at a "Surname, Initials" or full-name author line that follows a line ending an entry.
3. Reads authors, year, title, and DOI from each entry's own text for IEEE (quoted title), APA/Harvard (parenthesised year), Vancouver, and full-name styles. Unclear fields stay empty; nothing is fetched or inferred.
4. Detects in-text markers outside the reference list: `[1]`, `[2, 3]`, `[4-7]` (ascending ranges of at most 50), `(Smith et al., 2020; Lee and Park, 2019)`, `(Brown, 2020a, 2020b)`, and narrative `Smith et al. (2020)`. Common capitalised words such as "In (2020)" are not read as authors.
5. Matches each cited item: numbers to the entry with that number; author-year items to entries whose first author has the cited surname (plus any second named author) and whose year matches. One candidate is `matched`, none is `unmatched` with a reason, several are `ambiguous` with every candidate listed.
6. Links each marker to the extracted claim containing it. The Upload screen shows each claim's citations with the matched entry's exact text and parsed fields.

## Next milestone

Owner review of citation matching on the 16-page DREW paper and other real papers. Then a measured evaluation of claim and citation extraction, reviewer correction of ambiguous or unmatched citations, and Phase 2 durable jobs before persistence. Source retrieval and verification remain deferred.

## Validation

Milestone 3, executed 2026-11-19 with Bun 1.4.4 (`--force`, no cache replay):

- `bun install` - passed
- `bun run lint` - 10 workspace lint tasks passed
- `bun run typecheck` - 11 workspace typecheck tasks passed
- `bun run test` - 87 tests passed across claim-extractor, citation-engine, API, web, and parser packages
- `bun run build` - API, worker, and web production builds passed
- Browser smoke test - a generated three-page paper uploaded through the real Upload screen showed a numbered reference list on page 2 with 6 entries; 7 cited items matched and `[9]` and `[12]` were reported unmatched. A reference entry wrapped across two lines was joined, and `[4-6]` resolved to three entries. Layout was checked at desktop width and at 375 px with no horizontal scrolling. The demo Results screen still renders separately. The API log contained no document text.
- The owner's 16-page DREW paper was **not** available to this session, so real-paper behaviour is untested.

Milestone 2 validation (2026-11-19): lint 10/10, typecheck 11/11, 53 tests, build 4/4, and a browser smoke test with a generated four-page paper.

Milestone 1 validation (2026-11-19): lint 9/9, typecheck 10/10, 13 tests, build 4/4, and a browser smoke test with a generated one-page PDF.

## Known limitations and deferred work

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
- `docs/CITEVERIFY_MASTER_HANDBOOK.md` and its PDF do not yet describe the claim-extractor or citation-engine work; update and regenerate them after owner review.
- CI, persistence, worker jobs, authentication, and deployment remain unimplemented.
- Define retention policy before persisting uploaded files.
