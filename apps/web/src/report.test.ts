import { describe, expect, test } from "bun:test";
import { paperQuality, share } from "./quality.ts";
import type {
  ExtractCitationsResponse,
  ExtractEvidenceResponse,
  VerifyClaimsResponse,
} from "@citeverify/shared";
import {
  clearPaper,
  loadPaper,
  PAPER_KEY,
  savePaper,
} from "./paper-session.ts";
import { buildReport, renderPdf, reportFileName, toWinAnsi } from "./report.ts";

const paper: ExtractCitationsResponse = {
  document: {
    name: "pierce study.pdf",
    mediaType: "application/pdf",
    sizeBytes: 1048576,
    pageCount: 2,
  },
  extraction: {
    text: "Exercise and FMD in women\nWalking improved FMD in men.1",
    pages: [
      {
        page: 1,
        text: "Exercise and FMD in women\nWalking improved FMD in men.1",
      },
    ],
    warnings: [],
    parser: { name: "unpdf", version: "2.2.1" },
  },
  claims: {
    items: [
      {
        id: "claim-001",
        text: "Walking improved FMD in men.1",
        page: 1,
        location: { start: 26, end: 55 },
        section: null,
        context: { before: null, after: null },
        type: "cited_claim",
        extraction: { method: "rule-based", version: "1", signals: [] },
      },
    ],
    method: "rule-based",
    version: "1",
    truncated: false,
    verificationStatus: "not_verified",
  },
  citations: {
    referenceList: { found: true, page: 2, style: "numbered" },
    references: [
      {
        id: "ref-1",
        number: 1,
        text: "Pierce GL et al. Clin Sci 2011;120:13-23.",
        page: 2,
        pageEnd: 2,
        location: null,
        metadata: { authors: ["Pierce"], year: "2011", title: null, doi: null },
      },
    ],
    inText: [
      {
        id: "cit-1",
        marker: "1",
        style: "superscript",
        page: 1,
        location: { start: 54, end: 55 },
        claimId: "claim-001",
        matches: [
          {
            key: "1",
            status: "matched",
            referenceIds: ["ref-1"],
            reason: null,
          },
        ],
      },
    ],
    method: "rule-based",
    version: "1",
    truncated: false,
    evidenceStatus: "not_verified",
  },
  internalConsistency: {
    results: [],
    scope: "original_findings",
    method: "rule-based",
    version: "1",
    disclaimer: "Checks compare the paper with itself only.",
  },
};

const passage = "FMD increased >50% in the men (P<0.01).";
const withEvidence: ExtractEvidenceResponse = {
  ...paper,
  evidence: {
    sources: [
      {
        referenceId: "ref-1",
        claimIds: ["claim-001"],
        resolution: {
          status: "resolved",
          reason: null,
          matchedBy: "pmid",
          resolver: "pubmed",
          candidates: [],
        },
        work: {
          title: "Sex-specific effects of habitual aerobic exercise",
          authors: ["Pierce GL"],
          year: "2011",
          doi: "10.1042/cs20100174",
          journal: null,
          pmid: "1",
          pmcid: null,
          openAlexId: null,
        },
        access: "abstract_only",
        accessReason: null,
        license: null,
        urls: {
          doi: "https://doi.org/10.1042/cs20100174",
          landingPage: null,
          fullText: null,
        },
        passages: [
          {
            claimId: "claim-001",
            text: passage,
            markupRemoved: false,
            origin: "abstract",
            location: { section: null, paragraph: 1, sentence: 1 },
            sourceUrl: "https://doi.org/10.1042/cs20100174",
            relevance: { method: "term-overlap", sharedTerms: [], score: 1 },
          },
        ],
        errors: [],
      },
    ],
    services: ["pubmed"],
    retrievedAt: "2026-11-19T10:00:00.000Z",
    method: "metadata-resolution+term-overlap",
    version: "1",
    truncated: false,
    claimStatus: "not_verified",
  },
};

const text = (lines: { text: string }[]) => lines.map((l) => l.text).join("\n");
const at = new Date("2026-11-19T12:00:00Z");

describe("paper session persistence", () => {
  const memory = () => {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    };
  };

  test("results survive a round trip, without any PDF bytes", () => {
    const store = memory();
    expect(savePaper(store, withEvidence)).toBe(true);
    expect(loadPaper(store)).toEqual(withEvidence);
    const saved = store.data.get(PAPER_KEY) ?? "";
    expect(saved).not.toContain("%PDF");
    expect(Object.keys(JSON.parse(saved)).sort()).toEqual([
      "citations",
      "claims",
      "document",
      "evidence",
      "extraction",
      "internalConsistency",
    ]);
  });

  test("malformed or missing data is ignored, and reset clears it", () => {
    const store = memory();
    expect(loadPaper(store)).toBeUndefined();
    store.setItem(PAPER_KEY, "{not json");
    expect(loadPaper(store)).toBeUndefined();
    store.setItem(PAPER_KEY, JSON.stringify({ document: { name: "x" } }));
    expect(loadPaper(store)).toBeUndefined();
    savePaper(store, paper);
    clearPaper(store);
    expect(loadPaper(store)).toBeUndefined();
  });

  test("a full or blocked storage does not throw", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(savePaper(blocked, paper)).toBe(false);
    expect(loadPaper(blocked)).toBeUndefined();
    expect(() => clearPaper(blocked)).not.toThrow();
  });
});

describe("PDF report", () => {
  test("uses the uploaded paper and says Not verified when AI did not run", () => {
    const report = text(buildReport(paper, at));
    expect(report).toContain("File name: pierce study.pdf");
    expect(report).toContain(
      "Title (first line of the PDF text): Exercise and FMD in women",
    );
    expect(report).toContain("Pages: 2");
    expect(report).toContain(
      "AI verification not performed. No AI verdicts are reported",
    );
    expect(report).toContain("not a substitute for expert review");
    expect(report).toContain("claim-001 | page 1 | Not verified");
    expect(report).toContain('Citation "1": 1 -> [1]');
    expect(report).toContain("1 matched, 0 unmatched, 0 ambiguous");
    expect(report).toContain("Source retrieval was not run");
    expect(report).toContain("Checks compare the paper with itself only.");
    for (const verdict of ["Supported", "Contradicted", "Partially supported"])
      expect(report).not.toContain(verdict);
  });

  test("includes exact retrieved passages and source links", () => {
    const report = text(buildReport(withEvidence, at));
    expect(report).toContain(`"${passage}"`);
    expect(report).toContain(
      "Retrieval summary: 1 cited sources looked up; 1 identified",
    );
    expect(report).toContain("https://doi.org/10.1042/cs20100174");
    expect(report).toContain(
      "[1] Sex-specific effects of habitual aerobic exercise | resolved | abstract only",
    );
  });

  test("reports only the verdicts the verification step returned", () => {
    const verified: VerifyClaimsResponse = {
      ...withEvidence,
      verification: {
        results: [
          {
            claimId: "claim-001",
            verdict: "Unable to verify",
            decidedBy: "rule",
            unableCause: "model_unavailable",
            reason: "No Ollama server answered.",
            evidence: [],
            evidenceScope: "none",
            explanation: null,
            model: null,
          },
        ],
        model: null,
        modelAvailable: false,
        method: "evidence-grounded-llm",
        version: "1",
        verifiedAt: "2026-11-19T11:00:00.000Z",
        truncated: false,
        ownFindingsExcluded: 0,
        reviewStatus: "requires_human_review",
      },
    };
    const report = text(buildReport(verified, at));
    expect(report).toContain(
      "claim-001 | page 1 | AI verdict: Unable to verify",
    );
    expect(report).toContain("Reason: No Ollama server answered.");
    expect(report).toContain("Results: Unable to verify 1.");
    expect(report).not.toContain("Supported");
  });

  test("writes a valid PDF whose cross-reference offsets point at each object", () => {
    const bytes = renderPdf(buildReport(withEvidence, at));
    const pdf = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
    const startxref = Number(/startxref\n(\d+)/.exec(pdf)?.[1]);
    expect(pdf.slice(startxref, startxref + 4)).toBe("xref");
    const offsets = [
      ...pdf.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm),
    ].map((m) => Number(m[1]));
    offsets.forEach((offset, i) => {
      expect(pdf.slice(offset, offset + `${i + 1} 0 obj`.length)).toBe(
        `${i + 1} 0 obj`,
      );
    });
    expect(pdf).toContain("(AI verification not performed.");
    expect(pdf).toContain("P<0.01");
  });

  test("long reports flow onto numbered pages", () => {
    const long = {
      ...paper,
      internalConsistency: {
        ...paper.internalConsistency,
        disclaimer: "word ".repeat(4000),
      },
    };
    const pdf = Array.from(renderPdf(buildReport(long, at)), (b) =>
      String.fromCharCode(b),
    ).join("");
    const pages = Number(/\/Count (\d+)/.exec(pdf)?.[1]);
    expect(pages).toBeGreaterThan(1);
    expect(pdf).toContain(`page ${pages} of ${pages}`);
  });

  test("text is encoded safely for the PDF", () => {
    expect(toWinAnsi("p ≤ 0.05 – (n=5) μm ± 1 漢")).toBe(
      "p <= 0.05 \x96 (n=5) \xb5m \xb1 1 ?",
    );
    expect(reportFileName("My Paper (final).PDF")).toBe(
      "My-Paper-final-citeverify-report.pdf",
    );
  });
});

describe("paper quality figures come only from the paper's results", () => {
  test("steps not run are null, not zero", () => {
    const q = paperQuality(paper);
    expect(q.claims).toEqual({ total: 1, cited: 1, ownFindings: 0 });
    expect(q.citations).toMatchObject({
      markers: 1,
      matched: 1,
      unmatched: 0,
      references: 1,
    });
    expect(q.sources).toBeNull();
    expect(q.verification).toBeNull();
  });

  test("retrieval coverage counts identified and accessible sources", () => {
    expect(paperQuality(withEvidence).sources).toEqual({
      lookedUp: 1,
      identified: 1,
      fullText: 0,
      abstractOnly: 1,
      metadataOnly: 0,
      unavailable: 0,
      withErrors: 0,
      rateLimited: 0,
      claimsWithEvidence: 1,
    });
  });

  test("verdict counts and abstention causes match the returned results", () => {
    const verified = {
      ...withEvidence,
      verification: {
        results: [
          {
            claimId: "claim-001",
            verdict: "Unable to verify",
            decidedBy: "rule",
            unableCause: "no_evidence",
            reason: "x",
            evidence: [],
            evidenceScope: "none",
            explanation: null,
            model: null,
          },
        ],
        model: {
          provider: "groq",
          name: "openai/gpt-oss-120b",
          promptVersion: "verify-v6",
        },
        modelAvailable: true,
        method: "evidence-grounded-llm",
        version: "1",
        verifiedAt: "2026-11-20T00:00:00Z",
        truncated: false,
        ownFindingsExcluded: 0,
        reviewStatus: "requires_human_review",
      },
    } as VerifyClaimsResponse;
    expect(paperQuality(verified).verification).toEqual({
      judged: 1,
      byVerdict: [{ verdict: "Unable to verify", count: 1 }],
      unable: 1,
      unableCauses: [{ cause: "no_evidence", count: 1 }],
      provider: "groq",
      model: "openai/gpt-oss-120b",
      truncated: false,
    });
  });

  test("an unmatched citation is listed, and shares never divide by zero", () => {
    const broken = structuredClone(paper);
    const first = broken.citations.inText[0];
    if (first)
      first.matches = [
        {
          key: "9",
          status: "unmatched",
          referenceIds: [],
          reason: "no entry 9",
        },
      ];
    expect(paperQuality(broken).citations).toMatchObject({
      matched: 0,
      unmatched: 1,
      unmatchedMarkers: ["1"],
    });
    expect(share(0, 0)).toBe("none");
    expect(share(3, 21)).toBe("3 of 21 (14%)");
  });
});
