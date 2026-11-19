import { describe, expect, test } from "bun:test";
import type { ExtractDocumentResponse } from "@citeverify/shared";
import { extractPdf } from "./api.ts";

const success: ExtractDocumentResponse = {
  document: {
    name: "paper.pdf",
    mediaType: "application/pdf",
    sizeBytes: 12,
    pageCount: 1,
  },
  extraction: {
    text: "Actual extracted text",
    pages: [{ page: 1, text: "Actual extracted text" }],
    warnings: [],
    parser: { name: "unpdf", version: "2.2.1" },
  },
};

describe("extractPdf", () => {
  test("returns a validated successful response", async () => {
    const mockFetch = () => Promise.resolve(Response.json(success));
    const result = await extractPdf(
      new File(["pdf"], "paper.pdf", { type: "application/pdf" }),
      mockFetch,
    );

    expect(result.extraction.text).toBe("Actual extracted text");
  });

  test("surfaces the API error message", async () => {
    const mockFetch = () =>
      Promise.resolve(
        Response.json(
          {
            error: {
              code: "INVALID_PDF",
              message: "The uploaded file is invalid.",
            },
          },
          { status: 400 },
        ),
      );

    expect(
      extractPdf(
        new File(["bad"], "fake.pdf", { type: "application/pdf" }),
        mockFetch,
      ),
    ).rejects.toThrow("The uploaded file is invalid.");
  });

  test("rejects a malformed success response", async () => {
    const mockFetch = () => Promise.resolve(Response.json({ ok: true }));

    expect(
      extractPdf(
        new File(["pdf"], "paper.pdf", { type: "application/pdf" }),
        mockFetch,
      ),
    ).rejects.toThrow("invalid extraction response");
  });

  test("explains a non-JSON error response instead of a parse error", async () => {
    const mockFetch = () =>
      Promise.resolve(
        new Response("<html>Bad Gateway</html>", { status: 502 }),
      );

    expect(
      extractPdf(
        new File(["pdf"], "paper.pdf", { type: "application/pdf" }),
        mockFetch,
      ),
    ).rejects.toThrow("extraction service is unavailable (HTTP 502)");
  });
});
