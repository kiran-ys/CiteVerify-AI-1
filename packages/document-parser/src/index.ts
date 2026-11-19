import type {
  ExtractedPdfPage,
  PdfExtractionErrorCode,
  PdfExtractionWarning,
} from "@citeverify/shared";
import { extractText, getDocumentProxy } from "unpdf";

export const PDF_PARSER_NAME = "unpdf" as const;
export const PDF_PARSER_VERSION = "2.2.1";
export const DEFAULT_MAX_PDF_PAGES = 500;
export const DEFAULT_PDF_TIMEOUT_MS = 15_000;
const MAX_IMAGE_PIXELS = 16_777_216;

export class PdfParserError extends Error {
  constructor(
    public readonly code: PdfExtractionErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "PdfParserError";
  }
}

export type ParsePdfOptions = { maxPages?: number; timeoutMs?: number };

export type ParsedPdf = {
  text: string;
  pageCount: number;
  pages: ExtractedPdfPage[];
  warnings: PdfExtractionWarning[];
};

function hasPdfSignature(data: Uint8Array): boolean {
  return (
    data.length >= 5 &&
    data[0] === 0x25 &&
    data[1] === 0x50 &&
    data[2] === 0x44 &&
    data[3] === 0x46 &&
    data[4] === 0x2d
  );
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new PdfParserError("EXTRACTION_TIMEOUT", "PDF extraction timed out."),
        ),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function mapParserError(error: unknown): PdfParserError {
  if (error instanceof PdfParserError) return error;

  const message = error instanceof Error ? error.message : String(error);
  if (/password|encrypted/i.test(message)) {
    return new PdfParserError(
      "ENCRYPTED_PDF",
      "The PDF is encrypted or requires a password.",
      {
        cause: error,
      },
    );
  }
  if (/invalid|malformed|format|header|xref|pdf/i.test(message)) {
    return new PdfParserError(
      "INVALID_PDF",
      "The uploaded file is not a valid readable PDF.",
      {
        cause: error,
      },
    );
  }
  return new PdfParserError(
    "EXTRACTION_FAILED",
    "PDF text extraction failed.",
    {
      cause: error,
    },
  );
}

export async function parsePdf(
  input: Uint8Array,
  options: ParsePdfOptions = {},
): Promise<ParsedPdf> {
  if (!hasPdfSignature(input)) {
    throw new PdfParserError(
      "INVALID_PDF",
      "The uploaded file does not have a PDF signature.",
    );
  }

  const maxPages = options.maxPages ?? DEFAULT_MAX_PDF_PAGES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_PDF_TIMEOUT_MS;
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>> | undefined;

  try {
    pdf = await withTimeout(
      getDocumentProxy(input, {
        maxImageSize: MAX_IMAGE_PIXELS,
        stopAtErrors: true,
      }),
      timeoutMs,
    );
    if (pdf.numPages > maxPages) {
      throw new PdfParserError(
        "PAGE_LIMIT_EXCEEDED",
        `The PDF contains ${pdf.numPages} pages; the limit is ${maxPages}.`,
      );
    }

    const result = await withTimeout(
      extractText(pdf, { mergePages: false }),
      timeoutMs,
    );
    const pages = result.text.map((text, index) => ({
      page: index + 1,
      text: text.trim(),
    }));
    const text = pages
      .map((page) => page.text)
      .filter(Boolean)
      .join("\n\n")
      .trim();
    if (!text) {
      throw new PdfParserError(
        "NO_EXTRACTABLE_TEXT",
        "The PDF contains no extractable text. It may be scanned or image-only.",
      );
    }

    const warnings = pages
      .filter((page) => !page.text)
      .map<PdfExtractionWarning>((page) => ({
        code: "EMPTY_PAGE",
        message: `Page ${page.page} contains no extractable text.`,
        page: page.page,
      }));
    return { text, pageCount: result.totalPages, pages, warnings };
  } catch (error) {
    throw mapParserError(error);
  } finally {
    await pdf?.cleanup();
  }
}
