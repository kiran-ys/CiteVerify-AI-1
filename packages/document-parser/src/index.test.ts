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
      {
        page: 1,
        text: "Evidence comes from the uploaded document.",
        superscripts: [],
      },
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

describe("superscript detection", () => {
  test("records typeset superscripts with exact offsets and pieces", async () => {
    const { createMultiPagePdf } = await import("../../../test/pdf-fixture.ts");
    const result = await parsePdf(
      createMultiPagePdf([
        [
          "Menopause worsens risk factors^{1-3} and fitness^{4} in women.",
          "Function is impaired after menopause.^{5,6} BMI was 25 kg/m^{2} overall.",
        ],
      ]),
    );
    const page = result.pages[0];
    expect(page?.text).toBe(
      "Menopause worsens risk factors1-3 and fitness4 in women.\nFunction is impaired after menopause.56 BMI was 25 kg/m2 overall.",
    );
    expect(page?.superscripts?.map((run) => run.parts)).toEqual([
      ["1-3"],
      ["4"],
      ["5", "6"],
      ["2"],
    ]);
    for (const run of page?.superscripts ?? []) {
      expect(page?.text.slice(run.start, run.end)).toBe(run.parts.join(""));
    }
  });

  test("does not mark ordinary digits as superscripts", async () => {
    const result = await parsePdf(
      createTextPdf("Trial 12 enrolled 155 women in 2004."),
    );
    expect(result.pages[0]?.superscripts).toEqual([]);
  });
});

describe("wrapped superscripts", () => {
  test("detects small citation digits alone on the line below a sentence", async () => {
    const { createMultiPagePdf } = await import("../../../test/pdf-fixture.ts");
    const result = await parsePdf(
      createMultiPagePdf([
        [
          "Populations with high blood pressure improve with exercise training.",
          "^{14,16,17}",
          "The lack of a dose response may reflect a ceiling effect.",
        ],
      ]),
    );
    const page = result.pages[0];
    expect(page?.superscripts?.map((run) => run.parts)).toEqual([
      ["14", "16", "17"],
    ]);
    const run = page?.superscripts?.[0];
    expect(page?.text.slice(run?.start, run?.end)).toBe("141617");
  });

  test("does not treat an ordinary line of numbers as a superscript", async () => {
    const { createMultiPagePdf } = await import("../../../test/pdf-fixture.ts");
    const result = await parsePdf(
      createMultiPagePdf([["Table 2 shows the values below.", "12 14 16"]]),
    );
    expect(result.pages[0]?.superscripts).toEqual([]);
  });
});
