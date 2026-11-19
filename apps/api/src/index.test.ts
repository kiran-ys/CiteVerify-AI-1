import { describe, expect, test } from "bun:test";
import type {
  ApiErrorResponse,
  ExtractCitationsResponse,
  ExtractClaimsResponse,
  ExtractEvidenceResponse,
  ExtractDocumentResponse,
} from "@citeverify/shared";
import {
  createEmptyPdf,
  createMultiPagePdf,
  createTextPdf,
} from "../../../test/pdf-fixture.ts";
import {
  app,
  configureEvidenceRetrieval,
  statusForParserError,
} from "./index.ts";

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

const CITATIONS_PATH = "/api/documents/citations";

describe("POST /api/documents/citations", () => {
  const pages = [
    [
      "Example Journal of Medicine 2025",
      "Abstract",
      "We found that drug A reduced mortality by 20% (p < 0.01) [1].",
      "1. Introduction",
      "Hypertension affects one billion adults worldwide [2, 3].",
      "Earlier trials disagree on optimal dosing [4-5].",
    ],
    [
      "Example Journal of Medicine 2025",
      "3. Results",
      "Our results show that systolic pressure decreased by 8 mmHg [9].",
      "References",
      "[1] Kumar A, Lee B. Early treatment of hypertension. N Engl J Med. 2019;380:1-10. doi:10.1056/NEJMoa1234567",
      "[2] Smith J, Brown K. Global burden of hypertension. Lancet. 2020;395:795-808.",
      "[3] Lee K, Park S. Hypertension prevalence in Asia. Hypertens Res. 2018;41:1-9.",
    ],
    [
      "Example Journal of Medicine 2025",
      "[4] Wong T, Chan M. Early antihypertensive therapy. BMJ. 2017;356:j10.",
      "[5] Garcia R. Long-term outcomes of early therapy. JAMA. 2016;315:200-210.",
    ],
  ];

  async function post(): Promise<ExtractCitationsResponse> {
    const response = await app.request(
      uploadRequest(pdfFile(createMultiPagePdf(pages)), CITATIONS_PATH),
    );
    expect(response.status).toBe(200);
    return (await response.json()) as ExtractCitationsResponse;
  }

  test("returns extraction, claims, references, and matched citations from a real PDF", async () => {
    const body = await post();

    expect(body.document.pageCount).toBe(3);
    expect(body.claims.items.length).toBeGreaterThan(0);
    expect(body.citations).toMatchObject({
      method: "rule-based",
      evidenceStatus: "not_verified",
      referenceList: { found: true, page: 2, style: "numbered" },
    });
    expect(
      body.citations.references.map((reference) => [
        reference.number,
        reference.page,
      ]),
    ).toEqual([
      [1, 2],
      [2, 2],
      [3, 2],
      [4, 3],
      [5, 3],
    ]);
    expect(body.citations.references[0]?.metadata).toEqual({
      authors: ["Kumar A", "Lee B"],
      year: "2019",
      title: "Early treatment of hypertension",
      doi: "10.1056/NEJMoa1234567",
    });
    expect(
      body.citations.inText.map((citation) => [
        citation.marker,
        citation.page,
        citation.matches.map((match) => `${match.key}:${match.status}`),
      ]),
    ).toEqual([
      ["[1]", 1, ["1:matched"]],
      ["[2, 3]", 1, ["2:matched", "3:matched"]],
      ["[4-5]", 1, ["4:matched", "5:matched"]],
      ["[9]", 2, ["9:unmatched"]],
    ]);
  });

  test("links each citation to the extracted claim that contains it", async () => {
    const body = await post();
    const claimText = new Map(
      body.claims.items.map((claim) => [claim.id, claim.text]),
    );

    for (const citation of body.citations.inText) {
      expect(citation.claimId).not.toBeNull();
      expect(claimText.get(citation.claimId ?? "")).toContain(citation.marker);
    }
  });

  test("citation and reference offsets point into the returned page text", async () => {
    const body = await post();
    for (const citation of body.citations.inText) {
      const pageText = body.extraction.pages[citation.page - 1]?.text ?? "";
      expect(
        pageText.slice(citation.location.start, citation.location.end),
      ).toBe(citation.marker);
    }
    for (const reference of body.citations.references) {
      const pageText = body.extraction.pages[reference.page - 1]?.text ?? "";
      expect(
        pageText
          .slice(reference.location?.start, reference.location?.end)
          .replace(/\s+/g, " "),
      ).toBe(reference.text);
    }
  });

  test("never returns verdicts or support labels", async () => {
    const response = await app.request(
      uploadRequest(pdfFile(createMultiPagePdf(pages)), CITATIONS_PATH),
    );
    const text = await response.text();
    expect(text).not.toMatch(
      /"(verdict|confidence|score|supported|contradicted)"/i,
    );
  });

  test("reports a missing reference list instead of guessing", async () => {
    const response = await app.request(
      uploadRequest(
        pdfFile(
          createTextPdf(
            "Drug A lowered blood pressure significantly in adults [1].",
          ),
        ),
        CITATIONS_PATH,
      ),
    );
    const body = (await response.json()) as ExtractCitationsResponse;

    expect(response.status).toBe(200);
    expect(body.citations.referenceList.found).toBe(false);
    expect(body.citations.inText[0]?.matches[0]?.status).toBe("unmatched");
  });

  test("reuses upload validation and extraction errors", async () => {
    expect(
      (await app.request(uploadRequest(undefined, CITATIONS_PATH))).status,
    ).toBe(400);
    const empty = await app.request(
      uploadRequest(pdfFile(createEmptyPdf()), CITATIONS_PATH),
    );
    expect(empty.status).toBe(422);
  });
});

const EVIDENCE_PATH = "/api/documents/evidence";
const fixtures = "../../../packages/evidence-retrieval/src/fixtures";
const readFixture = (name: string) =>
  Bun.file(new URL(`${fixtures}/${name}`, import.meta.url)).text();

describe("POST /api/documents/evidence", async () => {
  const crossref = await readFixture("crossref-ioannidis-2005.json");
  const europePmc = await readFixture("europepmc-ioannidis-2005.json");
  const fullText = await readFixture("europepmc-fulltext-PMC1182327.xml");

  const pages = [
    [
      "Abstract",
      "We found that most published research findings are false in fields with small studies [1].",
      "1. Introduction",
      "Small sample sizes reduce the reliability of reported findings [2].",
    ],
    [
      "References",
      "[1] Ioannidis JPA. Why most published research findings are false. PLoS Med. 2005;2(8):e124. doi:10.1371/journal.pmed.0020124",
      "[2] Nobody A. An invented reference that no service knows about. J Nowhere. 2001;1:1-2.",
    ],
  ];

  function mock(routes: [RegExp, () => Response][]) {
    const calls: string[] = [];
    configureEvidenceRetrieval({
      cache: new Map(),
      sleep: async () => {},
      maxRetries: 0,
      fetch: async (input: string) => {
        calls.push(input);
        const route = routes.find(([pattern]) =>
          pattern.test(decodeURIComponent(input)),
        );
        return route ? route[1]() : new Response("not mocked", { status: 404 });
      },
    });
    return calls;
  }

  const empty = {
    crossrefSearch: JSON.stringify({ status: "ok", message: { items: [] } }),
    openAlexSearch: JSON.stringify({ results: [] }),
  };

  async function post(): Promise<ExtractEvidenceResponse> {
    const response = await app.request(
      uploadRequest(pdfFile(createMultiPagePdf(pages)), EVIDENCE_PATH),
    );
    expect(response.status).toBe(200);
    return (await response.json()) as ExtractEvidenceResponse;
  }

  test("retrieves a genuine source with full-text passages and reports an unresolvable one", async () => {
    mock([
      [/api\.crossref\.org\/works\/10\.1371/, () => new Response(crossref)],
      [/rest\/search\?query=DOI:"10\.1371/, () => new Response(europePmc)],
      [/PMC1182327\/fullTextXML/, () => new Response(fullText)],
      [
        /api\.crossref\.org\/works\?query/,
        () => new Response(empty.crossrefSearch),
      ],
      [/api\.openalex\.org/, () => new Response(empty.openAlexSearch)],
    ]);
    const body = await post();

    expect(body.evidence).toMatchObject({
      claimStatus: "not_verified",
      truncated: false,
    });
    const [ioannidis, invented] = body.evidence.sources;
    expect(ioannidis).toMatchObject({
      referenceId: "ref-001",
      access: "full_text",
      resolution: { status: "resolved", matchedBy: "doi" },
      work: {
        title: "Why Most Published Research Findings Are False",
        pmcid: "PMC1182327",
      },
    });
    expect(ioannidis?.claimIds).toEqual([body.claims.items[0]?.id ?? ""]);
    expect(ioannidis?.passages.length).toBeGreaterThan(0);
    expect(invented).toMatchObject({
      referenceId: "ref-002",
      access: "unavailable",
      work: null,
      passages: [],
      resolution: { status: "unresolved" },
    });
  });

  test("still answers 200 with per-source errors when every service is down", async () => {
    mock([[/./, () => new Response("unavailable", { status: 503 })]]);
    const body = await post();

    expect(body.citations.inText.length).toBeGreaterThan(0);
    for (const source of body.evidence.sources) {
      expect(source.access).toBe("unavailable");
      expect(source.resolution.status).toBe("error");
      expect(source.errors.length).toBeGreaterThan(0);
    }
  });

  test("makes no outbound requests when no claim cites a matched reference", async () => {
    const calls = mock([]);
    const response = await app.request(
      uploadRequest(
        pdfFile(
          createTextPdf(
            "We found that drug A lowered blood pressure (p < 0.01).",
          ),
        ),
        EVIDENCE_PATH,
      ),
    );
    const body = (await response.json()) as ExtractEvidenceResponse;

    expect(response.status).toBe(200);
    expect(body.evidence.sources).toEqual([]);
    expect(calls).toEqual([]);
  });

  test("never returns verdicts or support labels", async () => {
    mock([
      [/api\.crossref\.org\/works\/10\.1371/, () => new Response(crossref)],
      [/rest\/search\?query=DOI:"10\.1371/, () => new Response(europePmc)],
      [/PMC1182327\/fullTextXML/, () => new Response(fullText)],
    ]);
    const text = await (
      await app.request(
        uploadRequest(pdfFile(createMultiPagePdf(pages)), EVIDENCE_PATH),
      )
    ).text();
    expect(text).not.toMatch(/"(verdict|confidence|supported|contradicted)"/i);
  });

  test("reuses upload validation", async () => {
    expect(
      (await app.request(uploadRequest(undefined, EVIDENCE_PATH))).status,
    ).toBe(400);
  });
});
