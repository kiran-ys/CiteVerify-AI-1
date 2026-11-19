import { describe, expect, test } from "bun:test";
import type {
  ExtractCitationsResponse,
  ExtractClaimsResponse,
  ExtractDocumentResponse,
} from "@citeverify/shared";
import { extractPdf, extractPdfCitations, extractPdfClaims } from "./api.ts";

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

const claimsSuccess: ExtractClaimsResponse = {
  ...success,
  claims: {
    items: [
      {
        id: "claim-001",
        text: "We found that uptake increased by 12% (p < 0.01).",
        page: 1,
        location: { start: 0, end: 49 },
        section: "Results",
        context: { before: null, after: null },
        type: "reported_finding",
        extraction: {
          method: "rule-based",
          version: "1.0.0",
          signals: ["first-person result statement"],
        },
      },
    ],
    method: "rule-based",
    version: "1.0.0",
    truncated: false,
    verificationStatus: "not_verified",
  },
};

describe("extractPdfClaims", () => {
  test("posts the PDF to the claims endpoint and returns unverified claims", async () => {
    let calledWith = "";
    const mockFetch = (input: RequestInfo | URL) => {
      calledWith = String(input);
      return Promise.resolve(Response.json(claimsSuccess));
    };
    const result = await extractPdfClaims(
      new File(["pdf"], "paper.pdf", { type: "application/pdf" }),
      mockFetch,
    );

    expect(calledWith).toBe("/api/documents/claims");
    expect(result.claims.items[0]?.page).toBe(1);
    expect(result.claims.verificationStatus).toBe("not_verified");
  });

  test("rejects a response that omits the not-verified marker", async () => {
    const mockFetch = () =>
      Promise.resolve(
        Response.json({
          ...claimsSuccess,
          claims: { ...claimsSuccess.claims, verificationStatus: "verified" },
        }),
      );

    expect(
      extractPdfClaims(
        new File(["pdf"], "paper.pdf", { type: "application/pdf" }),
        mockFetch,
      ),
    ).rejects.toThrow("invalid extraction response");
  });

  test("rejects a text-only extraction response", async () => {
    const mockFetch = () => Promise.resolve(Response.json(success));

    expect(
      extractPdfClaims(
        new File(["pdf"], "paper.pdf", { type: "application/pdf" }),
        mockFetch,
      ),
    ).rejects.toThrow("invalid extraction response");
  });
});

const citationsSuccess: ExtractCitationsResponse = {
  ...claimsSuccess,
  citations: {
    referenceList: { found: true, page: 9, style: "numbered" },
    references: [
      {
        id: "ref-001",
        number: 1,
        text: "[1] Smith J. A study. J Test. 2020;1:1-2.",
        page: 9,
        pageEnd: 9,
        location: { start: 0, end: 41 },
        metadata: {
          authors: ["Smith J"],
          year: "2020",
          title: "A study",
          doi: null,
        },
      },
    ],
    inText: [
      {
        id: "cit-001",
        marker: "[1]",
        style: "numeric",
        page: 1,
        location: { start: 45, end: 48 },
        claimId: "claim-001",
        matches: [
          {
            key: "1",
            status: "matched",
            referenceIds: ["ref-001"],
            reason: null,
          },
        ],
      },
    ],
    method: "rule-based",
    version: "1.0.0",
    truncated: false,
    evidenceStatus: "not_verified",
  },
};

describe("extractPdfCitations", () => {
  test("posts the PDF to the citations endpoint", async () => {
    let calledWith = "";
    const mockFetch = (input: RequestInfo | URL) => {
      calledWith = String(input);
      return Promise.resolve(Response.json(citationsSuccess));
    };
    const result = await extractPdfCitations(
      new File(["pdf"], "paper.pdf", { type: "application/pdf" }),
      mockFetch,
    );

    expect(calledWith).toBe("/api/documents/citations");
    expect(result.citations.inText[0]?.matches[0]?.status).toBe("matched");
  });

  test("rejects a response that claims evidence was verified", async () => {
    const mockFetch = () =>
      Promise.resolve(
        Response.json({
          ...citationsSuccess,
          citations: {
            ...citationsSuccess.citations,
            evidenceStatus: "verified",
          },
        }),
      );

    expect(
      extractPdfCitations(
        new File(["pdf"], "paper.pdf", { type: "application/pdf" }),
        mockFetch,
      ),
    ).rejects.toThrow("invalid extraction response");
  });

  test("rejects an unknown match status", async () => {
    const bad = structuredClone(citationsSuccess) as unknown as {
      citations: { inText: { matches: { status: string }[] }[] };
    };
    const first = bad.citations.inText[0]?.matches[0];
    if (first) first.status = "supported";
    const mockFetch = () => Promise.resolve(Response.json(bad));

    expect(
      extractPdfCitations(
        new File(["pdf"], "paper.pdf", { type: "application/pdf" }),
        mockFetch,
      ),
    ).rejects.toThrow("invalid extraction response");
  });
});
