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

export type ApiErrorCode =
  | PdfExtractionErrorCode
  | "CLAIM_EXTRACTION_FAILED"
  | "CITATION_EXTRACTION_FAILED";

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

/**
 * Bibliographic fields read from one reference entry's own text. Every
 * non-null value appears in that entry; nothing is looked up or inferred.
 */
export type BibliographicMetadata = {
  /** Author names as written, in order; empty when they cannot be separated reliably. */
  authors: string[];
  /** Four-digit year with any disambiguating letter, e.g. "2020a". */
  year: string | null;
  title: string | null;
  doi: string | null;
};

export type ReferenceEntry = {
  /** Sequential in list order: ref-001, ref-002, ... */
  id: string;
  /** The entry's own number for numbered lists; null for author-year lists. */
  number: number | null;
  /** Exact entry text; only line breaks and whitespace runs are collapsed. */
  text: string;
  page: number;
  pageEnd: number;
  /** Offsets into `extraction.pages[page - 1].text`; null when the entry spans pages. */
  location: { start: number; end: number } | null;
  metadata: BibliographicMetadata;
};

export type CitationMatchStatus = "matched" | "unmatched" | "ambiguous";

/** The resolution of one cited item (one number, or one author-year pair). */
export type CitationMatch = {
  /** The cited item as a reader would name it, e.g. "5" or "Smith et al., 2020". */
  key: string;
  status: CitationMatchStatus;
  /** One id when matched, every candidate when ambiguous, none when unmatched. */
  referenceIds: string[];
  /** Why the item is unmatched or ambiguous; null when matched. */
  reason: string | null;
};

export type InTextCitation = {
  /** Sequential in reading order: cit-001, cit-002, ... */
  id: string;
  /** Exact marker text, e.g. "[4-7]" or "(Smith et al., 2020)". */
  marker: string;
  style: "numeric" | "author-year";
  page: number;
  /** Offsets into `extraction.pages[page - 1].text`. */
  location: { start: number; end: number };
  /** The extracted claim containing this marker, if any. */
  claimId: string | null;
  matches: CitationMatch[];
};

export type ExtractCitationsResponse = ExtractClaimsResponse & {
  citations: {
    referenceList: {
      found: boolean;
      /** Page of the reference list heading. */
      page: number | null;
      style: "numbered" | "author-year" | null;
    };
    references: ReferenceEntry[];
    inText: InTextCitation[];
    method: "rule-based";
    version: string;
    /** True when more references or citations existed than the response limits allowed. */
    truncated: boolean;
    /** A matched citation links a claim to a reference entry; it does not show the source supports the claim. */
    evidenceStatus: "not_verified";
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
