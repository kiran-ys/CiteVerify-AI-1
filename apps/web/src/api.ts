import type {
  ApiErrorResponse,
  ExtractClaimsResponse,
  ExtractDocumentResponse,
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

async function postPdf<T>(
  path: string,
  file: File,
  isExpected: (value: unknown) => value is T,
  fetchImpl: FetchLike,
): Promise<T> {
  const body = new FormData();
  body.set("file", file);
  const response = await fetchImpl(path, { method: "POST", body });
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
