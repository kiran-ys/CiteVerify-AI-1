export const MAX_PDF_BYTES = 25 * 1024 * 1024;

export type PdfExtractionErrorCode =
  | "FILE_REQUIRED"
  | "FILE_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "INVALID_PDF"
  | "ENCRYPTED_PDF"
  | "NO_EXTRACTABLE_TEXT"
  | "PAGE_LIMIT_EXCEEDED"
  | "EXTRACTION_TIMEOUT"
  | "EXTRACTION_FAILED";

export type ApiErrorCode = PdfExtractionErrorCode | "CLAIM_EXTRACTION_FAILED";

export type ApiErrorResponse = {
  error: {
    code: ApiErrorCode;
    message: string;
    requestId?: string;
  };
};

export type ExtractedPdfPage = { page: number; text: string };

export type PdfExtractionWarning = {
  code: "EMPTY_PAGE";
  message: string;
  page: number;
};

/**
 * A candidate claim found in the uploaded paper's own extracted text.
 * It is NOT verified: it carries no verdict and no confidence score.
 */
export type ExtractedClaimType = "reported_finding" | "cited_claim";

export type ExtractedClaim = {
  /** Stable within one response, in reading order: claim-001, claim-002, ... */
  id: string;
  /** Exact source wording; only line breaks and runs of whitespace become single spaces. */
  text: string;
  /** 1-based page number in the uploaded PDF. */
  page: number;
  /** Character offsets into `extraction.pages[page - 1].text` (end is exclusive). */
  location: { start: number; end: number };
  /** Nearest detected section heading on or before this claim, if any. */
  section: string | null;
  /** Neighbouring sentences on the same page, for human review. */
  context: { before: string | null; after: string | null };
  type: ExtractedClaimType;
  extraction: {
    method: "rule-based";
    version: string;
    /** Human-readable names of the rules that selected this sentence. */
    signals: string[];
  };
};

export type ExtractClaimsResponse = ExtractDocumentResponse & {
  claims: {
    items: ExtractedClaim[];
    method: "rule-based";
    version: string;
    /** True when more candidates existed than the response limit allowed. */
    truncated: boolean;
    verificationStatus: "not_verified";
  };
};

export type ExtractDocumentResponse = {
  document: {
    name: string;
    mediaType: "application/pdf";
    sizeBytes: number;
    pageCount: number;
  };
  extraction: {
    text: string;
    pages: ExtractedPdfPage[];
    warnings: PdfExtractionWarning[];
    parser: { name: "unpdf"; version: string };
  };
};
