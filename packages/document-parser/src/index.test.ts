import { describe, expect, test } from "bun:test";
import { createEmptyPdf, createTextPdf } from "../../../test/pdf-fixture.ts";
import { PdfParserError, parsePdf } from "./index.ts";

describe("parsePdf", () => {
  test("extracts text and page provenance from a real PDF", async () => {
    const result = await parsePdf(
      createTextPdf("Evidence comes from the uploaded document."),
    );

    expect(result.pageCount).toBe(1);
    expect(result.text).toContain("Evidence comes from the uploaded document.");
    expect(result.pages).toEqual([
      { page: 1, text: "Evidence comes from the uploaded document." },
    ]);
    expect(result.warnings).toEqual([]);
  });

  test("rejects a non-PDF payload", async () => {
    expect(
      parsePdf(new TextEncoder().encode("not a pdf")),
    ).rejects.toMatchObject({
      code: "INVALID_PDF",
    });
  });

  test("reports a valid PDF with no text honestly", async () => {
    expect(parsePdf(createEmptyPdf())).rejects.toMatchObject({
      code: "NO_EXTRACTABLE_TEXT",
    });
  });

  test("enforces the configured page limit before extraction", async () => {
    try {
      await parsePdf(createTextPdf(), { maxPages: 0 });
      throw new Error("Expected page limit rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(PdfParserError);
      expect((error as PdfParserError).code).toBe("PAGE_LIMIT_EXCEEDED");
    }
  });
});
