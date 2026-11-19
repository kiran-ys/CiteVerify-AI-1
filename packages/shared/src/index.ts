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

export type ApiErrorResponse = {
  error: {
    code: PdfExtractionErrorCode;
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
