// biome-ignore-all lint/style/noNonNullAssertion: test fixtures index known array elements.
/** Shared realistic fixtures for web unit tests. */
import type {
  ExtractCitationsResponse,
  ExtractEvidenceResponse,
  VerifyClaimsResponse,
} from "@citeverify/shared";

export const paper: ExtractCitationsResponse = {
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

export const passage = "FMD increased >50% in the men (P<0.01).";
export const withEvidence: ExtractEvidenceResponse = {
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

export const verified: VerifyClaimsResponse = {
  ...withEvidence,
  verification: {
    results: [
      {
        claimId: "claim-001",
        verdict: "Partially supported",
        decidedBy: "model",
        unableCause: null,
        reason: "Claim parts: finding supported (E1).",
        evidence: [
          {
            ...withEvidence.evidence.sources[0]!.passages[0]!,
            evidenceId: "E1",
            referenceId: "ref-1",
            relation: "supports",
            sourceTitle: "Sex-specific effects of habitual aerobic exercise",
            doi: "10.1042/cs20100174",
          },
        ],
        evidenceScope: "abstract_only",
        explanation: "Men improved; women did not.",
        model: {
          provider: "groq",
          name: "openai/gpt-oss-120b",
          promptVersion: "verify-v5",
        },
      },
    ],
    model: {
      provider: "groq",
      name: "openai/gpt-oss-120b",
      promptVersion: "verify-v5",
    },
    modelAvailable: true,
    method: "evidence-grounded-llm",
    version: "1",
    verifiedAt: "2026-11-20T10:00:00.000Z",
    truncated: false,
    ownFindingsExcluded: 0,
    reviewStatus: "requires_human_review",
  },
};
