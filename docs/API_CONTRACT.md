# CiteVerify AI API Contract

Status: proposed contract for the next milestone. Only the health endpoint currently exists.

Base path: `/api`

## Existing endpoint

### `GET /health`

Response `200`:

```json
{ "status": "ok" }
```

## Proposed milestone endpoint

### `POST /documents/extract`

Purpose: accept one PDF and return actual extracted text. This endpoint is intentionally extraction-only; it must not invent claims, citations, evidence, or verdicts.

Request:

- Content type: `multipart/form-data`
- Field: `file`
- Allowed declared types: `application/pdf`
- Required signature: bytes beginning with the PDF signature
- Maximum: 25 MB
- One file only

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
    "pages": [
      { "page": 1, "text": "Page one text..." }
    ],
    "warnings": [],
    "parser": { "name": "selected-parser", "version": "x.y.z" }
  }
}
```

If a parser cannot provide trustworthy page boundaries, `pages` may be omitted and a warning must explain the limitation.

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

| Status | Code | Meaning |
| --- | --- | --- |
| 400 | `FILE_REQUIRED` | No file field was supplied. |
| 400 | `INVALID_PDF` | Signature or parser validation failed. |
| 400 | `ENCRYPTED_PDF` | The file requires a password. |
| 413 | `FILE_TOO_LARGE` | The request exceeds 25 MB. |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | The declared or detected type is not PDF. |
| 422 | `NO_EXTRACTABLE_TEXT` | The PDF is valid but contains no usable text; OCR is not yet available. |
| 500 | `EXTRACTION_FAILED` | An unexpected safe-to-report extraction error occurred. |
| 503 | `SERVICE_UNAVAILABLE` | Extraction capacity is temporarily unavailable. |

Security and privacy rules:

- Sanitize filenames for display and never use them as storage paths.
- Do not log file bytes or extracted text.
- Bound memory, processing time, page count, and decompression behavior.
- Return generic internal errors; keep sensitive diagnostics in protected logs.
- Delete temporary files in success and failure paths.
- Do not persist uploads during the first milestone unless retention is explicitly designed.

## Proposed job endpoints for a later phase

- `POST /documents` - create a stored document and processing job.
- `GET /documents/:documentId` - document metadata and authorized status.
- `GET /jobs/:jobId` - queued, processing, completed, or failed state.
- `GET /documents/:documentId/claims` - extracted claims after claim extraction exists.
- `GET /claims/:claimId` - claim, citation associations, evidence, and review status.
- `POST /claims/:claimId/reviews` - record human review without overwriting machine output.
- `POST /reports` and `GET /reports/:reportId` - create and retrieve traceable reports.

These later endpoints are design targets, not implemented behavior.

