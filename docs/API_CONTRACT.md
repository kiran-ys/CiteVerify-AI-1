# CiteVerify AI API Contract

Status: text extraction implemented on `feature/pdf-upload`; claim extraction on `feature/claim-extraction`; citation extraction and matching on `feature/citation-matching` (not yet reviewed or merged).

Base path: `/api`

## Implemented endpoints

### `GET /health`

Response `200`:

```json
{ "status": "ok" }
```

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

## Proposed job endpoints for a later phase

- `POST /documents` - create a stored document and processing job.
- `GET /documents/:documentId` - document metadata and authorized status.
- `GET /jobs/:jobId` - queued, processing, completed, or failed state.
- `GET /documents/:documentId/claims` - extracted claims after claim extraction exists.
- `GET /claims/:claimId` - claim, citation associations, evidence, and review status.
- `POST /claims/:claimId/reviews` - record human review without overwriting machine output.
- `POST /reports` and `GET /reports/:reportId` - create and retrieve traceable reports.

These later endpoints are design targets, not implemented behavior.
