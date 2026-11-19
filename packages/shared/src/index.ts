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
  | "CITATION_EXTRACTION_FAILED"
  | "EVIDENCE_RETRIEVAL_FAILED";

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

/** External scholarly services used for source retrieval. All are free and keyless. */
export type ScholarlyService =
  | "crossref"
  | "openalex"
  | "europepmc"
  | "ncbi-pmc";

/**
 * How much of a cited source could be legally accessed.
 * - full_text: open-access full text from Europe PMC, or from PubMed Central (NCBI) when Europe PMC cannot serve it.
 * - abstract_only: an abstract, but no accessible full text.
 * - metadata_only: the work was identified, but no abstract or full text was available.
 * - unavailable: the work could not be identified or retrieved.
 */
export type SourceAccess =
  | "full_text"
  | "abstract_only"
  | "metadata_only"
  | "unavailable";

export type SourceResolutionStatus =
  | "resolved"
  | "ambiguous"
  | "unresolved"
  | "error"
  | "skipped";

export type SourceCandidate = {
  title: string;
  doi: string | null;
  year: string | null;
};

/** Bibliographic record as returned by an external service, not as written in the paper. */
export type ResolvedWork = {
  title: string;
  authors: string[];
  year: string | null;
  doi: string | null;
  journal: string | null;
  pmid: string | null;
  pmcid: string | null;
  openAlexId: string | null;
};

export type ServiceError = {
  service: ScholarlyService;
  kind: "timeout" | "network" | "rate_limited" | "http" | "invalid_response";
  message: string;
};

export type EvidencePassage = {
  claimId: string;
  /** Source text exactly as the service returned it; markup removed and whitespace collapsed. */
  text: string;
  /** True when inline markup (italics, superscripts, citation links) was removed from the paragraph containing this passage, so formatting such as superscripts is flattened. */
  markupRemoved: boolean;
  origin: "full_text" | "abstract";
  location: {
    /** Section heading in the source, when the source text has one. */
    section: string | null;
    /** 1-based paragraph number in the source body (full text) or abstract. */
    paragraph: number;
    /** 1-based sentence number within that paragraph. */
    sentence: number;
  };
  sourceUrl: string;
  /** Lexical overlap with the claim. It measures shared words only, never support. */
  relevance: { method: "term-overlap"; sharedTerms: string[]; score: number };
};

export type RetrievedSource = {
  referenceId: string;
  /** Claims whose matched citations point to this reference. */
  claimIds: string[];
  resolution: {
    status: SourceResolutionStatus;
    reason: string | null;
    matchedBy: "doi" | "bibliographic-search" | null;
    resolver: "crossref" | "openalex" | null;
    candidates: SourceCandidate[];
  };
  work: ResolvedWork | null;
  access: SourceAccess;
  accessReason: string | null;
  license: string | null;
  urls: {
    doi: string | null;
    landingPage: string | null;
    fullText: string | null;
  };
  passages: EvidencePassage[];
  errors: ServiceError[];
};

export type ExtractEvidenceResponse = ExtractCitationsResponse & {
  evidence: {
    sources: RetrievedSource[];
    services: ScholarlyService[];
    retrievedAt: string;
    method: "metadata-resolution+term-overlap";
    version: string;
    /** True when more cited references existed than the per-request source limit. */
    truncated: boolean;
    /** Retrieval never decides whether a claim is supported. */
    claimStatus: "not_verified";
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
