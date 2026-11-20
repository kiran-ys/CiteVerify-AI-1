# CiteVerify AI API Contract

Status: text extraction implemented on `feature/pdf-upload`; claim extraction on `feature/claim-extraction`; citation extraction and matching on `feature/citation-matching`; source retrieval on `feature/evidence-retrieval`; claim verification on `feature/rag-verification` (not yet reviewed or merged).

Base path: `/api`

## Implemented endpoints

### `GET /health`

Response `200`:

```json
{ "status": "ok", "commit": "4d1a0ee" }
```

`commit` is the deployed Git commit (from Render's `RENDER_GIT_COMMIT`), or `null` when unknown. It contains no secrets.

### `POST /documents/extract`

Purpose: accept one PDF and return actual extracted text. This endpoint is intentionally extraction-only; it must not invent claims, citations, evidence, or verdicts.

Request:

- Content type: `multipart/form-data`
- Field: `file`
- Allowed declared types: `application/pdf`
- Required signature: bytes beginning with the PDF signature
- Maximum: 25 MB
- One file only
- Parser limit: 500 pages
- Response timeout: 15 seconds
- Persistence: none; the request is processed in memory

Success `200`:

```json
{
  "document": {
    "name": "paper.pdf",
    "mediaType": "application/pdf",
    "sizeBytes": 123456,
    "pageCount": 8
  },
  "extraction": {
    "text": "Actual extracted text...",
    "pages": [{ "page": 1, "text": "Page one text..." }],
    "warnings": [],
    "parser": { "name": "unpdf", "version": "2.2.1" }
  }
}
```

The current parser returns page-level text. OCR is not available, and complex visual reading order still requires representative-document evaluation.

Each `extraction.pages[]` entry also carries `superscripts`: text the PDF sets as superscript, detected from layout (glyph height at most 85% of the body text on a baseline raised by at least 15% of it, or small citation-like digits alone on the line directly below a body line). Each run is `{ "start", "end", "parts" }`, where offsets index that page's `text` and `parts` are the separately typeset pieces, e.g. `["1", "–", "3"]` or `["5", "6"]`. Page `text` itself is unchanged by this analysis.

Error envelope:

```json
{
  "error": {
    "code": "INVALID_PDF",
    "message": "The uploaded file is not a valid PDF.",
    "requestId": "optional-correlation-id"
  }
}
```

| Status | Code                     | Meaning                                                                  |
| ------ | ------------------------ | ------------------------------------------------------------------------ |
| 400    | `FILE_REQUIRED`          | No file field was supplied.                                              |
| 400    | `INVALID_PDF`            | Signature or parser validation failed.                                   |
| 400    | `ENCRYPTED_PDF`          | The file requires a password.                                            |
| 413    | `FILE_TOO_LARGE`         | The request exceeds 25 MB.                                               |
| 413    | `PAGE_LIMIT_EXCEEDED`    | The PDF has more than 500 pages.                                         |
| 415    | `UNSUPPORTED_MEDIA_TYPE` | The declared or detected type is not PDF.                                |
| 422    | `NO_EXTRACTABLE_TEXT`    | The PDF is valid but contains no usable text; OCR is not yet available.  |
| 500    | `EXTRACTION_FAILED`      | An unexpected safe-to-report extraction error occurred.                  |
| 503    | `EXTRACTION_TIMEOUT`     | Extraction did not finish within 15 seconds; the request may be retried. |

Security and privacy rules:

- Sanitize filenames for display and never use them as storage paths.
- Do not log file bytes or extracted text.
- Bound memory, processing time, page count, and decompression behavior.
- Return generic internal errors; keep sensitive diagnostics in protected logs.
- Do not create temporary files for the synchronous endpoint.
- Do not persist uploads during the first milestone unless retention is explicitly designed.

### `POST /documents/claims`

Purpose: accept one PDF, extract its text exactly as `POST /documents/extract` does, and return candidate scientific claims found in that text. Claims are **not verified**: the response never contains verdicts, confidence scores, or demo content.

Request: identical to `POST /documents/extract` (multipart field `file`, same type, signature, size, page, and timeout limits). The server re-parses the uploaded PDF; it does not accept client-supplied text, so every page number and offset comes from the server's own extraction.

Success `200`: the full `POST /documents/extract` body plus a `claims` object:

```json
{
  "document": {
    "name": "paper.pdf",
    "mediaType": "application/pdf",
    "sizeBytes": 123456,
    "pageCount": 16
  },
  "extraction": {
    "text": "...",
    "pages": [{ "page": 1, "text": "..." }],
    "warnings": [],
    "parser": { "name": "unpdf", "version": "2.2.1" }
  },
  "claims": {
    "items": [
      {
        "id": "claim-001",
        "text": "We found that peak oxygen uptake increased by 12% after eight weeks of interval training (p < 0.01).",
        "page": 1,
        "location": { "start": 281, "end": 381 },
        "section": "Abstract",
        "context": {
          "before": "Interval training is widely used in rehabilitation programs.",
          "after": "Cardiorespiratory fitness is a strong predictor of all-cause mortality [1]."
        },
        "type": "reported_finding",
        "extraction": {
          "method": "rule-based",
          "version": "1.0.0",
          "signals": [
            "first-person result statement",
            "statistical result",
            "quantified comparison"
          ]
        }
      }
    ],
    "method": "rule-based",
    "version": "1.0.0",
    "truncated": false,
    "verificationStatus": "not_verified"
  }
}
```

Field rules:

- `id` is sequential in reading order within one response (`claim-001`, ...). It is not a durable identifier until persistence exists.
- `text` is the source sentence with only line breaks and whitespace runs collapsed to single spaces. A line-break hyphen is kept as written (`signifi-cant`); the extractor never rewrites wording.
- `location.start`/`location.end` are character offsets into `extraction.pages[page - 1].text`; `end` is exclusive.
- `section` is the nearest detected heading, or `null` when the paper has no recognisable headings.
- `context.before`/`context.after` are the neighbouring sentences on the same page, or `null`.
- `type` is `reported_finding` (this paper's own result wording, statistics, or quantified comparisons) or `cited_claim` (a statement attributed to cited work).
- `extraction.signals` lists the rules that selected the sentence, for human review.
- `truncated` is `true` when more than 300 candidates were found; only the first 300 are returned.
- An empty `items` array is a valid result and means only that no sentence matched the rules.

Errors: all `POST /documents/extract` errors apply unchanged. Additionally:

| Status | Code                      | Meaning                                                                |
| ------ | ------------------------- | ---------------------------------------------------------------------- |
| 500    | `CLAIM_EXTRACTION_FAILED` | Text extraction succeeded but the claim extractor failed unexpectedly. |

### `POST /documents/citations`

Purpose: accept one PDF, run the same text and claim extraction as `POST /documents/claims`, then find the paper's reference list and in-text citations and match each cited item to reference entries **within the same paper**. A match is not evidence: the response never says whether a source supports or contradicts a claim, and nothing is looked up online.

Request: identical to `POST /documents/extract`. The server re-parses the PDF; it does not accept client-supplied text.

Success `200`: the full `POST /documents/claims` body plus a `citations` object:

```json
{
  "citations": {
    "referenceList": { "found": true, "page": 2, "style": "numbered" },
    "references": [
      {
        "id": "ref-001",
        "number": 1,
        "text": "[1] A. Kumar, B. Lee, \"Early treatment of hypertension in adults,\" N. Engl. J. Med., vol. 380, pp. 1-10, 2019, doi: 10.1056/NEJMoa1234567.",
        "page": 2,
        "pageEnd": 2,
        "location": { "start": 123, "end": 261 },
        "metadata": {
          "authors": ["A. Kumar", "B. Lee"],
          "year": "2019",
          "title": "Early treatment of hypertension in adults",
          "doi": "10.1056/NEJMoa1234567"
        }
      }
    ],
    "inText": [
      {
        "id": "cit-003",
        "marker": "[4-6]",
        "style": "numeric",
        "page": 1,
        "location": { "start": 229, "end": 234 },
        "claimId": "claim-003",
        "matches": [
          {
            "key": "4",
            "status": "matched",
            "referenceIds": ["ref-004"],
            "reason": null
          },
          {
            "key": "5",
            "status": "matched",
            "referenceIds": ["ref-005"],
            "reason": null
          },
          {
            "key": "6",
            "status": "matched",
            "referenceIds": ["ref-006"],
            "reason": null
          }
        ]
      }
    ],
    "method": "rule-based",
    "version": "1.0.0",
    "truncated": false,
    "evidenceStatus": "not_verified"
  }
}
```

(Values come from a generated three-page test paper; offsets depend on each PDF's extracted page text. An unmatched item looks like `{ "key": "9", "status": "unmatched", "referenceIds": [], "reason": "No reference entry is numbered 9." }`.)

Field rules:

- `referenceList.found` is `false` when no References/Bibliography/Literature cited heading is found; every citation is then `unmatched` with that reason.
- `referenceList.style` is `numbered` when entries count up from 1 as `[n]`, `n.`, or `n `; otherwise `author-year`.
- `references[].text` is the exact entry text with line breaks and whitespace collapsed. Running headers and page numbers inside the list are dropped.
- `references[].location` gives offsets into `extraction.pages[page - 1].text` only when the entry lies on one page and the slice reproduces `text`; otherwise it is `null`.
- `references[].metadata` fields are read from that entry's own text. Missing or unclear fields are `[]` or `null`; no DOI, title, author, or year is ever inferred or fetched.
- `inText[].marker` is the exact marker text. Supported forms: `[1]`, `[2, 3]`, `[4-7]` (hyphen or dash, ranges of at most 50 and ascending only), `(Smith et al., 2020)`, `(Lee and Park, 2019; Ng, 2021)`, `(Brown, 2020a, 2020b)`, and narrative `Smith et al. (2020)`.
- `inText[].style` is `numeric`, `author-year`, or `superscript`. Superscript citations come from the page's `superscripts` runs, so `marker` is the flattened text as extracted (e.g. `"56"`), while `matches` follow the typeset pieces (`5` and `6`). Runs are skipped when they lie in the front matter (before the first Abstract/Introduction/Background heading, e.g. author affiliation marks), follow a unit or symbol that takes a power (`kg/m²`, `χ²`, `r²`, `10⁻³`), or contain anything other than digits, commas, and dashes.
- `inText[].claimId` is the extracted claim whose text contains the marker, or `null`.
- `matches[]` has one entry per cited item, de-duplicated within a marker:
  - `matched`: exactly one reference entry has that number, or that first-author surname (plus any second named author) and year.
  - `unmatched`: no candidate; `reason` explains why (missing number, no such author/year, no reference list, or numbered citation against an author-year list).
  - `ambiguous`: more than one candidate (for example `(Brown, 2020)` when the list has Brown 2020a and 2020b); every candidate id is listed and none is chosen.
- `truncated` is `true` when more than 1000 references or 2000 in-text citations were found.

Errors: all `POST /documents/claims` errors apply unchanged. Additionally:

| Status | Code                         | Meaning                                                                        |
| ------ | ---------------------------- | ------------------------------------------------------------------------------ |
| 500    | `CITATION_EXTRACTION_FAILED` | Text and claim extraction succeeded but citation matching failed unexpectedly. |

#### `internalConsistency` (all responses from `POST /documents/citations` onward)

Checks of claims that report the paper's own findings (`type: "reported_finding"`) against the rest of the same paper. Deterministic; no model; nothing leaves the server.

```json
{
  "internalConsistency": {
    "results": [
      {
        "claimId": "claim-020",
        "status": "consistent",
        "checks": [
          {
            "kind": "ci_p_agreement",
            "status": "consistent",
            "detail": "The 95% CI (1.17 to 2.38) excludes 0, in line with p<0.001.",
            "quotes": [
              {
                "page": 6,
                "start": 0,
                "end": 0,
                "text": "95% CI: 1.17 to 2.38"
              }
            ]
          }
        ]
      }
    ],
    "scope": "original_findings",
    "method": "rule-based",
    "version": "1.0.0",
    "disclaimer": "Internal consistency compares numbers and statistical statements within this paper only. It cannot show that the study was conducted as reported or that the data are genuine."
  }
}
```

(The check shown is real output for PMC7065031; offsets are omitted here and depend on the page text.)

Checks:

- `value_reported_elsewhere`: each specific value in the finding (decimals, percentages, `n=`; not significance thresholds such as 0.05, nor confidence levels such as "95% CI") is searched for elsewhere in the paper, outside the claim. Found: `consistent`, with up to three quotes. Not found: `not_checkable` (tables or figures may not be extractable); absence is never an inconsistency.
- `ci_p_agreement`: a 95% CI immediately followed by its p-value must agree at the 0.05 level (the CI excludes 0, or 1 for ratio measures, exactly when p < 0.05). A p-value of exactly 0.05 is borderline and `not_checkable`. Intervals with a sign the PDF did not render legibly (for example "!" for a minus) are `not_checkable` and not interpreted.
- `significance_wording`: "significant", "no significant", or "approached significance" must agree with the reported p-values and with any intervals that have no p-value of their own. Several results pointing different ways are `not_checkable`.

`status` per claim is `inconsistent` if any check is, otherwise `consistent` if any check is, otherwise `not_checkable`. Quotes are exact text from the paper with page offsets.

### `POST /documents/evidence`

Purpose: accept one PDF, run the same text, claim, and citation pipeline as `POST /documents/citations`, then retrieve genuine records and legally accessible text for the references that extracted claims cite. **A retrieved source is not a verdict.** The response never says whether a source supports or contradicts a claim.

Request: identical to `POST /documents/extract`. The server re-parses the PDF.

Outbound data: only cited-reference details (entry text, parsed title, DOI, and identifiers returned by the services) are sent to Crossref, OpenAlex, Europe PMC, and PubMed Central (NCBI E-utilities). The uploaded PDF and its text are never sent. Requests carry a generic `User-Agent`; an operator contact is added only when `CITEVERIFY_CONTACT_EMAIL` is configured. All four services are free and need no API key.

Which references are looked up: those that at least one `matched` in-text citation inside an extracted claim points to, in reference-list order, at most 25 per request. Later ones are returned with `resolution.status: "skipped"` and `truncated: true`.

Limits: each outbound request times out after 20 s (never beyond the overall budget); `429` and `5xx` responses are retried up to twice, honouring `Retry-After` up to 5 s; Crossref receives one request at a time (three with an operator contact) and other services three; new requests stop after a 60 s budget. Successful responses are cached in memory for 6 hours. Expect responses of up to about 60-70 seconds.

Success `200`: the full `POST /documents/citations` body plus an `evidence` object. Example from the genuine paper Ioannidis (2005) _PLoS Med_ 2(8): e124, reference 18:

```json
{
  "evidence": {
    "sources": [
      {
        "referenceId": "ref-018",
        "claimIds": ["claim-011"],
        "resolution": {
          "status": "resolved",
          "reason": null,
          "matchedBy": "bibliographic-search",
          "resolver": "crossref",
          "candidates": []
        },
        "work": {
          "title": "The CONSORT statement: revised recommendations for improving the quality of reports of parallel-group randomised trials",
          "authors": ["David Moher", "Kenneth F Schulz", "Douglas G Altman"],
          "year": "2001",
          "doi": "10.1016/s0140-6736(00)04337-3",
          "journal": "The Lancet",
          "pmid": "11323066",
          "pmcid": null,
          "openAlexId": null
        },
        "access": "abstract_only",
        "accessReason": "The work is not in the Europe PMC open-access subset; only its abstract is available.",
        "license": null,
        "urls": {
          "doi": "https://doi.org/10.1016/s0140-6736(00)04337-3",
          "landingPage": "https://doi.org/10.1016/s0140-6736(00)04337-3",
          "fullText": null
        },
        "passages": [
          {
            "claimId": "claim-011",
            "text": "To comprehend the results of a randomised controlled trial (RCT), readers must understand its design, conduct, analysis, and interpretation.",
            "markupRemoved": false,
            "origin": "abstract",
            "location": { "section": null, "paragraph": 1, "sentence": 1 },
            "sourceUrl": "https://europepmc.org/article/MED/11323066",
            "relevance": {
              "method": "term-overlap",
              "sharedTerms": ["conduct", "controlled", "design", "trial"],
              "score": 0.33
            }
          }
        ],
        "errors": []
      }
    ],
    "services": ["crossref", "openalex", "europepmc", "ncbi-pmc"],
    "retrievedAt": "2026-11-19T11:19:56.658Z",
    "method": "metadata-resolution+term-overlap",
    "version": "1.0.0",
    "truncated": true,
    "claimStatus": "not_verified"
  }
}
```

Field rules:

- `resolution.status`:
  - `resolved`: one record passed the identity check, either from the reference's own DOI (`matchedBy: "doi"`) or from bibliographic search (`"bibliographic-search"`, via Crossref then OpenAlex).
  - `ambiguous`: several records passed and the reference's volume and first page do not single one out; `candidates` lists them and none is used.
  - `unresolved`: no record passed; `reason` explains (including a DOI that is unregistered or belongs to a different work).
  - `error`: the services could not be reached; see `errors`.
  - `skipped`: beyond the per-request limit.
- Identity check: the record's whole title must match the reference's parsed title (Jaccard similarity of at least 0.85, identical ignoring spaces, or the cited title followed by a subtitle); letters, replies, and corrections are rejected; the year must be within one; the record's first author's surname must appear in the reference; and when the record has a first page and the reference gives pagination, that page must appear in the reference (this rejects reprints in other journals).
- `work` is the service's record, not the paper's reference text. It is `null` unless `resolved`.
- `access`:
  - `full_text`: open-access JATS from Europe PMC, or from PubMed Central when Europe PMC cannot serve it. Only works Europe PMC lists as open access are fetched.
  - `abstract_only`: an abstract from Europe PMC or Crossref, but no accessible full text.
  - `metadata_only`: the work was identified, but no abstract or full text was available.
  - `unavailable`: not resolved.
  - When Europe PMC cannot be reached, `accessReason` says availability could not be checked; it never claims the work was not found.
- `license` is Europe PMC's licence or Crossref's published-version (`vor`) licence. Text-and-data-mining licences are not reported.
- `urls` are DOIs, landing pages, and full-text links returned by, or built from identifiers returned by, the services.
- `passages`: at most two per claim, sentences sharing at least two key terms and at least 20% of the claim's key terms. `text` is the source sentence with markup removed and whitespace collapsed; `markupRemoved: true` warns that formatting such as superscripts was flattened. `location.paragraph` counts body paragraphs (full text) or abstract paragraphs. `relevance.score` is the shared fraction of the claim's key terms and measures wording overlap only.
- `errors` lists per-service failures (`timeout`, `network`, `rate_limited`, `http`, `invalid_response`). A failure never turns the whole response into an error.

Errors: all `POST /documents/citations` errors apply unchanged. Additionally:

| Status | Code                        | Meaning                                                                       |
| ------ | --------------------------- | ----------------------------------------------------------------------------- |
| 500    | `EVIDENCE_RETRIEVAL_FAILED` | Claims and citations were extracted but source retrieval failed unexpectedly. |

### `GET /verification/status`

Purpose: report which model provider is configured and whether it can be used, before a verification request. Never includes credentials.

Success `200`:

```json
{
  "available": true,
  "provider": "groq",
  "host": "https://api.groq.com",
  "model": "openai/gpt-oss-120b",
  "modelInstalled": true,
  "reason": null
}
```

`provider` is `groq` when the server has `GROQ_API_KEY` (or `VERIFIER_PROVIDER=groq`), otherwise `ollama`. For Groq, `reason` reports a missing key ("GROQ_API_KEY is not set"), a rejected key, or a model the account cannot use. When Ollama is not running: `available: false`, `modelInstalled: false`, `reason: "No Ollama server answered at http://127.0.0.1:11434. Start it with: ollama serve"`. When the model is missing, `reason` gives the `ollama pull` command.

### `POST /documents/verification`

Purpose: accept one PDF, run the full pipeline of `POST /documents/evidence`, then compare each externally cited claim with the retrieved passages from the sources it cites, using Groq's hosted model or a local Ollama model. The paper's own findings are not sent (`ownFindingsExcluded`); the uploaded PDF is never sent to a model. **Verdicts are model judgements over retrieved text and require human review.** No confidence score is returned.

Request: identical to `POST /documents/extract`. The server re-parses the PDF and re-runs retrieval (cached results are reused); it never accepts evidence from the client.

Configuration: `GROQ_API_KEY` (server-side only) and `GROQ_MODEL` (default `openai/gpt-oss-120b`) for Groq; otherwise `OLLAMA_HOST` (default `http://127.0.0.1:11434`) and `OLLAMA_MODEL` (default `llama3.2`). `VERIFIER_PROVIDER=ollama|groq` overrides the choice. Prompts contain only the claim, its context, and retrieved public passages.

Verdicts (`verdict`):

- The model (prompt `verify-v5`) assesses each stated part of the claim (population, intervention, outcome, finding) as `supported`, `contradicted`, or `not_reported`, each supported or contradicted part citing a provided passage id. **The verdict is derived in code**: `Supported` when every stated part is supported; `Partially supported` when some are; `Contradicted` when parts are contradicted and none supported; otherwise `Unable to verify` with `unableCause: "insufficient_evidence"`.
- `Unable to verify` is also returned (`decidedBy: "rule"`) when the claim cites no source, no citation matched, no relevant passage was retrieved (`no_evidence`), the model is unavailable (`model_unavailable`), errors or is rate-limited (`model_error`), times out (`model_timeout`), the time budget ran out (`time_budget`), or its answer failed validation twice (`invalid_output`). `reason` always says which.
- `Unsupported` exists in the type for compatibility but is **not produced**: a live test showed the hosted model calls on-topic but incomplete sources "a different question". When the model judges the source to address a different question, the claim is `Unable to verify` with a note to check the full source. `Unable to verify` never means the claim is false.

Validation of model answers (a malformed answer is retried once): every cited id must be one of the passages provided (several ids may be listed); a part marked supported or contradicted without a passage counts as not reported. For the older evidence-list format: the verdict must be one of the model verdicts; every cited id must be one of the passages provided; `Supported` and `Partially supported` must cite at least one `supports` passage; `Contradicted` must cite at least one `contradicts` passage; `Supported` may not cite a `contradicts` passage; one passage may not have two roles. A failed check yields `Unable to verify` and the passages are returned with `relation: "not_cited"`.

Limits: up to 4 passages per cited source and 10 per claim; claims are sent one at a time; each call times out after 30 s (Groq) or 45 s (Ollama); Groq rate limits are retried at most twice when the requested wait is 15 s or less; new calls stop after a 120 s budget (`truncated: true`). Retrieval has a 90 s budget, spaces Crossref requests (1 per second anonymously), and may skip references after the first 40. A 6-page paper with about 20 cited claims took 160-170 s live.

Success `200`: the full `POST /documents/evidence` body plus a `verification` object. Example from the genuine paper Ioannidis (2005) _PLoS Med_ 2(8): e124 with `llama3.2`:

```json
{
  "verification": {
    "results": [
      {
        "claimId": "claim-004",
        "verdict": "Partially supported",
        "decidedBy": "model",
        "reason": "Judged from abstracts only; the full texts were not accessible.",
        "evidence": [
          {
            "claimId": "claim-004",
            "text": "The false positive report probability (FPRP), the probability of no true association between a genetic variant and disease given a statistically significant finding, depends not only on the observed P value but also on both the prior probability that the association between the genetic variant and the disease is real and the statistical power of the test.",
            "markupRemoved": false,
            "origin": "abstract",
            "location": {
              "section": null,
              "paragraph": 1,
              "sentence": 3
            },
            "sourceUrl": "https://europepmc.org/article/MED/15026468",
            "relevance": {
              "method": "term-overlap",
              "sharedTerms": [
                "depend",
                "power",
                "prior",
                "probability",
                "statistical",
                "true"
              ],
              "score": 0.5
            },
            "referenceId": "ref-010",
            "relation": "supports",
            "sourceTitle": "Assessing the Probability That a Positive Report is False: An Approach for Molecular Epidemiology Studies",
            "doi": "10.1093/jnci/djh075",
            "evidenceId": "E1"
          }
        ],
        "evidenceScope": "abstract_only",
        "explanation": "The evidence passage supports the idea that prior probability and statistical power are relevant factors in determining the truth of a research finding. However, it does not directly address the level of statistical significance as one of these factors.",
        "model": {
          "provider": "ollama",
          "name": "llama3.2",
          "promptVersion": "verify-v5"
        }
      },
      {
        "claimId": "claim-007",
        "verdict": "Unable to verify",
        "decidedBy": "rule",
        "reason": "This claim reports the paper's own result and cites no source, so there is no cited evidence to check it against.",
        "evidence": [],
        "evidenceScope": "none",
        "explanation": null,
        "model": null
      }
    ],
    "model": {
      "provider": "ollama",
      "name": "llama3.2",
      "promptVersion": "verify-v5"
    },
    "modelAvailable": true,
    "method": "evidence-grounded-llm",
    "version": "1.0.0",
    "verifiedAt": "2026-11-19T11:56:53.562Z",
    "truncated": false,
    "reviewStatus": "requires_human_review"
  }
}
```

Field rules:

- `evidence` lists every passage considered for the claim, in the order shown to the model (`evidenceId` `E1`...). `text` is the stored source sentence from retrieval, never text produced by the model. `relation` is the role the model gave it (`supports`, `contradicts`, `context`) or `not_cited`.
- `evidenceScope` is `full_text`, `abstract_only`, `mixed`, or `none`; abstract-only verdicts carry a caveat in `reason`.
- `explanation` is model-generated text and is not evidence.
- `model` records the provider, model name, and prompt version used; it is `null` for rule decisions.

Errors: all `POST /documents/evidence` errors apply unchanged. Additionally:

| Status | Code                  | Meaning                                                      |
| ------ | --------------------- | ------------------------------------------------------------ |
| 500    | `VERIFICATION_FAILED` | Evidence was retrieved but verification failed unexpectedly. |

## Proposed job endpoints for a later phase

- `POST /documents` - create a stored document and processing job.
- `GET /documents/:documentId` - document metadata and authorized status.
- `GET /jobs/:jobId` - queued, processing, completed, or failed state.
- `GET /documents/:documentId/claims` - extracted claims after claim extraction exists.
- `GET /claims/:claimId` - claim, citation associations, evidence, and review status.
- `POST /claims/:claimId/reviews` - record human review without overwriting machine output.
- `POST /reports` and `GET /reports/:reportId` - create and retrieve traceable reports.

These later endpoints are design targets, not implemented behavior.

### `POST /evaluation/case`

Purpose: evaluate one externally supplied test case (for the Dataset Evaluation page) with the same verifier as `POST /documents/verification`. No PDF is involved and nothing is stored.

Request (JSON, at most 64 KB): `{ "mode": "supplied" | "live", "caseId", "claim", "inlineCitation", "referenceEntry", "doi", "evidenceSnippet"? }`. Strings are size-limited (claim 2,000; snippet 6,000 characters).

- `supplied`: the claim is judged only against `evidenceSnippet`, split into sentences. Provenance is `dataset_supplied`; the snippet is never reported as retrieved. Placeholder snippets (`N/A`, `NONE`, `NO_SOURCE_FOUND`) count as no evidence.
- `live`: the snippet is ignored; the reference entry is parsed (and the DOI used when well-formed), the cited work is looked up with the normal retrieval pipeline, and the claim is judged against retrieved passages (provenance `retrieved`).

Before any retrieval or model call, an empty or near-empty claim returns `outcome: "invalid_input"`, and a missing citation or reference returns `outcome: "no_citation"`.

Response `200`: `{ caseId, mode, outcome, verdict, unableCause, reason, explanation, provenance: { kind, detail, resolver, access, workTitle, workDoi }, evidence: [{ id, relation, text, url }], model, latencyMs }`, where `outcome` is `verified`, `invalid_input`, `no_citation`, `reference_not_found` (live: no scholarly record matched), `no_evidence`, or `model_failure` (model unavailable, error, timeout, invalid answer, or time budget). Errors: `400`/`413` `INVALID_EVALUATION_REQUEST`, `500` `EVALUATION_FAILED`.

Mapping to a dataset's labels happens in the client and is shown to the user; see `apps/web/src/dataset.ts` (`MAPPING_RULES`).
