import type {
  ApiErrorResponse,
  ExtractCitationsResponse,
  ExtractClaimsResponse,
  ExtractEvidenceResponse,
  ExtractDocumentResponse,
  VerificationStatusResponse,
  VerifyClaimsResponse,
} from "@citeverify/shared";

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isApiError(value: unknown): value is ApiErrorResponse {
  if (!isRecord(value) || !isRecord(value.error)) return false;
  return typeof value.error.message === "string";
}

function isExtraction(value: unknown): value is ExtractDocumentResponse {
  return (
    isRecord(value) &&
    isRecord(value.document) &&
    isRecord(value.extraction) &&
    typeof value.extraction.text === "string"
  );
}

function isClaim(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.text === "string" &&
    typeof value.page === "number" &&
    isRecord(value.context) &&
    isRecord(value.extraction) &&
    Array.isArray(value.extraction.signals)
  );
}

function isClaimsResponse(value: unknown): value is ExtractClaimsResponse {
  if (!isExtraction(value) || !("claims" in value)) return false;
  const claims = value.claims;
  return (
    isRecord(claims) &&
    claims.verificationStatus === "not_verified" &&
    Array.isArray(claims.items) &&
    claims.items.every(isClaim)
  );
}

function isCitationsResponse(
  value: unknown,
): value is ExtractCitationsResponse {
  if (!isClaimsResponse(value) || !("citations" in value)) return false;
  const citations = value.citations;
  const consistency =
    "internalConsistency" in value ? value.internalConsistency : null;
  return (
    isRecord(consistency) &&
    Array.isArray(consistency.results) &&
    typeof consistency.disclaimer === "string" &&
    isRecord(citations) &&
    citations.evidenceStatus === "not_verified" &&
    isRecord(citations.referenceList) &&
    Array.isArray(citations.references) &&
    Array.isArray(citations.inText) &&
    citations.inText.every(
      (citation) =>
        isRecord(citation) &&
        typeof citation.marker === "string" &&
        Array.isArray(citation.matches) &&
        citation.matches.every(
          (match) =>
            isRecord(match) &&
            ["matched", "unmatched", "ambiguous"].includes(
              String(match.status),
            ) &&
            Array.isArray(match.referenceIds),
        ),
    )
  );
}

async function postPdf<T>(
  path: string,
  file: File,
  isExpected: (value: unknown) => value is T,
  fetchImpl: FetchLike,
): Promise<T> {
  const body = new FormData();
  body.set("file", file);
  let response: Response;
  try {
    response = await fetchImpl(path, { method: "POST", body });
  } catch {
    // fetch rejects (browsers say "Failed to fetch") only when no HTTP
    // response arrived at all: the page's dev server stopped, or the
    // connection dropped. HTTP errors are handled below instead.
    throw new Error(
      "Could not reach the CiteVerify server, so no HTTP response was received. Check that `bun run dev` (Vite and the Hono API) is still running, then reload this page.",
    );
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(
      response.ok
        ? "The server returned an invalid extraction response."
        : `The extraction service is unavailable (HTTP ${response.status}). Check that the API is running.`,
    );
  }

  if (!response.ok) {
    throw new Error(
      isApiError(payload)
        ? payload.error.message
        : "The server could not extract this PDF.",
    );
  }
  if (!isExpected(payload)) {
    throw new Error("The server returned an invalid extraction response.");
  }
  return payload;
}

/** Text extraction only. */
export function extractPdf(
  file: File,
  fetchImpl: FetchLike = fetch,
): Promise<ExtractDocumentResponse> {
  return postPdf("/api/documents/extract", file, isExtraction, fetchImpl);
}

/** Text extraction plus unverified candidate claims, from one upload. */
export function extractPdfClaims(
  file: File,
  fetchImpl: FetchLike = fetch,
): Promise<ExtractClaimsResponse> {
  return postPdf("/api/documents/claims", file, isClaimsResponse, fetchImpl);
}

/** Text, unverified claims, and citation-to-reference matches, from one upload. */
export function extractPdfCitations(
  file: File,
  fetchImpl: FetchLike = fetch,
): Promise<ExtractCitationsResponse> {
  return postPdf(
    "/api/documents/citations",
    file,
    isCitationsResponse,
    fetchImpl,
  );
}

const ACCESS = ["full_text", "abstract_only", "metadata_only", "unavailable"];

function isEvidenceResponse(value: unknown): value is ExtractEvidenceResponse {
  if (!isCitationsResponse(value) || !("evidence" in value)) return false;
  const evidence = value.evidence;
  return (
    isRecord(evidence) &&
    evidence.claimStatus === "not_verified" &&
    Array.isArray(evidence.sources) &&
    evidence.sources.every(
      (source) =>
        isRecord(source) &&
        typeof source.referenceId === "string" &&
        ACCESS.includes(String(source.access)) &&
        isRecord(source.resolution) &&
        Array.isArray(source.passages) &&
        Array.isArray(source.errors),
    )
  );
}

/**
 * Everything from extractPdfCitations plus retrieved sources. The server
 * sends cited references' details (never the PDF) to scholarly services.
 */
export function extractPdfEvidence(
  file: File,
  fetchImpl: FetchLike = fetch,
): Promise<ExtractEvidenceResponse> {
  return postPdf(
    "/api/documents/evidence",
    file,
    isEvidenceResponse,
    fetchImpl,
  );
}

const VERDICTS = [
  "Supported",
  "Partially supported",
  "Contradicted",
  "Unsupported",
  "Unable to verify",
];

function isVerificationResponse(value: unknown): value is VerifyClaimsResponse {
  if (!isEvidenceResponse(value) || !("verification" in value)) return false;
  const verification = value.verification;
  return (
    isRecord(verification) &&
    verification.reviewStatus === "requires_human_review" &&
    Array.isArray(verification.results) &&
    verification.results.every(
      (result) =>
        isRecord(result) &&
        typeof result.claimId === "string" &&
        VERDICTS.includes(String(result.verdict)) &&
        Array.isArray(result.evidence) &&
        // A substantive verdict must come with evidence it relies on.
        (result.verdict === "Unable to verify" ||
          result.evidence.some(
            (item) =>
              isRecord(item) &&
              (item.relation === "supports" || item.relation === "contradicts"),
          )),
    )
  );
}

/**
 * Everything from extractPdfEvidence plus local-model verdicts. Uploads the
 * PDF to the local API only; the model runs in the operator's Ollama.
 */
export function extractPdfVerification(
  file: File,
  fetchImpl: FetchLike = fetch,
): Promise<VerifyClaimsResponse> {
  return postPdf(
    "/api/documents/verification",
    file,
    isVerificationResponse,
    fetchImpl,
  );
}

export async function getVerificationStatus(
  fetchImpl: FetchLike = fetch,
): Promise<VerificationStatusResponse> {
  try {
    const response = await fetchImpl("/api/verification/status");
    const body: unknown = await response.json();
    if (isRecord(body) && typeof body.available === "boolean") {
      return body as VerificationStatusResponse;
    }
  } catch {
    // fall through
  }
  return {
    available: false,
    provider: "ollama",
    host: "",
    model: "",
    modelInstalled: false,
    reason: "The CiteVerify API could not report the AI model's status.",
  };
}
