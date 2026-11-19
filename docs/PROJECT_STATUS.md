# CiteVerify AI Project Status

Last inspected: 2026-11-19

## Repository baseline

- Repository: `https://github.com/kiran-ys/CiteVerify-AI-1`
- Active implementation branch: `feature/rag-verification`
- Baseline commit: `d1f4ef4` (`Explain unreachable-server errors and document dev port clashes`)
- Milestone 5 is committed (`1f72c5e`). The PMC7065031 pipeline improvements below are uncommitted and awaiting owner review.
- Application stack: Bun, Turborepo, TypeScript, React, Vite, Tailwind CSS, Hono, Prisma, SQLite

## Status summary

| Area                 | Status                       | Evidence and limitation                                                                                                                    |
| -------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Monorepo scaffolding | Implemented and verified     | Apps and packages exist; install, lint, typecheck, test, and build pass.                                                                   |
| Responsive frontend  | Implemented and verified     | Dashboard, upload screen, result filtering, evidence drawer, and report preview are implemented in React.                                  |
| Demo labelling       | Implemented and verified     | Demo claims and verdicts remain visibly separate from live extraction and extracted claims.                                                |
| API health route     | Implemented and verified     | `GET /api/health` returns `{ "status": "ok" }`.                                                                                            |
| PDF upload           | Implemented and verified     | `POST /api/documents/extract` validates and parses one PDF in memory.                                                                      |
| Claim extraction     | Implemented (committed)      | `POST /api/documents/claims` returns unverified candidate claims with page, offsets, section, and context. Quality is unmeasured.          |
| Citation matching    | Implemented (committed)      | `POST /api/documents/citations` links in-text citations to the paper's own reference list; matches are not evidence.                       |
| Source retrieval     | Implemented (committed)      | `POST /api/documents/evidence` resolves cited references and retrieves accessible text; opt-in; never a verdict.                           |
| Claim verification   | Implemented, awaiting review | `POST /api/documents/verification` returns evidence-grounded verdicts from a local Ollama model; accuracy unmeasured.                      |
| Worker               | Placeholder                  | It logs `[worker] started`; no job consumption exists.                                                                                     |
| Document parser      | Implemented and verified     | `unpdf` 2.2.1 returns full text, page text, page count, warnings, and parser metadata.                                                     |
| Claim extractor      | Implemented and tested       | `packages/claim-extractor` rule-based v1.0.0; deterministic and offline; no LLM or paid API.                                               |
| Citation engine      | Implemented and tested       | `packages/citation-engine` rule-based v1.0.0; reference list, metadata, citation detection, and matching; offline, no lookups.             |
| Verification engine  | Implemented and tested       | `packages/verification-engine` v1.0.0; Ollama over HTTP; validated JSON verdicts; rule-based Unable to verify; no confidence.              |
| Evidence retrieval   | Implemented and tested       | `packages/evidence-retrieval` v1.0.0; Crossref, OpenAlex, Europe PMC, PubMed Central; free and keyless; term-overlap passages.             |
| Shared contracts     | Implemented                  | Upload, extraction, claim, citation, and error contracts are shared by the API, engines, and web client.                                   |
| Shared UI package    | Placeholder                  | Package exports nothing.                                                                                                                   |
| Database             | Configured, no domain models | Prisma client and SQLite URL resolution exist; schema contains no models.                                                                  |
| Automated tests      | Implemented and passing      | 238 Bun tests pass (verification 55, evidence 47, claims 34, API 34 incl. 6 real-PDF, citations 29, web 20, parser 8); 1 opt-in live test. |
| Deployment           | Free Render image verified   | One Docker image serves the dashboard and API on one HTTPS origin; public deployment is pending. Ollama is not included.                    |

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

### Milestone 4 - Source and evidence retrieval (committed `8768058`, fix `d1f4ef4`)

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

### Milestone 5 - Evidence-grounded claim verification (uncommitted, awaiting review)

`React "Verify claims with local model" -> POST /api/documents/verification -> parse -> claims -> citations -> retrieval -> verifyClaims (Ollama) -> React verdicts`

How verification (`packages/verification-engine` v1.0.0) works:

1. For each extracted claim, gather the retrieved passages from the references its matched citations point to (up to six, highest term overlap first).
2. With no passage, return `Unable to verify` by rule, explaining per reference why (own result with no citation, unmatched citation, unresolved or skipped source, metadata only, or no relevant passage). The model is not called.
3. Otherwise send the claim and numbered, fenced passages to a local Ollama model (`llama3.2` by default) with a JSON schema, temperature 0, and a fixed seed.
4. Validate the answer in code: known verdict, only provided passage ids, a supporting passage for Supported/Partially supported, a contradicting passage for Contradicted. Failures become `Unable to verify` with the reason.
5. Display the verdict with the stored passage text, location, source and DOI links, the model explanation labelled "not evidence", and the model and prompt version. Rule decisions are labelled as such. No confidence score is shown.

### Live verification result (genuine paper)

Run on 2026-11-19 with Ollama 0.22.1 and `llama3.2` (3.2B, Q4_K_M) on an Apple M4 (16 GB), through `localhost:5173`, on Ioannidis (2005) _PLoS Med_ 2(8): e124:

- HTTP 200 in 93.6 s cold (40 s with the retrieval cache warm). The same verdicts were returned on both runs.
- 29 claims: 1 Supported, 3 Partially supported, 0 Contradicted, 0 Insufficient evidence, 25 Unable to verify.
- The 4 model verdicts were based on 13 retrieved passages: 11 abstract sentences and 2 full-text sentences from one open-access source (reference 27, BMC). Every model answer passed validation.
- Rule decisions: 17 claims had no relevant passage retrieved for any cited reference; 8 report the paper's own result and cite no source.
- Reviewer reading of the 4 model verdicts: claim-005 is reasonable; claim-011 is reasonable but cites weaker passages as "supports"; claim-004 arguably should be Supported (the passage names P value, prior probability, and power); claim-014's explanation overlooks a passage showing inadequate reporting. These are single-paper observations, not a measured accuracy.

### Pipeline improvements from PMC7065031 (uncommitted, awaiting review)

The owner's real test paper, PMC7065031 (the 16-page DREW study author manuscript, "The effect of different doses of aerobic exercise training on endothelial function in postmenopausal women with elevated blood pressure"), matched no citations.

Diagnosis: the journal sets citations as superscript numbers. Text extraction flattens them into digits glued to words (`factors1–3`, `menopause.56` for 5,6, `hypertension.141617` for 14,16,17), which the bracket and author-year detectors cannot see and which cannot be split reliably from text alone. As a result no citation markers were found, the Introduction's cited sentences were discarded as uncited background, and every remaining claim was typed as the paper's own finding.

Changes:

1. `document-parser` builds page text from pdf.js text items (byte-identical to the previous text for both real test PDFs) and reports `superscripts` per page from layout: smaller glyphs on a raised baseline, plus small citation digits wrapped alone onto the next line. The typeset pieces keep "5" and "6" apart.
2. `citation-engine` adds `superscript` citations from those runs, skipping front-matter affiliation marks, unit and symbol exponents (`kg/m²`, `χ²`), and anything not made of digits, commas, and dashes.
3. `claim-extractor` takes citation positions: sentences carrying them are typed as citing external papers, sentences end after a superscript that follows a full stop, and a marker never starts a sentence.
4. `verification-engine` adds a deterministic internal-consistency analysis of the paper's own findings (values found elsewhere in the paper, CI vs p-value, significance wording vs statistics), with exact quotes and a disclaimer that it is not proof the data are genuine.
5. The Upload screen shows each claim's origin and three separate sections: Citation matching, External evidence verification, and Internal consistency.

Before and after on PMC7065031 (same PDF, same services, `llama3.2`):

| Measure                           | Before                | After                                                                           |
| --------------------------------- | --------------------- | ------------------------------------------------------------------------------- |
| Reference-list entries            | 35 (numbered)         | 35 (numbered)                                                                   |
| In-text citation markers          | 0                     | 36 (all superscript)                                                            |
| Cited numbers matched             | 0                     | 57 of 57                                                                        |
| Non-citation superscripts skipped | –                     | 7 (4 affiliation marks, 2 `kg/m²`, 1 `χ²`)                                      |
| Claims                            | 24, all "own finding" | 36: 17 citing external papers, 19 own findings                                  |
| Sources looked up                 | 0                     | 26 (25 attempted, 1 over the per-request limit)                                 |
| Sources resolved                  | 0                     | 24 of 25 (reference 2 unresolved)                                               |
| Access                            | –                     | 18 abstract only, 6 metadata only, 2 unavailable, 0 full text                   |
| Evidence passages                 | 0                     | 30                                                                              |
| Model verdicts                    | 0                     | 11: 2 Supported, 8 Partially supported, 1 Insufficient evidence                 |
| Unable to verify (by rule)        | 24                    | 25 (19 own findings without citations, 6 cited claims without a usable passage) |
| Internal consistency              | –                     | 19 own findings: 12 consistent, 0 inconsistent, 7 not checkable                 |

Europe PMC timed out on 12 lookups during that run, so some "metadata only" results are availability unknown. The bracket-citation paper Ioannidis (2005) is unchanged: 30 markers, 46 matched, 1 ambiguous, 29 claims.

Reviewer reading of the model verdicts: several are reasonable (claims 005, 008, 023), but some explanations are muddled (claim 024) and claim 022 was judged "Insufficient evidence" although passage E6 states no FMD improvement in post-menopausal women, which bears directly on the claim. These remain unmeasured judgements by a 3B model.

### RAG reliability work (uncommitted, awaiting review)

- Retrieval: a PubMed ID printed in a reference is now resolved first (and still checked against the reference); PubMed supplies exact abstracts in parallel with Europe PMC, whose requests are capped at 10 s. On PMC7065031, 26 of 26 cited references were identified with the correct identifier and all had an abstract (2026-11-19).
- Verification: verdicts are Supported, Partially supported, Contradicted, or Unable to verify (the model's "insufficient evidence" becomes Unable to verify with that reason; there is no "Unsupported"). Only claims citing external papers are verified; the paper's own findings are counted separately. Every Unable to verify records its cause (`unableCause`), so timeouts and failures are reported apart from wrong verdicts.
- Speed: the first full 17-claim evaluation took 233 s and ran out of time on 7 claims because each claim sent up to 30 passages and the model listed them all. Evidence is now at most 4 passages per source and 10 per claim (best term overlap plus the abstract's concluding sentence), the model may cite at most 4 and is capped at 300 output tokens and kept loaded; 45 s per claim and 120 s in total. Model time fell from about 14-23 s to about 7 s per claim.
- Evaluation: `eval/verification-dataset.json` holds 17 externally cited claims from PMC7065031 with expected verdicts (AI-assisted labels pending human review; 9 clear, 8 borderline; no Contradicted examples) and 34 reference identifiers taken from the paper's own PubMed IDs. `bun run eval:verification -- --claims 3` runs a small test. Small test after the speed fix: 3 claims in 60.8 s (retrieval 39.8 s, model 20.9 s), 8/8 references correct, 3/3 verdicts correct. Full 17-claim run with the new settings (2026-11-19): 183.7 s total (retrieval 78.2 s, model 105.4 s, 4.4-8.2 s per claim), 26/26 references correct, 0 timeouts or failures, 9/17 verdicts correct (7/7 expected Partially supported, 2/10 expected Supported). The model answered Partially supported for 15 of 17 claims, so it is biased toward that label; the earlier run scored 4/17 with 7 timeouts.
- Part-by-part verdicts (prompt `verify-v3`, 2026-11-19): the model now splits each claim into population, intervention, outcome and numerical finding, marks each supported, not reported or contradicted with a cited passage, and the verdict is derived in code (Supported only when every stated part is supported; Partially supported when some are; Unable to verify when none is). A part marked supported or contradicted without a cited passage counts as not reported, so a missing citation can only weaken a verdict. Three-claim test (`--ids PMC7065031/claim-024,PMC7065031/claim-006,ioannidis-2005/claim-013`): 2/3 match the expected label, 6.6-10.3 s per model call. claim-024 was wrong (Partially supported instead of Supported) because the 3B model misread the passage on FMD in women; claim-006 matched for a weak reason (it cited the wrong passage); the insufficient-evidence claim was correctly Unable to verify. Full 17-claim run with `verify-v3` (2026-11-19): 194.9 s total (retrieval 73.4 s, model 121.5 s, 7.0-11.3 s per claim), 26/26 references correct, 6/14 judged verdicts correct, 3 claims not judged because the 120 s model budget ran out. Every judged claim was Partially supported (7/7 expected Partially supported correct, 0/7 expected Supported), so the part-by-part prompt did not remove the bias toward Partially supported and each claim is slower (longer answers). The extra Ioannidis claim was correctly Unable to verify. Model comparison on the same retrieved evidence (2026-11-19, `--models llama3.2,qwen2.5:7b`, three claims): llama3.2 matched 2/3 labels (one, claim-006, by citing an irrelevant passage) at 6.6-9.8 s per claim; qwen2.5:7b matched 1/3 at 16.7 s per claim warm (40.4 s including first load), cited relevant passages, but still did not mark the claim-024 finding as supported. The Ioannidis abstract was not retrieved in that run, so neither model was tested on it. Default model stays llama3.2. Found during this run and fixed: markup removal treated statistics such as "P<0.01 … >50%" as a tag and deleted the text between them, so a displayed passage could differ from the source. Only real tags (a "<" directly followed by a tag name) are now removed; regression tests cover the Pierce et al. abstract, and the live abstract now keeps "P<0.01" and ">50%".

### Deployment preparation (uncommitted, awaiting approval)

- `deploy/` holds a proposed single-server Docker Compose setup: Caddy (HTTPS, static web app, `/api` proxy), the bundled Bun API, and a private Ollama container. Plan, costs, and blockers: `docs/DEPLOYMENT_PLAN.md`. The owner approved the GPU-server plan; nothing is deployed. Both images were built and the stack (with a required demo password) passed a local smoke test and an end-to-end verification in Docker.
- The production API bundle was run standalone (`bun dist/index.js`) and verified PMC7065031 end to end in 3 min 56 s, close to the 240 s request limit.
- A free Render path now builds the React app into the Bun API image and serves both from one origin. The exact image returned 200 for `/`, healthy JSON for `/api/health`, and an honest unavailable response for local Ollama. This preserves PDF extraction, claims, citations, and evidence retrieval, but cannot run Llama 3.2 within Render's free instance limits.

### Paper persistence and PDF report (uncommitted, awaiting review)

- The processed paper is now held above the pages and the Upload page stays mounted, so switching between Dashboard, Verification Results, Reports and Upload Paper keeps the file, results, and any running request. Results (never the PDF) are also kept in `sessionStorage` for the browser tab; after a reload they are restored, and the same PDF must be chosen again to retrieve sources or verify. "Upload another paper" clears both.
- "Download PDF report" (Upload Paper and Reports pages; "Export report" now opens Reports) writes an A4 PDF in the browser from the uploaded paper's own results: file name, first line of the PDF text (labelled as such), page count and extraction summary, AI verification status ("Not verified" when it was not run), claims with their citation matches and any verdicts, citation-matching counts and reference list, retrieved passages with source links, and internal-consistency checks. No dependency added; demo data is never included.
- Tests cover session save/restore/clear (including blocked storage) and report content and PDF structure. Page switching itself is not covered by an automated UI test; a generated 5-page report for the Ioannidis paper was opened with pdf.js and rendered.

### Hosted AI verification with Groq (uncommitted, not yet tested live)

- Approved by the owner (2026-11-20): when the server sets `GROQ_API_KEY`, verification uses Groq's free hosted API (default `openai/gpt-oss-120b`) instead of Ollama; otherwise the local Ollama default (`llama3.2`) is unchanged. `VERIFIER_PROVIDER=ollama|groq` overrides. The same prompt, validation, and evidence rules apply; only the claim, its context, and retrieved public passages are sent, never the PDF. The UI names the provider and shows a privacy note when Groq is used.
- Rate limits: Groq 429/5xx answers are retried up to twice when the requested wait is at most 15 s; otherwise the claim is Unable to verify with the reason. A missing or rejected key makes every claim Unable to verify with that reason. The key never appears in responses or logs.
- `render.yaml` declares `GROQ_API_KEY` (set in the Render dashboard) and `GROQ_MODEL`. `bun run eval:verification -- --provider groq` evaluates with Groq.
- Checked 2026-11-20: unit and API tests cover Groq answers, 429 retry with retry-after, too-long waits, rejected keys (never echoed), timeouts, and a missing key. In a browser against the production build with no key: upload, page switching, reload restore, and PDF report download still work, and verification showed 21 claims as Unable to verify with the reason "GROQ_API_KEY is not set" plus the Groq privacy note.
- Live check (2026-11-20): with the key set on Render the server switched to Groq and the key was accepted, but `llama-3.3-70b-versatile` is Enterprise-only on Groq now, so the default became `openai/gpt-oss-120b` (a reasoning model; requests use low reasoning effort and hide the reasoning).
- Not yet done: no real Groq call has been made (the key was not available to this session), so verdict quality, latency, and free-tier limits on Groq are unmeasured.

## Next milestone

Owner review of verification, ideally on the DREW paper. Then a labelled evaluation set to measure claim, citation, retrieval, and verdict accuracy; a comparison of larger local models; better passage selection; and Phase 2 durable jobs so long runs move to the worker.

## Validation

Milestone 5, executed 2026-11-19 with Bun 1.4.4 (`--force`, no cache replay):

- `bun install` - passed
- `bun run lint` - 11 workspace lint tasks passed
- `bun run typecheck` - 12 workspace typecheck tasks passed
- `bun run test` - 172 tests passed offline; 1 live retrieval test skipped by default
- `bun run build` - API, worker, and web production builds passed
- Live run - Ollama 0.22.1 with `llama3.2` verified the genuine Ioannidis (2005) paper end to end through `localhost:5173` (see above)
- Browser check - verification bar showed the model status; verdicts, passages, links, and labels rendered under claims; rule decisions labelled separately; the demo Results page showed no real verdicts; 375 px layout without horizontal scrolling

Milestone 4 validation (2026-11-19): lint 11/11, typecheck 12/12, 133 tests, build 4/4, live retrieval test, and a browser run through `localhost:5173`.

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

Superscript citations and internal consistency:

- Superscript detection relies on PDF layout. Scanned PDFs, PDFs that set citations at body size, or unusual typesetting will not be detected; text-only pages keep the previous behaviour.
- Front-matter exclusion depends on an Abstract, Introduction, Background, Summary, or Keywords heading; without one, affiliation marks could be read as citations.
- This PDF renders some minus signs as "!", so intervals containing them are not interpreted.
- Internal consistency finds agreement and contradictions within the text only. It cannot detect fabricated but self-consistent numbers, check tables that were not extracted, or confirm that the study was conducted as described.
- A value missing from the rest of the paper is reported as not checkable, never as an inconsistency.

Claim verification:

- Verdicts are judgements by a small local model (3B by default) over short retrieved passages. Their accuracy has not been measured; on the one paper tested, two of four model verdicts were debatable on review.
- Evidence is limited to term-overlap passages from the claim's own cited sources, mostly abstracts; claims are not checked against the wider literature.
- Most claims end as `Unable to verify` because the evidence pipeline yields no passage for them; verification cannot be better than retrieval.
- `Contradicted` and `Insufficient evidence` were not produced in the live run; those paths are tested with a fake model only.
- Prompt-injection defences (fencing, instructions, output validation) reduce but do not eliminate the risk from untrusted passage text.
- Verification runs synchronously (up to about four minutes) and repeats the whole pipeline; the retrieval cache makes repeats faster.
- A reference list with only one numbered entry is not recognised as numbered, so its citation stays unmatched (citation-engine limitation found while testing).
- The page shell sets `body { min-width: 320px }`, so panes narrower than 320 px scroll horizontally.

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
- `docs/CITEVERIFY_MASTER_HANDBOOK.md` and its PDF do not yet describe the claim-extractor, citation-engine, evidence-retrieval, or verification work; update and regenerate them after owner review.
- CI, persistence, worker jobs, authentication, and deployment remain unimplemented.
- Define retention policy before persisting uploaded files.
