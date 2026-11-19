import { extractCitations } from "@citeverify/citation-engine";
import {
  CLAIM_EXTRACTION_METHOD,
  CLAIM_EXTRACTOR_VERSION,
  extractClaims,
} from "@citeverify/claim-extractor";
import {
  type RetrievalOptions,
  retrieveEvidence,
} from "@citeverify/evidence-retrieval";
import {
  checkInternalConsistency,
  DEFAULT_OLLAMA_HOST,
  DEFAULT_OLLAMA_MODEL,
  type OllamaConfig,
  ollamaJudge,
  ollamaStatus,
  verifyClaims,
} from "@citeverify/verification-engine";
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
  type ExtractEvidenceResponse,
  type PdfExtractionErrorCode,
  type VerificationStatusResponse,
  type VerifyClaimsResponse,
} from "@citeverify/shared";
import { type Context, Hono } from "hono";
import { serveStatic } from "hono/bun";
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
    // Citation markers found from layout (e.g. superscripts) tell the claim
    // extractor which sentences cite external work and where sentences end.
    const markers = extractCitations(extracted.extraction.pages).inText.map(
      (citation) => ({ page: citation.page, ...citation.location }),
    );
    const claims = extractClaims(extracted.extraction.pages, {
      citationSpans: markers,
    });
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

type CitationsOutcome =
  | { ok: true; result: ExtractCitationsResponse }
  | { ok: false; response: Response };

/** Runs citation matching on a PDF whose text and claims are already extracted. */
function addCitations(
  c: Context,
  withClaims: ExtractClaimsResponse,
): CitationsOutcome {
  try {
    const citations = extractCitations(
      withClaims.extraction.pages,
      withClaims.claims.items,
    );
    // The paper's own findings are checked against the rest of the paper.
    const internalConsistency = checkInternalConsistency(
      withClaims.extraction.pages,
      withClaims.claims.items,
    );
    return {
      ok: true,
      result: { ...withClaims, citations, internalConsistency },
    };
  } catch {
    return {
      ok: false,
      response: c.json(
        errorResponse(
          "CITATION_EXTRACTION_FAILED",
          "Citation matching failed after the PDF text and claims were extracted.",
        ),
        500,
      ),
    };
  }
}

app.post("/documents/citations", async (c) => {
  const outcome = await extractUploadedPdf(c);
  if (!outcome.ok) return outcome.response;
  const withClaims = addClaims(c, outcome.result);
  if (!withClaims.ok) return withClaims.response;
  const withCitations = addCitations(c, withClaims.result);
  if (!withCitations.ok) return withCitations.response;
  return c.json(withCitations.result, 200);
});

/**
 * Options for outbound scholarly lookups. The operator may set
 * CITEVERIFY_CONTACT_EMAIL for Crossref/NCBI etiquette; uploader details are
 * never sent. Tests replace the fetch implementation.
 */
let retrievalOptions: RetrievalOptions = {
  contactEmail: process.env.CITEVERIFY_CONTACT_EMAIL || undefined,
};

export function configureEvidenceRetrieval(options: RetrievalOptions): void {
  retrievalOptions = options;
}

type EvidenceOutcome =
  | { ok: true; result: ExtractEvidenceResponse }
  | { ok: false; response: Response };

/** Retrieves cited sources for a PDF whose claims and citations are extracted. */
async function addEvidence(
  c: Context,
  withCitations: ExtractCitationsResponse,
): Promise<EvidenceOutcome> {
  try {
    const evidence = await retrieveEvidence(
      {
        references: withCitations.citations.references,
        claims: withCitations.claims.items,
        citations: withCitations.citations.inText,
      },
      retrievalOptions,
    );
    return { ok: true, result: { ...withCitations, evidence } };
  } catch {
    return {
      ok: false,
      response: c.json(
        errorResponse(
          "EVIDENCE_RETRIEVAL_FAILED",
          "Source retrieval failed unexpectedly after claims and citations were extracted.",
        ),
        500,
      ),
    };
  }
}

app.post("/documents/evidence", async (c) => {
  const outcome = await extractUploadedPdf(c);
  if (!outcome.ok) return outcome.response;
  const withClaims = addClaims(c, outcome.result);
  if (!withClaims.ok) return withClaims.response;
  const withCitations = addCitations(c, withClaims.result);
  if (!withCitations.ok) return withCitations.response;
  const withEvidence = await addEvidence(c, withCitations.result);
  if (!withEvidence.ok) return withEvidence.response;
  return c.json(withEvidence.result, 200);
});

/**
 * Local model settings. The model runs in Ollama on the operator's machine;
 * prompts never leave it. Tests replace fetch.
 */
type VerificationConfig = OllamaConfig & { timeBudgetMs?: number };
let verificationConfig: VerificationConfig = {
  host: process.env.OLLAMA_HOST || DEFAULT_OLLAMA_HOST,
  model: process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL,
};

export function configureVerification(config: VerificationConfig): void {
  verificationConfig = config;
}

app.get("/verification/status", async (c) => {
  const status = await ollamaStatus(verificationConfig);
  const response: VerificationStatusResponse = {
    available: status.available && status.modelInstalled,
    host: verificationConfig.host,
    model: verificationConfig.model,
    modelInstalled: status.modelInstalled,
    reason: status.reason,
  };
  return c.json(response, 200);
});

app.post("/documents/verification", async (c) => {
  const outcome = await extractUploadedPdf(c);
  if (!outcome.ok) return outcome.response;
  const withClaims = addClaims(c, outcome.result);
  if (!withClaims.ok) return withClaims.response;
  const withCitations = addCitations(c, withClaims.result);
  if (!withCitations.ok) return withCitations.response;
  const withEvidence = await addEvidence(c, withCitations.result);
  if (!withEvidence.ok) return withEvidence.response;

  const status = await ollamaStatus(verificationConfig);
  const usable = status.available && status.modelInstalled;
  let verification: VerifyClaimsResponse["verification"];
  try {
    verification = await verifyClaims(
      {
        claims: withEvidence.result.claims.items,
        citations: withEvidence.result.citations.inText,
        references: withEvidence.result.citations.references,
        sources: withEvidence.result.evidence.sources,
      },
      {
        judge: usable ? ollamaJudge(verificationConfig) : null,
        modelName: usable ? verificationConfig.model : null,
        unavailableReason: status.reason,
        timeBudgetMs: verificationConfig.timeBudgetMs,
      },
    );
  } catch {
    return c.json(
      errorResponse(
        "VERIFICATION_FAILED",
        "Claim verification failed unexpectedly after evidence was retrieved.",
      ),
      500,
    );
  }

  const response: VerifyClaimsResponse = {
    ...withEvidence.result,
    verification,
  };
  return c.json(response, 200);
});

// The API remains independently testable through `app`. The production
// server also serves the built React application so a free Render service can
// provide one HTTPS origin without opening CORS or requiring a second host.
const serverApp = new Hono();
serverApp.route("/", app);
serverApp.use("/*", serveStatic({ root: "./public" }));
serverApp.get("/*", serveStatic({ path: "./public/index.html" }));

export default {
  port: Number(process.env.API_PORT ?? 3001),
  // Retrieval (90 s budget) plus local-model verification (120 s budget) exceed
  // Bun's 10 s default idle timeout; 240 s stays under Bun's 255 s maximum.
  idleTimeout: 240,
  fetch: serverApp.fetch,
};
