import { describe, expect, test } from "bun:test";
import type {
  ApiErrorResponse,
  ExtractClaimsResponse,
  ExtractDocumentResponse,
} from "@citeverify/shared";
import {
  createEmptyPdf,
  createMultiPagePdf,
  createTextPdf,
} from "../../../test/pdf-fixture.ts";
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

function uploadRequest(file?: File, path = "/api/documents/extract"): Request {
  const body = new FormData();
  if (file) body.set("file", file);
  return new Request(`http://localhost${path}`, {
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

const CLAIMS_PATH = "/api/documents/claims";

function pdfFile(bytes: Uint8Array, name = "paper.pdf"): File {
  return new File([bytes], name, { type: "application/pdf" });
}

describe("POST /api/documents/claims", () => {
  const paperPages = [
    [
      "Running Title Example Journal",
      "Abstract",
      "Sleep loss is common among hospital staff.",
      "We found that night-shift nurses slept 1.5 hours less than day-shift",
      "nurses (p < 0.001).",
      "1. Introduction",
      "Chronic sleep restriction impairs attention [2].",
      "Hospitals employ many nurses on rotating schedules.",
    ],
    [
      "Running Title Example Journal",
      "2. Methods",
      "Participants wore wrist actigraphs for 14 days.",
      "3. Results",
      "Reaction times were significantly longer after night shifts.",
    ],
    [
      "Running Title Example Journal",
      "Our data show that napping before a shift reduced errors by 20%.",
      "References",
      "2. Lim J, Dinges DF. Sleep deprivation and attention. Psychol Bull. 2010;136(3):375-89.",
    ],
  ];

  test("returns the original extraction plus unverified claims with page numbers", async () => {
    const response = await app.request(
      uploadRequest(pdfFile(createMultiPagePdf(paperPages)), CLAIMS_PATH),
    );
    const body = (await response.json()) as ExtractClaimsResponse;

    expect(response.status).toBe(200);
    expect(body.document.pageCount).toBe(3);
    expect(body.extraction.pages).toHaveLength(3);
    expect(body.claims).toMatchObject({
      method: "rule-based",
      truncated: false,
      verificationStatus: "not_verified",
    });
    expect(
      body.claims.items.map((claim) => [claim.page, claim.type, claim.text]),
    ).toEqual([
      [
        1,
        "reported_finding",
        "We found that night-shift nurses slept 1.5 hours less than day-shift nurses (p < 0.001).",
      ],
      [1, "cited_claim", "Chronic sleep restriction impairs attention [2]."],
      [
        2,
        "reported_finding",
        "Reaction times were significantly longer after night shifts.",
      ],
      [
        3,
        "reported_finding",
        "Our data show that napping before a shift reduced errors by 20%.",
      ],
    ]);
  });

  test("claim offsets point into the returned page text", async () => {
    const response = await app.request(
      uploadRequest(pdfFile(createMultiPagePdf(paperPages)), CLAIMS_PATH),
    );
    const body = (await response.json()) as ExtractClaimsResponse;

    for (const claim of body.claims.items) {
      const pageText = body.extraction.pages[claim.page - 1]?.text ?? "";
      expect(
        pageText
          .slice(claim.location.start, claim.location.end)
          .replace(/\s+/g, " "),
      ).toBe(claim.text);
    }
  });

  test("never returns verdicts or confidence scores", async () => {
    const response = await app.request(
      uploadRequest(pdfFile(createMultiPagePdf(paperPages)), CLAIMS_PATH),
    );
    const text = await response.text();

    expect(text).not.toMatch(/"(verdict|confidence|score)"/i);
  });

  test("returns an empty claim list for a text PDF without claims", async () => {
    const response = await app.request(
      uploadRequest(
        pdfFile(createTextPdf("A short note with no findings.")),
        CLAIMS_PATH,
      ),
    );
    const body = (await response.json()) as ExtractClaimsResponse;

    expect(response.status).toBe(200);
    expect(body.extraction.text).toBe("A short note with no findings.");
    expect(body.claims.items).toEqual([]);
  });

  test("reuses extraction errors for a PDF with no text", async () => {
    const response = await app.request(
      uploadRequest(pdfFile(createEmptyPdf()), CLAIMS_PATH),
    );
    const body = (await response.json()) as ApiErrorResponse;

    expect(response.status).toBe(422);
    expect(body.error.code).toBe("NO_EXTRACTABLE_TEXT");
  });

  test("reuses upload validation", async () => {
    const missing = await app.request(uploadRequest(undefined, CLAIMS_PATH));
    expect(missing.status).toBe(400);

    const wrongType = await app.request(
      uploadRequest(
        new File(["hello"], "notes.txt", { type: "text/plain" }),
        CLAIMS_PATH,
      ),
    );
    expect(wrongType.status).toBe(415);
  });
});
