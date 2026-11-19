import { describe, expect, test } from "bun:test";
import type {
  ApiErrorResponse,
  ExtractDocumentResponse,
} from "@citeverify/shared";
import { createTextPdf } from "../../../test/pdf-fixture.ts";
import { app, statusForParserError } from "./index.ts";

describe("statusForParserError", () => {
  test("maps parser error codes to the documented HTTP statuses", () => {
    expect(statusForParserError("INVALID_PDF")).toBe(400);
    expect(statusForParserError("ENCRYPTED_PDF")).toBe(400);
    expect(statusForParserError("PAGE_LIMIT_EXCEEDED")).toBe(413);
    expect(statusForParserError("NO_EXTRACTABLE_TEXT")).toBe(422);
    expect(statusForParserError("EXTRACTION_FAILED")).toBe(500);
    expect(statusForParserError("EXTRACTION_TIMEOUT")).toBe(503);
  });
});

function uploadRequest(file?: File): Request {
  const body = new FormData();
  if (file) body.set("file", file);
  return new Request("http://localhost/api/documents/extract", {
    method: "POST",
    body,
  });
}

describe("POST /api/documents/extract", () => {
  test("returns actual page text for a PDF upload", async () => {
    const file = new File(
      [createTextPdf("API extraction works.")],
      "paper.pdf",
      {
        type: "application/pdf",
      },
    );
    const response = await app.request(uploadRequest(file));
    const body = (await response.json()) as ExtractDocumentResponse;

    expect(response.status).toBe(200);
    expect(body.document).toMatchObject({
      name: "paper.pdf",
      mediaType: "application/pdf",
      pageCount: 1,
    });
    expect(body.extraction.text).toContain("API extraction works.");
    expect(body.extraction.parser).toEqual({ name: "unpdf", version: "2.2.1" });
    expect(Object.keys(body.extraction).sort()).toEqual([
      "pages",
      "parser",
      "text",
      "warnings",
    ]);
  });

  test("requires the file field", async () => {
    const response = await app.request(uploadRequest());
    const body = (await response.json()) as ApiErrorResponse;

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("FILE_REQUIRED");
  });

  test("rejects a non-PDF media type", async () => {
    const response = await app.request(
      uploadRequest(new File(["hello"], "notes.txt", { type: "text/plain" })),
    );
    const body = (await response.json()) as ApiErrorResponse;

    expect(response.status).toBe(415);
    expect(body.error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  test("rejects fake PDF content", async () => {
    const response = await app.request(
      uploadRequest(
        new File(["not a pdf"], "fake.pdf", { type: "application/pdf" }),
      ),
    );
    const body = (await response.json()) as ApiErrorResponse;

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_PDF");
  });
});
