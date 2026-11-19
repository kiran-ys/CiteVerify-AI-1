import {
  PDF_PARSER_NAME,
  PDF_PARSER_VERSION,
  PdfParserError,
  parsePdf,
} from "@citeverify/document-parser";
import {
  MAX_PDF_BYTES,
  type ApiErrorResponse,
  type ExtractDocumentResponse,
  type PdfExtractionErrorCode,
} from "@citeverify/shared";
import { Hono } from "hono";

export const app = new Hono().basePath("/api");

app.get("/health", (c) => c.json({ status: "ok" }));

function errorResponse(
  code: PdfExtractionErrorCode,
  message: string,
): ApiErrorResponse {
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

app.post("/documents/extract", async (c) => {
  const declaredLength = Number(c.req.header("content-length") ?? 0);
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_PDF_BYTES + 1024 * 1024
  ) {
    return c.json(
      errorResponse("FILE_TOO_LARGE", "The PDF exceeds the 25 MB limit."),
      413,
    );
  }

  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return c.json(
      errorResponse("FILE_REQUIRED", "Provide one PDF in the file field."),
      400,
    );
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return c.json(
      errorResponse("FILE_REQUIRED", "Provide one PDF in the file field."),
      400,
    );
  }
  if (file.type !== "application/pdf") {
    return c.json(
      errorResponse(
        "UNSUPPORTED_MEDIA_TYPE",
        "Only application/pdf uploads are supported.",
      ),
      415,
    );
  }
  if (file.size > MAX_PDF_BYTES) {
    return c.json(
      errorResponse("FILE_TOO_LARGE", "The PDF exceeds the 25 MB limit."),
      413,
    );
  }

  try {
    const parsed = await parsePdf(new Uint8Array(await file.arrayBuffer()));
    const response: ExtractDocumentResponse = {
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
    };
    return c.json(response, 200);
  } catch (error) {
    if (error instanceof PdfParserError) {
      return c.json(
        errorResponse(error.code, error.message),
        statusForParserError(error.code),
      );
    }
    return c.json(
      errorResponse("EXTRACTION_FAILED", "PDF text extraction failed."),
      500,
    );
  }
});

export default {
  port: Number(process.env.API_PORT ?? 3001),
  fetch: app.fetch,
};
