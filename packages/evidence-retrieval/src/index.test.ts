import { describe, expect, test } from "bun:test";
import type {
  ExtractedClaim,
  InTextCitation,
  ReferenceEntry,
} from "@citeverify/shared";
import {
  abstractParagraphs,
  checkIdentity,
  citedReferences,
  jatsBodyParagraphs,
  rankPassages,
  type RetrievalOptions,
  retrieveEvidence,
} from "./index.ts";
import { stripMarkup } from "./text.ts";

// Fixtures are trimmed copies of real responses from Crossref, OpenAlex, and Europe PMC.
const fixture = (name: string) =>
  Bun.file(new URL(`./fixtures/${name}`, import.meta.url)).text();
const crossrefIoannidis = await fixture("crossref-ioannidis-2005.json");
const crossrefLim = await fixture("crossref-lim-2010.json");
const crossrefSearchVaswani = await fixture("crossref-search-vaswani.json");
const openAlexSearchVaswani = await fixture("openalex-search-vaswani.json");
const europePmcIoannidis = await fixture("europepmc-ioannidis-2005.json");
const europePmcLim = await fixture("europepmc-lim-2010.json");
const fullTextIoannidis = await fixture("europepmc-fulltext-PMC1182327.xml");
const emptyEuropePmc = JSON.stringify({
  hitCount: 0,
  resultList: { result: [] },
});
const emptyCrossrefSearch = JSON.stringify({
  status: "ok",
  message: { items: [] },
});
const emptyOpenAlexSearch = JSON.stringify({ results: [] });

type Route = [RegExp, () => Response | Promise<Response>];

function mockFetch(routes: Route[]) {
  const calls: string[] = [];
  const fetch = async (input: string) => {
    calls.push(input);
    const route = routes.find(([pattern]) =>
      pattern.test(decodeURIComponent(input)),
    );
    if (!route) return new Response("not mocked", { status: 404 });
    return route[1]();
  };
  return { fetch, calls };
}

const ok = (body: string) => () => new Response(body, { status: 200 });

function options(
  fetch: RetrievalOptions["fetch"],
  extra: RetrievalOptions = {},
): RetrievalOptions {
  return {
    fetch,
    cache: new Map(),
    sleep: async () => {},
    timeoutMs: 1_000,
    now: () => new Date("2026-11-19T12:00:00Z"),
    ...extra,
  };
}

function reference(
  id: string,
  text: string,
  metadata: Partial<ReferenceEntry["metadata"]>,
): ReferenceEntry {
  return {
    id,
    number: Number(id.slice(-3)),
    text,
    page: 9,
    pageEnd: 9,
    location: null,
    metadata: { authors: [], year: null, title: null, doi: null, ...metadata },
  };
}

function claim(id: string, text: string): ExtractedClaim {
  return {
    id,
    text,
    page: 1,
    location: { start: 0, end: text.length },
    section: "Introduction",
    context: { before: null, after: null },
    type: "cited_claim",
    extraction: {
      method: "rule-based",
      version: "1.0.0",
      signals: ["citation marker"],
    },
  };
}

function citation(
  id: string,
  claimId: string | null,
  referenceId: string,
  status: "matched" | "unmatched" | "ambiguous" = "matched",
): InTextCitation {
  return {
    id,
    marker: "[1]",
    style: "numeric",
    page: 1,
    location: { start: 0, end: 3 },
    claimId,
    matches: [
      {
        key: "1",
        status,
        referenceIds: status === "unmatched" ? [] : [referenceId],
        reason: null,
      },
    ],
  };
}

const ioannidisRef = reference(
  "ref-001",
  "[1] Ioannidis JPA. Why most published research findings are false. PLoS Med. 2005;2(8):e124. doi:10.1371/journal.pmed.0020124",
  {
    authors: ["Ioannidis JPA"],
    year: "2005",
    title: "Why most published research findings are false",
    doi: "10.1371/journal.pmed.0020124",
  },
);
const limRef = reference(
  "ref-002",
  "[2] Lim J, Dinges DF. A meta-analysis of the impact of short-term sleep deprivation on cognitive variables. Psychol Bull. 2010;136(3):375-389. doi:10.1037/a0018883",
  {
    authors: ["Lim J", "Dinges DF"],
    year: "2010",
    title:
      "A meta-analysis of the impact of short-term sleep deprivation on cognitive variables",
    doi: "10.1037/a0018883",
  },
);
const vaswaniRef = reference(
  "ref-003",
  '[3] A. Vaswani, N. Shazeer, N. Parmar, et al., "Attention is all you need," in Advances in Neural Information Processing Systems, 2017.',
  {
    authors: ["A. Vaswani", "N. Shazeer", "N. Parmar"],
    year: "2017",
    title: "Attention is all you need",
  },
);

const ioannidisRoutes: Route[] = [
  [
    /api\.crossref\.org\/works\/10\.1371\/journal\.pmed\.0020124/,
    ok(crossrefIoannidis),
  ],
  [
    /europepmc\/webservices\/rest\/search\?query=DOI:"10\.1371\/journal\.pmed\.0020124"/,
    ok(europePmcIoannidis),
  ],
  [/rest\/PMC1182327\/fullTextXML/, ok(fullTextIoannidis)],
];

describe("full-text evidence (Ioannidis 2005, open access)", async () => {
  const claimText =
    "Most published research findings are false because of small studies, small effect sizes, and bias [1].";
  const { fetch, calls } = mockFetch(ioannidisRoutes);
  const result = await retrieveEvidence(
    {
      references: [ioannidisRef],
      claims: [claim("claim-001", claimText)],
      citations: [citation("cit-001", "claim-001", "ref-001")],
    },
    options(fetch),
  );
  const source = result.sources[0];

  test("resolves the DOI through Crossref and confirms the identity", () => {
    expect(source?.resolution).toEqual({
      status: "resolved",
      reason: null,
      matchedBy: "doi",
      resolver: "crossref",
      candidates: [],
    });
    expect(source?.work).toMatchObject({
      title: "Why Most Published Research Findings Are False",
      authors: ["John P. A. Ioannidis"],
      year: "2005",
      doi: "10.1371/journal.pmed.0020124",
      journal: "PLoS Medicine",
      pmid: "16060722",
      pmcid: "PMC1182327",
    });
  });

  test("labels it full text with real URLs and licence", () => {
    expect(source?.access).toBe("full_text");
    expect(source?.accessReason).toBeNull();
    expect(source?.license).toBe("cc by");
    expect(source?.urls).toEqual({
      doi: "https://doi.org/10.1371/journal.pmed.0020124",
      landingPage: "https://doi.org/10.1371/journal.pmed.0020124",
      fullText: "https://europepmc.org/article/PMC/PMC1182327",
    });
  });

  test("returns passages that are exact sentences from the source", () => {
    expect(source?.passages.length).toBeGreaterThan(0);
    const sourceText = [
      stripMarkup(fullTextIoannidis).text,
      ...abstractParagraphs(
        JSON.parse(europePmcIoannidis).resultList.result[0].abstractText,
      ).map((p) => p.text),
    ].join(" ");
    for (const passage of source?.passages ?? []) {
      expect(sourceText).toContain(passage.text);
      expect(passage.claimId).toBe("claim-001");
      expect(passage.relevance.method).toBe("term-overlap");
      expect(passage.relevance.sharedTerms.length).toBeGreaterThanOrEqual(2);
      expect(passage.location.paragraph).toBeGreaterThan(0);
      expect(passage.location.sentence).toBeGreaterThan(0);
    }
  });

  test("labels the result as not verified and contains no verdicts", () => {
    expect(result.claimStatus).toBe("not_verified");
    expect(JSON.stringify(result)).not.toMatch(
      /"(verdict|supported|contradicted|confidence)"/i,
    );
  });

  test("only calls the three free scholarly services", () => {
    for (const url of calls) {
      expect(url).toMatch(
        /^https:\/\/(api\.crossref\.org|api\.openalex\.org|www\.ebi\.ac\.uk)\//,
      );
    }
  });
});

describe("abstract-only evidence (Lim and Dinges 2010, not open access)", async () => {
  const { fetch, calls } = mockFetch([
    [/api\.crossref\.org\/works\/10\.1037\/a0018883/, ok(crossrefLim)],
    [/rest\/search\?query=DOI:"10\.1037\/a0018883"/, ok(europePmcLim)],
  ]);
  const result = await retrieveEvidence(
    {
      references: [limRef],
      claims: [
        claim(
          "claim-002",
          "Short-term total sleep deprivation impairs cognitive domains such as attention [2].",
        ),
      ],
      citations: [citation("cit-002", "claim-002", "ref-002")],
    },
    options(fetch),
  );
  const source = result.sources[0];

  test("does not fetch full text for a work outside the open-access subset", () => {
    expect(calls.some((url) => url.includes("fullTextXML"))).toBe(false);
    expect(source?.access).toBe("abstract_only");
    expect(source?.accessReason).toBe(
      "The work is not in the Europe PMC open-access subset; only its abstract is available.",
    );
    expect(source?.urls.fullText).toBeNull();
  });

  test("quotes the abstract with a Europe PMC source URL", () => {
    expect(source?.passages[0]).toMatchObject({
      origin: "abstract",
      sourceUrl: "https://europepmc.org/article/MED/20438143",
      location: { section: null, paragraph: 1, sentence: 1 },
    });
    expect(source?.passages[0]?.text).toStartWith(
      "A substantial amount of research has been conducted",
    );
  });
});

describe("metadata-only result via OpenAlex (Vaswani et al. 2017)", async () => {
  const { fetch, calls } = mockFetch([
    [
      /api\.crossref\.org\/works\?query\.bibliographic=/,
      ok(crossrefSearchVaswani),
    ],
    [/api\.openalex\.org\/works\?search=/, ok(openAlexSearchVaswani)],
    [
      /rest\/search\?query=DOI:"10\.48550\/arxiv\.1706\.03762"/,
      ok(emptyEuropePmc),
    ],
  ]);
  const result = await retrieveEvidence(
    {
      references: [vaswaniRef],
      claims: [
        claim(
          "claim-003",
          "Transformers rely entirely on attention mechanisms [3].",
        ),
      ],
      citations: [citation("cit-003", "claim-003", "ref-003")],
    },
    options(fetch),
  );
  const source = result.sources[0];

  test("rejects later re-deposits with the same title and resolves the 2017 record", () => {
    expect(source?.resolution).toMatchObject({
      status: "resolved",
      matchedBy: "bibliographic-search",
      resolver: "openalex",
    });
    expect(source?.work).toMatchObject({
      title: "Attention Is All You Need",
      year: "2017",
      doi: "10.48550/arxiv.1706.03762",
    });
    expect(
      calls.filter((url) => url.includes("api.openalex.org")),
    ).toHaveLength(1);
  });

  test("reports metadata only when Europe PMC has no record", () => {
    expect(source?.access).toBe("metadata_only");
    expect(source?.accessReason).toBe(
      "The work was not found in Europe PMC, and Crossref supplied no abstract.",
    );
    expect(source?.passages).toEqual([]);
  });
});

describe("resolution safeguards", () => {
  test("a DOI that belongs to a different work is not trusted", async () => {
    const wrong = reference(
      "ref-004",
      "[4] Smith J. Coffee and attention in shift workers. Sleep. 2019;42:1-9. doi:10.1371/journal.pmed.0020124",
      {
        authors: ["Smith J"],
        year: "2019",
        title: "Coffee and attention in shift workers",
        doi: "10.1371/journal.pmed.0020124",
      },
    );
    const { fetch } = mockFetch([
      [/api\.crossref\.org\/works\/10\.1371/, ok(crossrefIoannidis)],
      [/api\.crossref\.org\/works\?query/, ok(emptyCrossrefSearch)],
      [/api\.openalex\.org/, ok(emptyOpenAlexSearch)],
    ]);
    const result = await retrieveEvidence(
      {
        references: [wrong],
        claims: [claim("claim-004", "Coffee improves attention [4].")],
        citations: [citation("c", "claim-004", "ref-004")],
      },
      options(fetch),
    );
    expect(result.sources[0]).toMatchObject({
      access: "unavailable",
      work: null,
      passages: [],
    });
    expect(result.sources[0]?.resolution.status).toBe("unresolved");
    expect(result.sources[0]?.resolution.reason).toContain(
      "The DOI 10.1371/journal.pmed.0020124 in the reference belongs to a different work",
    );
  });

  test("an unregistered DOI falls back to bibliographic search and says so", async () => {
    const typo = {
      ...ioannidisRef,
      metadata: {
        ...ioannidisRef.metadata,
        doi: "10.1371/journal.pmed.9999999",
      },
    };
    const crossrefSearch = JSON.stringify({
      status: "ok",
      message: { items: [JSON.parse(crossrefIoannidis).message] },
    });
    const { fetch } = mockFetch([
      [
        /api\.crossref\.org\/works\/10\.1371\/journal\.pmed\.9999999/,
        () => new Response("Resource not found.", { status: 404 }),
      ],
      [/api\.crossref\.org\/works\?query/, ok(crossrefSearch)],
      ...ioannidisRoutes,
    ]);
    const result = await retrieveEvidence(
      {
        references: [typo],
        claims: [claim("claim-001", "x [1].")],
        citations: [citation("c", "claim-001", "ref-001")],
      },
      options(fetch),
    );
    expect(result.sources[0]?.resolution).toMatchObject({
      status: "resolved",
      matchedBy: "bibliographic-search",
      reason:
        "The DOI 10.1371/journal.pmed.9999999 in the reference is not registered with Crossref. Resolved by bibliographic search instead.",
    });
  });

  test("several matching records are reported as ambiguous, and none is chosen", async () => {
    const item = JSON.parse(crossrefIoannidis).message;
    const twin = { ...item, DOI: "10.1371/journal.pmed.0020124.reprint" };
    const { fetch, calls } = mockFetch([
      [
        /api\.crossref\.org\/works\?query/,
        ok(JSON.stringify({ status: "ok", message: { items: [item, twin] } })),
      ],
    ]);
    const noDoi = {
      ...ioannidisRef,
      metadata: { ...ioannidisRef.metadata, doi: null },
      text: "[1] Ioannidis JPA. Why most published research findings are false. PLoS Med. 2005;2(8):e124.",
    };
    const result = await retrieveEvidence(
      {
        references: [noDoi],
        claims: [claim("claim-001", "x [1].")],
        citations: [citation("c", "claim-001", "ref-001")],
      },
      options(fetch),
    );
    expect(result.sources[0]?.resolution).toMatchObject({
      status: "ambiguous",
      resolver: "crossref",
      candidates: [
        {
          title: "Why Most Published Research Findings Are False",
          doi: "10.1371/journal.pmed.0020124",
          year: "2005",
        },
        {
          title: "Why Most Published Research Findings Are False",
          doi: "10.1371/journal.pmed.0020124.reprint",
          year: "2005",
        },
      ],
    });
    expect(result.sources[0]?.access).toBe("unavailable");
    expect(calls.some((url) => url.includes("europepmc"))).toBe(false);
  });

  test("checkIdentity requires title, year, and first author to agree", () => {
    const work = {
      title: "Why Most Published Research Findings Are False",
      authors: ["John P. A. Ioannidis"],
      year: "2005",
      doi: null,
      journal: null,
      pmid: null,
      pmcid: null,
      openAlexId: null,
    };
    expect(checkIdentity(ioannidisRef, work)).toEqual({ ok: true });
    expect(checkIdentity(ioannidisRef, { ...work, year: "2012" }).ok).toBe(
      false,
    );
    expect(
      checkIdentity(ioannidisRef, { ...work, authors: ["Jane Doe"] }).ok,
    ).toBe(false);
    expect(
      checkIdentity(ioannidisRef, {
        ...work,
        title: "Why some findings replicate well",
      }).ok,
    ).toBe(false);
  });
});

describe("network failures and rate limits", () => {
  test("retries after HTTP 429, honouring Retry-After", async () => {
    let attempts = 0;
    const waits: number[] = [];
    const { fetch } = mockFetch([
      [
        /api\.crossref\.org\/works\/10\.1371/,
        () => {
          attempts++;
          return attempts === 1
            ? new Response("slow down", {
                status: 429,
                headers: { "Retry-After": "2" },
              })
            : new Response(crossrefIoannidis, { status: 200 });
        },
      ],
      ...ioannidisRoutes.slice(1),
    ]);
    const result = await retrieveEvidence(
      {
        references: [ioannidisRef],
        claims: [claim("claim-001", "x [1].")],
        citations: [citation("c", "claim-001", "ref-001")],
      },
      options(fetch, { sleep: async (ms) => void waits.push(ms) }),
    );
    expect(attempts).toBe(2);
    expect(waits).toEqual([2000]);
    expect(result.sources[0]?.resolution.status).toBe("resolved");
    expect(result.sources[0]?.errors).toEqual([]);
  });

  test("reports rate limiting that does not clear", async () => {
    const { fetch } = mockFetch([
      [/./, () => new Response("slow down", { status: 429 })],
    ]);
    const result = await retrieveEvidence(
      {
        references: [ioannidisRef],
        claims: [claim("claim-001", "x [1].")],
        citations: [citation("c", "claim-001", "ref-001")],
      },
      options(fetch, { maxRetries: 1 }),
    );
    const source = result.sources[0];
    expect(source?.resolution.status).toBe("error");
    expect(source?.access).toBe("unavailable");
    expect(source?.errors.map((error) => [error.service, error.kind])).toEqual([
      ["crossref", "rate_limited"],
      ["crossref", "rate_limited"],
      ["openalex", "rate_limited"],
    ]);
  });

  test("reports network failures per service without failing the whole result", async () => {
    const fetch = async () => {
      throw new TypeError("getaddrinfo ENOTFOUND");
    };
    const result = await retrieveEvidence(
      {
        references: [ioannidisRef, limRef],
        claims: [claim("claim-001", "x [1][2].")],
        citations: [
          citation("a", "claim-001", "ref-001"),
          citation("b", "claim-001", "ref-002"),
        ],
      },
      options(fetch, { maxRetries: 0 }),
    );
    expect(result.sources).toHaveLength(2);
    for (const source of result.sources) {
      expect(source.resolution.status).toBe("error");
      expect(source.errors.every((error) => error.kind === "network")).toBe(
        true,
      );
    }
  });

  test("times out a request that never answers", async () => {
    const fetch = (_input: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
    const result = await retrieveEvidence(
      {
        references: [ioannidisRef],
        claims: [claim("claim-001", "x [1].")],
        citations: [citation("c", "claim-001", "ref-001")],
      },
      options(fetch, { timeoutMs: 20, maxRetries: 0 }),
    );
    expect(result.sources[0]?.errors[0]).toEqual({
      service: "crossref",
      kind: "timeout",
      message: "No response within 20 ms",
    });
  });

  test("stops starting requests once the time budget is spent", async () => {
    const { fetch, calls } = mockFetch(ioannidisRoutes);
    const result = await retrieveEvidence(
      {
        references: [ioannidisRef],
        claims: [claim("claim-001", "x [1].")],
        citations: [citation("c", "claim-001", "ref-001")],
      },
      options(fetch, { deadline: Date.now() - 1 }),
    );
    expect(calls).toEqual([]);
    expect(result.sources[0]?.access).toBe("unavailable");
  });

  test("full-text failure falls back to the abstract and explains why", async () => {
    const { fetch } = mockFetch([
      ioannidisRoutes[0] as Route,
      ioannidisRoutes[1] as Route,
      [/fullTextXML/, () => new Response("server error", { status: 503 })],
      [
        /eutils\.ncbi\.nlm\.nih\.gov/,
        () => new Response("server error", { status: 503 }),
      ],
    ]);
    const result = await retrieveEvidence(
      {
        references: [ioannidisRef],
        claims: [
          claim("claim-001", "Most published research findings are false [1]."),
        ],
        citations: [citation("c", "claim-001", "ref-001")],
      },
      options(fetch, { maxRetries: 0 }),
    );
    expect(result.sources[0]).toMatchObject({
      access: "abstract_only",
      accessReason:
        "The open-access full text could not be retrieved from Europe PMC or PubMed Central.",
      errors: [
        { service: "europepmc", kind: "http", message: "HTTP 503" },
        { service: "ncbi-pmc", kind: "http", message: "HTTP 503" },
      ],
    });
  });
});

describe("which references are retrieved", () => {
  test("only matched citations inside extracted claims, de-duplicated", () => {
    const map = citedReferences({
      references: [],
      claims: [],
      citations: [
        citation("a", "claim-001", "ref-001"),
        citation("b", "claim-002", "ref-001"),
        citation("c", "claim-001", "ref-001"),
        citation("d", null, "ref-002"),
        citation("e", "claim-003", "ref-003", "unmatched"),
        citation("f", "claim-003", "ref-004", "ambiguous"),
      ],
    });
    expect([...map.entries()]).toEqual([
      ["ref-001", ["claim-001", "claim-002"]],
    ]);
  });

  test("marks references beyond the per-request limit as skipped", async () => {
    const { fetch } = mockFetch(ioannidisRoutes);
    const result = await retrieveEvidence(
      {
        references: [ioannidisRef, limRef],
        claims: [claim("claim-001", "x [1][2].")],
        citations: [
          citation("a", "claim-001", "ref-001"),
          citation("b", "claim-001", "ref-002"),
        ],
      },
      options(fetch, { maxSources: 1 }),
    );
    expect(result.truncated).toBe(true);
    expect(result.sources[1]?.resolution).toMatchObject({
      status: "skipped",
      reason: "Only the first 1 cited references are retrieved per request.",
    });
  });
});

describe("source text handling", () => {
  test("reads JATS body paragraphs with section titles and drops figures and tables", () => {
    const paragraphs = jatsBodyParagraphs(
      '<article><body><p>Intro &amp; aims [<xref ref-type="bibr">1</xref>].</p><sec><title>Results</title><p>Rates fell by 10<sup>3</sup>.</p><fig><caption><p>Figure text.</p></caption></fig><sec><title>Subgroup</title><p>Nested <list><list-item><p>item one</p></list-item></list> done.</p></sec></sec></body></article>',
    );
    expect(paragraphs).toEqual([
      {
        section: null,
        paragraph: 1,
        text: "Intro & aims [1].",
        markupRemoved: true,
      },
      {
        section: "Results",
        paragraph: 2,
        text: "Rates fell by 103.",
        markupRemoved: true,
      },
      {
        section: "Subgroup",
        paragraph: 3,
        text: "Nested item one done.",
        markupRemoved: true,
      },
    ]);
  });

  test("splits structured abstracts into labelled paragraphs", () => {
    expect(
      abstractParagraphs(
        "<h4>Background</h4>Sleep matters.<h4>Results</h4>Sleep loss slowed responses.",
      ),
    ).toEqual([
      {
        section: "Background",
        paragraph: 1,
        text: "Sleep matters.",
        markupRemoved: false,
      },
      {
        section: "Results",
        paragraph: 2,
        text: "Sleep loss slowed responses.",
        markupRemoved: false,
      },
    ]);
  });

  test("returns no passage when the source shares too few terms with the claim", () => {
    const passages = rankPassages(
      "claim-001",
      "Coffee improves attention in night-shift nurses.",
      [
        {
          origin: "abstract",
          sourceUrl: "https://europepmc.org/article/MED/1",
          paragraphs: [
            {
              section: null,
              paragraph: 1,
              text: "Wheat yields rose in dry regions.",
              markupRemoved: false,
            },
          ],
        },
      ],
    );
    expect(passages).toEqual([]);
  });
});

describe.if(process.env.RUN_NETWORK_TESTS === "1")(
  "live network: genuine open-access paper",
  () => {
    test("resolves Ioannidis 2005 and retrieves its Europe PMC full text", async () => {
      const result = await retrieveEvidence(
        {
          references: [ioannidisRef],
          claims: [
            claim(
              "claim-001",
              "Most published research findings are false [1].",
            ),
          ],
          citations: [citation("c", "claim-001", "ref-001")],
        },
        { cache: new Map() },
      );
      const source = result.sources[0];
      console.log(
        `[live] access=${source?.access} fullText=${source?.urls.fullText} passages=${source?.passages.length} errors=${JSON.stringify(source?.errors)}`,
      );
      expect(source?.resolution.status).toBe("resolved");
      expect(source?.work?.title).toBe(
        "Why Most Published Research Findings Are False",
      );
      if (
        source?.work?.pmcid === null &&
        source.errors.some((error) => error.service === "europepmc")
      ) {
        // Europe PMC search itself was unreachable: availability is honestly unknown.
        expect(source.access).not.toBe("full_text");
        return;
      }
      expect(source?.work?.pmcid).toBe("PMC1182327");
      expect(source?.access).toBe("full_text");
      expect(source?.passages.length).toBeGreaterThan(0);
    }, 60_000);
  },
);

describe("unreachable Europe PMC", () => {
  test("is reported as unknown availability, not as 'not found'", async () => {
    const { fetch } = mockFetch([
      ioannidisRoutes[0] as Route,
      [/europepmc/, () => new Response("busy", { status: 503 })],
    ]);
    const result = await retrieveEvidence(
      {
        references: [ioannidisRef],
        claims: [claim("claim-001", "x [1].")],
        citations: [citation("c", "claim-001", "ref-001")],
      },
      options(fetch, { maxRetries: 0 }),
    );
    expect(result.sources[0]).toMatchObject({
      access: "metadata_only",
      accessReason:
        "Europe PMC could not be reached, so open-access full text could not be checked, and Crossref supplied no abstract.",
      errors: [{ service: "europepmc", kind: "http", message: "HTTP 503" }],
    });
  });
});

describe("PubMed Central fallback", () => {
  test("uses the NCBI copy of open-access full text when Europe PMC cannot serve it", async () => {
    const { fetch, calls } = mockFetch([
      ioannidisRoutes[0] as Route,
      ioannidisRoutes[1] as Route,
      [/fullTextXML/, () => new Response("timeout", { status: 504 })],
      [
        /eutils\.ncbi\.nlm\.nih\.gov\/entrez\/eutils\/efetch\.fcgi\?db=pmc&id=1182327/,
        ok(fullTextIoannidis),
      ],
    ]);
    const result = await retrieveEvidence(
      {
        references: [ioannidisRef],
        claims: [
          claim("claim-001", "Most published research findings are false [1]."),
        ],
        citations: [citation("c", "claim-001", "ref-001")],
      },
      options(fetch, { maxRetries: 0 }),
    );
    const source = result.sources[0];
    expect(source?.access).toBe("full_text");
    expect(source?.urls.fullText).toBe(
      "https://pmc.ncbi.nlm.nih.gov/articles/PMC1182327/",
    );
    expect(
      source?.passages.some((passage) => passage.origin === "full_text"),
    ).toBe(true);
    expect(source?.errors).toEqual([
      { service: "europepmc", kind: "http", message: "HTTP 504" },
    ]);
    expect(calls.some((url) => url.includes("tool=citeverify"))).toBe(true);
  });

  test("is never called for works outside the open-access subset", async () => {
    const { fetch, calls } = mockFetch([
      [/api\.crossref\.org\/works\/10\.1037\/a0018883/, ok(crossrefLim)],
      [/rest\/search\?query=DOI:"10\.1037\/a0018883"/, ok(europePmcLim)],
    ]);
    await retrieveEvidence(
      {
        references: [limRef],
        claims: [claim("claim-002", "x [2].")],
        citations: [citation("c", "claim-002", "ref-002")],
      },
      options(fetch),
    );
    expect(calls.some((url) => url.includes("ncbi"))).toBe(false);
  });
});

// Cases observed when retrieving the references of Ioannidis (2005) PLoS Med 2(8): e124.
// Reference strings are as extracted from that PDF; service records are genuine Crossref metadata.
describe("real-paper identity cases", () => {
  const ref = (
    number: number,
    text: string,
    title: string,
    year: string,
  ): ReferenceEntry =>
    reference(`ref-${String(number).padStart(3, "0")}`, text, { title, year });
  const work = (title: string, authors: string[], year: string) => ({
    title,
    authors,
    year,
    doi: null,
    journal: null,
    pmid: null,
    pmcid: null,
    openAlexId: null,
  });

  const lawlor = ref(
    2,
    "2. Lawlor DA, Davey Smith G, Kundu D, Bruckdorfer KR, Ebrahim S (2004) Those confounded vitamins: What can we learn from the differences between observational versus randomised trial evidence? Lancet 363: 1724– 1727.",
    "Those confounded vitamins: What can we learn from the differences between observational versus randomised trial evidence?",
    "2004",
  );
  const sterne = ref(
    9,
    "9. Sterne JA, Davey Smith G (2001) Sifting the evidence—What’s wrong with significance tests. BMJ 322: 226–231.",
    "Sifting the evidence—What’s wrong with significance tests",
    "2001",
  );
  const wacholder = ref(
    10,
    "10. Wacholder S, Chanock S, Garcia-Closas M, El ghormli L, Rothman N (2004) Assessing the probability that a positive report is false: An approach for molecular epidemiology studies. J Natl Cancer Inst 96: 434–442.",
    "Assessing the probability that a positive report is false: An approach for molecular epidemiology studies",
    "2004",
  );
  const consort = ref(
    18,
    "18. Moher D, Schulz KF, Altman DG (2001) The CONSORT statement: Revised recommendations for improving the quality of reports of parallel-group randomised trials. Lancet 357: 1191–1194.",
    "The CONSORT statement: Revised recommendations for improving the quality of reports of parallel-group randomised trials",
    "2001",
  );
  const papanikolaou = ref(
    27,
    "27. Papanikolaou GN, Baltogianni MS, Contopoulos-Ioannidis DG, Haidich AB, Giannakakis IA, et al. (2001) Reporting of confl icts of interest in guidelines of preventive and therapeutic interventions. BMC Med Res Methodol 1: 3.",
    "Reporting of confl icts of interest in guidelines of preventive and therapeutic interventions",
    "2001",
  );

  test("rejects a letter whose shorter title appears inside the cited title", () => {
    const letter = work(
      "Observational versus randomised trial evidence",
      ["Debbie A Lawlor"],
      "2004",
    );
    expect(
      checkIdentity(lawlor, letter, { volume: "364", firstPage: "755" }).ok,
    ).toBe(false);
  });

  test("rejects a published reply to the cited article", () => {
    const reply = work(
      "RESPONSE: Re: Assessing the Probability That a Positive Report is False: An Approach for Molecular Epidemiology Studies",
      ["Sholom Wacholder"],
      "2004",
    );
    expect(
      checkIdentity(wacholder, reply, { volume: "96", firstPage: "1722" }).ok,
    ).toBe(false);
  });

  test("rejects a reprint in another journal by its page numbers", () => {
    const reprint = work(
      "Sifting the evidence—what's wrong with significance tests?",
      ["Jonathan A C Sterne"],
      "2001",
    );
    expect(
      checkIdentity(sterne, reprint, { volume: "81", firstPage: "1464" }),
    ).toEqual({
      ok: false,
      reason:
        "The service record starts on page 1464, which the reference does not give.",
    });
    expect(
      checkIdentity(sterne, reprint, { volume: "322", firstPage: "226" }).ok,
    ).toBe(true);
  });

  test("accepts the original record when the reference omits its subtitle", () => {
    const original = work(
      "Sifting the evidence---what's wrong with significance tests? Another comment on the role of statistical methods",
      ["Jonathan A C Sterne"],
      "2001",
    );
    expect(
      checkIdentity(sterne, original, { volume: "322", firstPage: "226" }).ok,
    ).toBe(true);
    // ...but a record title that is only the start of the cited title is still rejected.
    expect(
      checkIdentity(
        sterne,
        work("Sifting the evidence", ["Jonathan A C Sterne"], "2001"),
      ).ok,
    ).toBe(false);
  });

  test("tolerates a ligature split in the extracted reference text", () => {
    const record = work(
      "Reporting of conflicts of interest in guidelines of preventive and therapeutic interventions",
      ["George N Papanikolaou"],
      "2001",
    );
    expect(
      checkIdentity(papanikolaou, record, { volume: "1", firstPage: null }).ok,
    ).toBe(true);
  });

  test("a statement published in two journals resolves to the one the reference cites", async () => {
    const item = (
      doi: string,
      journal: string,
      volume: string,
      page: string,
      title: string,
    ) => ({
      DOI: doi,
      title: [title],
      author: [
        { given: "David", family: "Moher" },
        { given: "Kenneth F", family: "Schulz" },
        { given: "Douglas G", family: "Altman" },
      ],
      issued: { "date-parts": [[2001, 4]] },
      "container-title": [journal],
      volume,
      page,
    });
    const search = JSON.stringify({
      status: "ok",
      message: {
        items: [
          item(
            "10.1016/s0140-6736(00)04337-3",
            "The Lancet",
            "357",
            "1191-1194",
            "The CONSORT statement: revised recommendations for improving the quality of reports of parallel-group randomised trials",
          ),
          item(
            "10.7326/0003-4819-134-8-200104170-00011",
            "Annals of Internal Medicine",
            "134",
            "657-662",
            "The CONSORT Statement: Revised Recommendations for Improving the Quality of Reports of Parallel-Group Randomized Trials",
          ),
        ],
      },
    });
    const { fetch } = mockFetch([
      [/api\.crossref\.org\/works\?query/, ok(search)],
      [/europepmc/, ok(emptyEuropePmc)],
    ]);
    const result = await retrieveEvidence(
      {
        references: [consort],
        claims: [claim("claim-001", "x [18].")],
        citations: [citation("c", "claim-001", "ref-018")],
      },
      options(fetch),
    );
    expect(result.sources[0]?.resolution.status).toBe("resolved");
    expect(result.sources[0]?.work?.doi).toBe("10.1016/s0140-6736(00)04337-3");
  });
});

describe("politeness", () => {
  test("sends one Crossref request at a time without an operator contact, three with one", async () => {
    const { HttpClient } = await import("./index.ts");
    for (const [contactEmail, expected] of [
      [undefined, 1],
      ["ops@example.org", 3],
    ] as const) {
      let inFlight = 0;
      let peak = 0;
      const client = new HttpClient({
        cache: new Map(),
        contactEmail,
        fetch: async () => {
          inFlight++;
          peak = Math.max(peak, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 5));
          inFlight--;
          return new Response("{}");
        },
      });
      await Promise.all(
        [1, 2, 3, 4, 5].map((n) =>
          client.get(`https://api.crossref.org/works/${n}`, "crossref"),
        ),
      );
      expect(peak).toBe(expected);
    }
  });

  test("never lets a request outlive the overall time budget", async () => {
    const { HttpClient } = await import("./index.ts");
    const client = new HttpClient({
      cache: new Map(),
      timeoutMs: 60_000,
      maxRetries: 0,
      deadline: Date.now() + 30,
      fetch: (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    });
    const started = Date.now();
    const result = await client.get(
      "https://api.openalex.org/works/x",
      "openalex",
    );
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(result.ok).toBe(false);
  });
});

describe("licences", () => {
  test("ignores Crossref text-mining licences and keeps the published-version licence", async () => {
    const { crossrefRecord } = await import("./services.ts");
    const base = {
      title: ["Searching for genetic determinants in the new millennium"],
      DOI: "10.1038/35015718",
    };
    expect(
      crossrefRecord({
        ...base,
        license: [
          { URL: "http://www.springer.com/tdm", "content-version": "tdm" },
        ],
      })?.license,
    ).toBeNull();
    expect(
      crossrefRecord({
        ...base,
        license: [
          { URL: "http://www.springer.com/tdm", "content-version": "tdm" },
          {
            URL: "https://creativecommons.org/licenses/by/4.0/",
            "content-version": "vor",
          },
        ],
      })?.license,
    ).toBe("https://creativecommons.org/licenses/by/4.0/");
  });
});
