/**
 * Keeps the processed paper (API results only, never the PDF bytes) for the
 * current browser tab, so switching pages or reloading does not lose it.
 * sessionStorage is cleared when the tab closes and is never sent anywhere.
 */
import type {
  ExtractCitationsResponse,
  ExtractEvidenceResponse,
  VerifyClaimsResponse,
} from "@citeverify/shared";

export type PaperResult =
  | ExtractCitationsResponse
  | ExtractEvidenceResponse
  | VerifyClaimsResponse;

export const PAPER_KEY = "citeverify.paper.v1";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function isPaperResult(value: unknown): value is PaperResult {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const doc = v.document as Record<string, unknown> | undefined;
  const extraction = v.extraction as Record<string, unknown> | undefined;
  const claims = v.claims as Record<string, unknown> | undefined;
  const citations = v.citations as Record<string, unknown> | undefined;
  return (
    typeof doc?.name === "string" &&
    typeof doc.pageCount === "number" &&
    typeof extraction?.text === "string" &&
    Array.isArray(claims?.items) &&
    Array.isArray(citations?.inText) &&
    Array.isArray(citations?.references) &&
    typeof v.internalConsistency === "object"
  );
}

/** Saves the result; returns false when storage is unavailable or full. */
export function savePaper(storage: StorageLike, result: PaperResult): boolean {
  try {
    storage.setItem(PAPER_KEY, JSON.stringify(result));
    return true;
  } catch {
    return false;
  }
}

/** The saved result, or undefined when missing, unreadable, or malformed. */
export function loadPaper(storage: StorageLike): PaperResult | undefined {
  try {
    const raw = storage.getItem(PAPER_KEY);
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    return isPaperResult(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function clearPaper(storage: StorageLike): void {
  try {
    storage.removeItem(PAPER_KEY);
  } catch {
    // Storage blocked: nothing was saved.
  }
}

/** sessionStorage when the browser allows it. */
export function sessionStore(): StorageLike | undefined {
  try {
    return typeof sessionStorage === "undefined" ? undefined : sessionStorage;
  } catch {
    return undefined;
  }
}
