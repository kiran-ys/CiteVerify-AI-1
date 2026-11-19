import { extractCitations } from "@citeverify/citation-engine";
import {
  CLAIM_EXTRACTION_METHOD,
  CLAIM_EXTRACTOR_VERSION,
  extractClaims,
} from "@citeverify/claim-extractor";
import {
  PDF_PARSER_NAME,
  PDF_PARSER_VERSION,
  PdfParserError,
  parsePdf,
} from "@citeverify/document-parser";
import {
  MAX_PDF_BYTES,
  type ApiErrorCode,
  type ApiErrorResponse,
  type ExtractCitationsResponse,
  type ExtractClaimsResponse,
  type ExtractDocumentResponse,
  type PdfExtractionErrorCode,
} from "@citeverify/shared";
import { type Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export const app = new Hono().basePath("/api");

app.get("/health", (c) => c.json({ status: "ok" }));

function errorResponse(code: ApiErrorCode, message: string): ApiErrorResponse {
  return { error: { code, message } };
}

export function statusForParserError(
  code: PdfExtractionErrorCode,
): 400 | 413 | 422 | 500 | 503 {
  switch (code) {
    case "NO_EXTRACTABLE_TEXT":
      return 422;
    case "PAGE_LIMIT_EXCEEDED":
      return 413;
    case "EXTRACTION_TIMEOUT":
      return 503;
    case "EXTRACTION_FAILED":
      return 500;
    default:
      return 400;
  }
}

function safeFileName(name: string): string {
  const baseName = name.split(/[\\/]/).at(-1) ?? "document.pdf";
  const sanitized = Array.from(baseName)
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join("")
    .trim()
    .slice(0, 120);
  return sanitized || "document.pdf";
}

type UploadOutcome =
  | { ok: true; result: ExtractDocumentResponse }
  | { ok: false; response: Response };

/**
 * Validates the multipart upload and extracts its text. Shared by every
 * endpoint that accepts a PDF so limits and error codes stay identical.
 */
async function extractUploadedPdf(c: Context): Promise<UploadOutcome> {
  const fail = (
    code: PdfExtractionErrorCode,
    message: string,
    status: ContentfulStatusCode,
  ): UploadOutcome => ({
    ok: false,
    response: c.json(errorResponse(code, message), status),
  });

  const declaredLength = Number(c.req.header("content-length") ?? 0);
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_PDF_BYTES + 1024 * 1024
  ) {
    return fail("FILE_TOO_LARGE", "The PDF exceeds the 25 MB limit.", 413);
  }

  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return fail("FILE_REQUIRED", "Provide one PDF in the file field.", 400);
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return fail("FILE_REQUIRED", "Provide one PDF in the file field.", 400);
  }
  if (file.type !== "application/pdf") {
    return fail(
      "UNSUPPORTED_MEDIA_TYPE",
      "Only application/pdf uploads are supported.",
      415,
    );
  }
  if (file.size > MAX_PDF_BYTES) {
    return fail("FILE_TOO_LARGE", "The PDF exceeds the 25 MB limit.", 413);
  }

  try {
    const parsed = await parsePdf(new Uint8Array(await file.arrayBuffer()));
    return {
      ok: true,
      result: {
        document: {
          name: safeFileName(file.name),
          mediaType: "application/pdf",
          sizeBytes: file.size,
          pageCount: parsed.pageCount,
        },
        extraction: {
          text: parsed.text,
          pages: parsed.pages,
          warnings: parsed.warnings,
          parser: { name: PDF_PARSER_NAME, version: PDF_PARSER_VERSION },
        },
      },
    };
  } catch (error) {
    if (error instanceof PdfParserError) {
      return fail(error.code, error.message, statusForParserError(error.code));
    }
    return fail("EXTRACTION_FAILED", "PDF text extraction failed.", 500);
  }
}

app.post("/documents/extract", async (c) => {
  const outcome = await extractUploadedPdf(c);
  if (!outcome.ok) return outcome.response;
  return c.json(outcome.result, 200);
});

type ClaimsOutcome =
  | { ok: true; result: ExtractClaimsResponse }
  | { ok: false; response: Response };

/** Runs claim extraction on an already-extracted PDF. */
function addClaims(
  c: Context,
  extracted: ExtractDocumentResponse,
): ClaimsOutcome {
  try {
    const claims = extractClaims(extracted.extraction.pages);
    return {
      ok: true,
      result: {
        ...extracted,
        claims: {
          items: claims.claims,
          method: CLAIM_EXTRACTION_METHOD,
          version: CLAIM_EXTRACTOR_VERSION,
          truncated: claims.truncated,
          verificationStatus: "not_verified",
        },
      },
    };
  } catch {
    return {
      ok: false,
      response: c.json(
        errorResponse(
          "CLAIM_EXTRACTION_FAILED",
          "Claim extraction failed after the PDF text was extracted.",
        ),
        500,
      ),
    };
  }
}

app.post("/documents/claims", async (c) => {
  const outcome = await extractUploadedPdf(c);
  if (!outcome.ok) return outcome.response;
  const withClaims = addClaims(c, outcome.result);
  if (!withClaims.ok) return withClaims.response;
  return c.json(withClaims.result, 200);
});

app.post("/documents/citations", async (c) => {
  const outcome = await extractUploadedPdf(c);
  if (!outcome.ok) return outcome.response;
  const withClaims = addClaims(c, outcome.result);
  if (!withClaims.ok) return withClaims.response;

  let citations: ExtractCitationsResponse["citations"];
  try {
    citations = extractCitations(
      withClaims.result.extraction.pages,
      withClaims.result.claims.items,
    );
  } catch {
    return c.json(
      errorResponse(
        "CITATION_EXTRACTION_FAILED",
        "Citation matching failed after the PDF text and claims were extracted.",
      ),
      500,
    );
  }

  const response: ExtractCitationsResponse = {
    ...withClaims.result,
    citations,
  };
  return c.json(response, 200);
});

export default {
  port: Number(process.env.API_PORT ?? 3001),
  fetch: app.fetch,
};
