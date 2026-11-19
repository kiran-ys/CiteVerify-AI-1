import { describe, expect, test } from "bun:test";
import type {
  ExtractCitationsResponse,
  ExtractClaimsResponse,
  ExtractEvidenceResponse,
  ExtractDocumentResponse,
} from "@citeverify/shared";
import {
  extractPdf,
  extractPdfCitations,
  extractPdfClaims,
  extractPdfEvidence,
} from "./api.ts";

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

const evidenceSuccess: ExtractEvidenceResponse = {
  ...citationsSuccess,
  evidence: {
    sources: [
      {
        referenceId: "ref-001",
        claimIds: ["claim-001"],
        resolution: {
          status: "resolved",
          reason: null,
          matchedBy: "doi",
          resolver: "crossref",
          candidates: [],
        },
        work: {
          title: "A study",
          authors: ["J. Smith"],
          year: "2020",
          doi: "10.1000/example",
          journal: null,
          pmid: null,
          pmcid: null,
          openAlexId: null,
        },
        access: "metadata_only",
        accessReason:
          "The work was not found in Europe PMC, and Crossref supplied no abstract.",
        license: null,
        urls: {
          doi: "https://doi.org/10.1000/example",
          landingPage: null,
          fullText: null,
        },
        passages: [],
        errors: [],
      },
    ],
    services: ["crossref", "openalex", "europepmc", "ncbi-pmc"],
    retrievedAt: "2026-11-19T12:00:00.000Z",
    method: "metadata-resolution+term-overlap",
    version: "1.0.0",
    truncated: false,
    claimStatus: "not_verified",
  },
};

describe("extractPdfEvidence", () => {
  test("posts the PDF to the evidence endpoint", async () => {
    let calledWith = "";
    const mockFetch = (input: RequestInfo | URL) => {
      calledWith = String(input);
      return Promise.resolve(Response.json(evidenceSuccess));
    };
    const result = await extractPdfEvidence(
      new File(["pdf"], "paper.pdf", { type: "application/pdf" }),
      mockFetch,
    );
    expect(calledWith).toBe("/api/documents/evidence");
    expect(result.evidence.sources[0]?.access).toBe("metadata_only");
  });

  test("rejects a response that marks claims as verified", async () => {
    const mockFetch = () =>
      Promise.resolve(
        Response.json({
          ...evidenceSuccess,
          evidence: { ...evidenceSuccess.evidence, claimStatus: "verified" },
        }),
      );
    expect(
      extractPdfEvidence(
        new File(["pdf"], "paper.pdf", { type: "application/pdf" }),
        mockFetch,
      ),
    ).rejects.toThrow("invalid extraction response");
  });

  test("rejects an unknown access level", async () => {
    const bad = structuredClone(evidenceSuccess) as unknown as {
      evidence: { sources: { access: string }[] };
    };
    const first = bad.evidence.sources[0];
    if (first) first.access = "verified_full_text";
    expect(
      extractPdfEvidence(
        new File(["pdf"], "paper.pdf", { type: "application/pdf" }),
        () => Promise.resolve(Response.json(bad)),
      ),
    ).rejects.toThrow("invalid extraction response");
  });
});

describe("unreachable server", () => {
  test("explains a network-level failure instead of showing 'Failed to fetch'", async () => {
    const mockFetch = () => Promise.reject(new TypeError("Failed to fetch"));
    expect(
      extractPdfEvidence(
        new File(["pdf"], "paper.pdf", { type: "application/pdf" }),
        mockFetch,
      ),
    ).rejects.toThrow("Could not reach the CiteVerify server");
  });

  test("still explains a proxy 502 when the API behind Vite is down", async () => {
    const mockFetch = () => Promise.resolve(new Response("", { status: 502 }));
    expect(
      extractPdfCitations(
        new File(["pdf"], "paper.pdf", { type: "application/pdf" }),
        mockFetch,
      ),
    ).rejects.toThrow("The extraction service is unavailable (HTTP 502)");
  });
});
