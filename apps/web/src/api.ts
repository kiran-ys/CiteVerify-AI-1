import type {
  ApiErrorResponse,
  ExtractDocumentResponse,
} from "@citeverify/shared";

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function isApiError(value: unknown): value is ApiErrorResponse {
  if (typeof value !== "object" || value === null || !("error" in value))
    return false;
  const error = value.error;
  return (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  );
}

function isExtraction(value: unknown): value is ExtractDocumentResponse {
  if (
    typeof value !== "object" ||
    value === null ||
    !("document" in value) ||
    !("extraction" in value)
  )
    return false;
  const extraction = value.extraction;
  return (
    typeof extraction === "object" &&
    extraction !== null &&
    "text" in extraction &&
    typeof extraction.text === "string"
  );
}

export async function extractPdf(
  file: File,
  fetchImpl: FetchLike = fetch,
): Promise<ExtractDocumentResponse> {
  const body = new FormData();
  body.set("file", file);
  const response = await fetchImpl("/api/documents/extract", {
    method: "POST",
    body,
  });
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
  if (!isExtraction(payload)) {
    throw new Error("The server returned an invalid extraction response.");
  }
  return payload;
}
