import { describe, expect, test } from "bun:test";
import type { ExtractedClaim } from "@citeverify/shared";
import {
  extractCitations,
  findCitationsOnPage,
  findReferenceList,
  type PageText,
  parseMetadata,
} from "./index.ts";

const header = "Journal of Test Studies 2025";

const numberedPaper: PageText[] = [
  {
    page: 1,
    text: [
      header,
      "Abstract",
      "We found that drug A reduced mortality by 20% (p < 0.01) [1].",
      "1. Introduction",
      "Hypertension affects one billion adults worldwide [2, 3].",
      "Several trials reported benefits of early treatment [4–7].",
      "Prior work disagrees on optimal dosing [9].",
      "1",
    ].join("\n"),
  },
  {
    page: 2,
    text: [
      header,
      "3. Results",
      "Our results show that systolic pressure decreased by 8 mmHg [1; 12].",
      "References",
      '[1] A. Kumar, B. Lee, "Early treatment of hypertension in adults," N. Engl. J. Med., vol. 380, pp. 1-10, 2019, doi: 10.1056/NEJMoa1234567.',
      "[2] Smith J, Brown K. Global burden of hypertension. Lancet. 2020;395(10226):795-808.",
      "[3] Lee K, Park S. Hypertension prevalence in Asia. Hypertens Res. 2018;41:1-9.",
      "[4] Wong T, Chan M. Early antihypertensive therapy. BMJ. 2017;356:j10.",
      "2",
    ].join("\n"),
  },
  {
    page: 3,
    text: [
      header,
      "[5] Garcia R. Long-term outcomes of early therapy. JAMA. 2016;315:200-210.",
      "[6] Ito H. Treatment timing and stroke. Stroke. 2015;46:1-8.",
      "[7] Muller F, Weber G. Blood pressure targets revisited. Eur Heart J. 2014;35:2000-2010.",
      "[8] Rossi P. Dosing strategies for",
      "antihypertensive drugs. Drugs. 2013;73:1-12.",
      "Appendix A",
      "Supplementary tables are available online.",
      "3",
    ].join("\n"),
  },
];

const authorYearPaper: PageText[] = [
  {
    page: 1,
    text: [
      "Introduction",
      "Sleep loss impairs attention (Lim and Dinges, 2010).",
      "Shift work increases accident risk (Smith et al., 2019; Akerstedt, 2007).",
      "Napping improves vigilance (Brown, 2020).",
      "Brown (2020a) reported a dose response.",
      "Caffeine effects were reviewed by Jones (2015).",
      "In (2020) the hospital policy changed.",
    ].join("\n"),
  },
  {
    page: 2,
    text: [
      "References",
      "Akerstedt, T. (2007). Altered sleep/wake patterns and mental performance. Physiology & Behavior, 90(2), 209-218.",
      "Brown, A. (2020a). Napping and vigilance in nurses. Sleep, 43(1), 1-9.",
      "Brown, A. (2020b). Napping strategies for night work. Sleep Health, 6(2), 100-108.",
      "Lim, J., & Dinges, D. F. (2010). A meta-analysis of the impact of short-term sleep deprivation",
      "on cognitive variables. Psychological Bulletin, 136(3), 375-389. https://doi.org/10.1037/a0018883",
      "Smith, J. A., Lee, K., & Park, S. (2019). Shift work and accidents. Occupational Medicine, 69(4), 250-256.",
    ].join("\n"),
  },
];

function summary(result: ReturnType<typeof extractCitations>) {
  return result.inText.map((citation) => [
    citation.marker,
    citation.page,
    citation.matches.map((match) => [
      match.key,
      match.status,
      match.referenceIds,
    ]),
  ]);
}

describe("reference list extraction", () => {
  const list = findReferenceList(numberedPaper);

  test("finds a numbered list across pages and stops at the next heading", () => {
    expect(list).toMatchObject({ found: true, page: 2, style: "numbered" });
    expect(list.entries.map((entry) => [entry.number, entry.page])).toEqual([
      [1, 2],
      [2, 2],
      [3, 2],
      [4, 2],
      [5, 3],
      [6, 3],
      [7, 3],
      [8, 3],
    ]);
    expect(list.entries.map((entry) => entry.text).join(" ")).not.toContain(
      "Supplementary tables",
    );
  });

  test("joins wrapped entries and keeps exact text with page offsets", () => {
    const rossi = list.entries[7];
    expect(rossi?.text).toBe(
      "[8] Rossi P. Dosing strategies for antihypertensive drugs. Drugs. 2013;73:1-12.",
    );
    for (const entry of list.entries) {
      const page = numberedPaper[entry.page - 1]?.text ?? "";
      expect(entry.location).not.toBeNull();
      expect(
        page
          .slice(entry.location?.start, entry.location?.end)
          .replace(/\s+/g, " "),
      ).toBe(entry.text);
    }
  });

  test("drops running headers and page numbers from entries", () => {
    expect(list.entries.map((entry) => entry.text).join(" ")).not.toContain(
      header,
    );
  });

  test("splits an author-year list into entries", () => {
    const authorYear = findReferenceList(authorYearPaper);
    expect(authorYear).toMatchObject({ found: true, style: "author-year" });
    expect(authorYear.entries.map((entry) => entry.text.slice(0, 18))).toEqual([
      "Akerstedt, T. (200",
      "Brown, A. (2020a).",
      "Brown, A. (2020b).",
      "Lim, J., & Dinges,",
      "Smith, J. A., Lee,",
    ]);
  });

  test("reports a missing reference list explicitly", () => {
    expect(
      findReferenceList([{ page: 1, text: "No bibliography here [1]." }]),
    ).toEqual({
      found: false,
      page: null,
      style: null,
      entries: [],
      span: null,
    });
  });
});

describe("bibliographic metadata", () => {
  test("reads IEEE-style authors, quoted title, year, and DOI", () => {
    expect(
      parseMetadata(
        '[1] A. Kumar, B. Lee, "Early treatment of hypertension in adults," N. Engl. J. Med., vol. 380, pp. 1-10, 2019, doi: 10.1056/NEJMoa1234567.',
      ),
    ).toEqual({
      authors: ["A. Kumar", "B. Lee"],
      year: "2019",
      title: "Early treatment of hypertension in adults",
      doi: "10.1056/NEJMoa1234567",
    });
  });

  test("reads Vancouver-style entries", () => {
    expect(
      parseMetadata(
        "[2] Smith J, Brown K. Global burden of hypertension. Lancet. 2020;395(10226):795-808.",
      ),
    ).toEqual({
      authors: ["Smith J", "Brown K"],
      year: "2020",
      title: "Global burden of hypertension",
      doi: null,
    });
  });

  test("reads APA-style entries including a DOI URL", () => {
    expect(
      parseMetadata(
        "Lim, J., & Dinges, D. F. (2010). A meta-analysis of the impact of short-term sleep deprivation on cognitive variables. Psychological Bulletin, 136(3), 375-389. https://doi.org/10.1037/a0018883",
      ),
    ).toEqual({
      authors: ["Lim, J.", "Dinges, D. F."],
      year: "2010",
      title:
        "A meta-analysis of the impact of short-term sleep deprivation on cognitive variables",
      doi: "10.1037/a0018883",
    });
  });

  test("returns nulls instead of guessing for unstructured text", () => {
    expect(parseMetadata("Personal communication with the study team")).toEqual(
      {
        authors: [],
        year: null,
        title: null,
        doi: null,
      },
    );
  });
});

describe("numbered citations", () => {
  const result = extractCitations(numberedPaper);

  test("matches single, listed, and ranged citations; reports missing numbers", () => {
    const ref = (n: number) => [`ref-00${n}`];
    expect(summary(result)).toEqual([
      ["[1]", 1, [["1", "matched", ref(1)]]],
      [
        "[2, 3]",
        1,
        [
          ["2", "matched", ref(2)],
          ["3", "matched", ref(3)],
        ],
      ],
      [
        "[4–7]",
        1,
        [
          ["4", "matched", ref(4)],
          ["5", "matched", ref(5)],
          ["6", "matched", ref(6)],
          ["7", "matched", ref(7)],
        ],
      ],
      ["[9]", 1, [["9", "unmatched", []]]],
      [
        "[1; 12]",
        2,
        [
          ["1", "matched", ref(1)],
          ["12", "unmatched", []],
        ],
      ],
    ]);
    expect(result.inText[3]?.matches[0]?.reason).toBe(
      "No reference entry is numbered 9.",
    );
  });

  test("never treats the reference list's own [n] labels as citations", () => {
    expect(result.inText.every((citation) => citation.page < 3)).toBe(true);
    expect(result.inText).toHaveLength(5);
  });

  test("keeps exact marker text and page offsets", () => {
    for (const citation of result.inText) {
      const page = numberedPaper[citation.page - 1]?.text ?? "";
      expect(page.slice(citation.location.start, citation.location.end)).toBe(
        citation.marker,
      );
    }
  });

  test("ignores reversed or implausibly wide ranges instead of expanding them", () => {
    const page = {
      page: 1,
      text: "Bad ranges [7–3] and [1-100] and a year [2019].",
    };
    expect(findCitationsOnPage(page)).toEqual([]);
  });

  test("labels results as evidence not yet verified", () => {
    expect(result).toMatchObject({
      method: "rule-based",
      evidenceStatus: "not_verified",
      truncated: false,
      referenceList: { found: true, page: 2, style: "numbered" },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /"(verdict|supported|contradict\w*|confidence)"/i,
    );
  });
});

describe("author-year citations", () => {
  const result = extractCitations(authorYearPaper);

  test("matches parenthetical and narrative citations by surname and year", () => {
    expect(summary(result)).toEqual([
      [
        "(Lim and Dinges, 2010)",
        1,
        [["Lim and Dinges, 2010", "matched", ["ref-004"]]],
      ],
      [
        "(Smith et al., 2019; Akerstedt, 2007)",
        1,
        [
          ["Smith et al., 2019", "matched", ["ref-005"]],
          ["Akerstedt, 2007", "matched", ["ref-001"]],
        ],
      ],
      [
        "(Brown, 2020)",
        1,
        [["Brown, 2020", "ambiguous", ["ref-002", "ref-003"]]],
      ],
      ["Brown (2020a)", 1, [["Brown, 2020a", "matched", ["ref-002"]]]],
      ["Jones (2015)", 1, [["Jones, 2015", "unmatched", []]]],
    ]);
  });

  test("explains ambiguous and unmatched results", () => {
    expect(result.inText[2]?.matches[0]?.reason).toBe(
      "2 reference entries match Brown, 2020; the citation does not identify which one.",
    );
    expect(result.inText[4]?.matches[0]?.reason).toBe(
      "No reference entry has first author Jones and year 2015.",
    );
  });

  test("does not read capitalised non-names before a year as authors", () => {
    expect(result.inText.map((citation) => citation.marker)).not.toContain(
      "In (2020)",
    );
  });

  test("handles several years for one author", () => {
    const [citation] = findCitationsOnPage({
      page: 4,
      text: "As shown (Brown, 2020a, 2020b).",
    });
    expect(citation?.marker).toBe("(Brown, 2020a, 2020b)");
    expect(citation?.items.map((item) => item.key)).toEqual([
      "Brown, 2020a",
      "Brown, 2020b",
    ]);

    const pages = [
      { page: 1, text: "As shown (Brown, 2020a, 2020b)." },
      authorYearPaper[1] as PageText,
    ];
    expect(
      extractCitations(pages).inText[0]?.matches.map((match) => [
        match.status,
        match.referenceIds,
      ]),
    ).toEqual([
      ["matched", ["ref-002"]],
      ["matched", ["ref-003"]],
    ]);
  });
});

describe("edge cases", () => {
  test("numbered citations without any reference list are unmatched with a reason", () => {
    const result = extractCitations([
      { page: 1, text: "Drug A lowers blood pressure [1]." },
    ]);
    expect(result.referenceList).toEqual({
      found: false,
      page: null,
      style: null,
    });
    expect(result.inText[0]?.matches).toEqual([
      {
        key: "1",
        status: "unmatched",
        referenceIds: [],
        reason: "No reference list was found in the extracted text.",
      },
    ]);
  });

  test("numbered citations against an author-year list are unmatched, not guessed", () => {
    const pages = [
      { page: 1, text: "Sleep loss impairs attention [1]." },
      authorYearPaper[1] as PageText,
    ];
    expect(extractCitations(pages).inText[0]?.matches[0]).toMatchObject({
      status: "unmatched",
      reason:
        "The reference list is not numbered, so a numbered citation cannot be matched.",
    });
  });

  test("empty documents produce empty results", () => {
    expect(extractCitations([])).toMatchObject({
      referenceList: { found: false },
      references: [],
      inText: [],
    });
  });

  test("links citations to the claim whose text contains them", () => {
    const pageText = numberedPaper[0]?.text ?? "";
    const sentence =
      "Hypertension affects one billion adults worldwide [2, 3].";
    const start = pageText.indexOf(sentence);
    const claim: ExtractedClaim = {
      id: "claim-002",
      text: sentence,
      page: 1,
      location: { start, end: start + sentence.length },
      section: "1. Introduction",
      context: { before: null, after: null },
      type: "cited_claim",
      extraction: { method: "rule-based", version: "1.0.0", signals: [] },
    };
    const result = extractCitations(numberedPaper, [claim]);
    expect(
      result.inText.map((citation) => [citation.marker, citation.claimId]),
    ).toEqual([
      ["[1]", null],
      ["[2, 3]", "claim-002"],
      ["[4–7]", null],
      ["[9]", null],
      ["[1; 12]", null],
    ]);
  });
});

describe("repeated items", () => {
  test("cites a repeated number or author-year item once per marker", () => {
    const [numeric] = findCitationsOnPage({
      page: 1,
      text: "Shown before [1, 1, 2].",
    });
    expect(numeric?.items.map((item) => item.key)).toEqual(["1", "2"]);
    const [authorYear] = findCitationsOnPage({
      page: 1,
      text: "Shown before (Lee, 2019; Lee, 2019).",
    });
    expect(authorYear?.items.map((item) => item.key)).toEqual(["Lee, 2019"]);
  });
});

describe("full-name (natbib) reference style", () => {
  const pages: PageText[] = [
    {
      page: 1,
      text: [
        "1 Introduction",
        "Diffusion models generate high-quality images (Ho et al., 2020).",
        "Score matching was introduced earlier by Hyvarinen (2005).",
        "Vaswani et al. (2017) proposed the Transformer architecture.",
      ].join("\n"),
    },
    {
      page: 2,
      text: [
        "References",
        "Jonathan Ho, Ajay Jain, and Pieter Abbeel. Denoising diffusion probabilistic models.",
        "In Advances in Neural Information Processing Systems, 2020.",
        "Aapo Hyvarinen. Estimation of non-normalized statistical models by score matching.",
        "Journal of Machine Learning Research, 6:695-709, 2005.",
        "Ashish Vaswani, Noam Shazeer, Niki Parmar, et al. Attention is all you need. In",
        "Advances in Neural Information Processing Systems, 2017.",
      ].join("\n"),
    },
  ];

  test("splits full-name entries and matches author-year citations to them", () => {
    const result = extractCitations(pages);
    expect(
      result.references.map((reference) => reference.text.slice(0, 20)),
    ).toEqual([
      "Jonathan Ho, Ajay Ja",
      "Aapo Hyvarinen. Esti",
      "Ashish Vaswani, Noam",
    ]);
    expect(
      result.inText.map((citation) => [
        citation.marker,
        citation.matches.map((match) => [match.status, match.referenceIds]),
      ]),
    ).toEqual([
      ["(Ho et al., 2020)", [["matched", ["ref-001"]]]],
      ["Hyvarinen (2005)", [["matched", ["ref-002"]]]],
      ["Vaswani et al. (2017)", [["matched", ["ref-003"]]]],
    ]);
  });
});

describe("venue lines are not mistaken for new entries", () => {
  test("keeps a wrapped venue line with its entry", () => {
    const list = findReferenceList([
      {
        page: 1,
        text: [
          "References",
          "Aapo Hyvarinen. Estimation of non-normalized statistical models by score matching.",
          "Neural Computation, 12(3):1-20, 2005.",
          "Ian Goodfellow, Yoshua Bengio, and Aaron Courville.",
          "Deep Learning. MIT Press, 2016.",
        ].join("\n"),
      },
    ]);
    expect(list.entries.map((entry) => entry.text)).toEqual([
      "Aapo Hyvarinen. Estimation of non-normalized statistical models by score matching. Neural Computation, 12(3):1-20, 2005.",
      "Ian Goodfellow, Yoshua Bengio, and Aaron Courville. Deep Learning. MIT Press, 2016.",
    ]);
  });
});

describe("superscript citations", () => {
  test("splits typeset pieces into cited numbers", async () => {
    const { superscriptNumbers } = await import("./index.ts");
    expect(superscriptNumbers(["1", "–", "3"])).toEqual([1, 2, 3]);
    expect(superscriptNumbers(["5", "6"])).toEqual([5, 6]);
    expect(superscriptNumbers(["14", "16", "17"])).toEqual([14, 16, 17]);
    expect(superscriptNumbers(["1-3"])).toEqual([1, 2, 3]);
    expect(superscriptNumbers(["2,4"])).toEqual([2, 4]);
    expect(superscriptNumbers(["9", "–"])).toBeNull();
    expect(superscriptNumbers(["7", "–", "3"])).toBeNull();
    expect(superscriptNumbers(["1234"])).toBeNull();
  });

  // Page text as a parser produces it: superscripts flattened into the line.
  const text = [
    "Jane Doe1, John Roe2",
    "Abstract",
    "Body mass index was 25 kg/m2 on average.",
    "INTRODUCTION",
    "Menopause worsens risk factors1–3 and fitness4 in women.",
    "Function is impaired after menopause.56 Variance was tested with χ2 statistics.",
  ].join("\n");
  const at = (needle: string, length: number) => {
    const start = text.indexOf(needle);
    return start + needle.length - length;
  };
  const run = (needle: string, parts: string[]) => {
    const length = parts.join("").length;
    const start = at(needle, length);
    return { start, end: start + length, parts };
  };
  const page = {
    page: 1,
    text,
    superscripts: [
      run("Jane Doe1", ["1"]),
      run("John Roe2", ["2"]),
      run("kg/m2", ["2"]),
      run("factors1–3", ["1", "–", "3"]),
      run("fitness4", ["4"]),
      run("menopause.56", ["5", "6"]),
      run("χ2", ["2"]),
    ],
  };

  test("skips front-matter marks, unit exponents, and statistic symbols", async () => {
    const { bodyStart, classifySuperscript } = await import("./index.ts");
    const body = bodyStart([page]);
    expect(
      page.superscripts.map((r) => classifySuperscript(page, r, body)),
    ).toEqual([
      { skip: "front_matter" },
      { skip: "front_matter" },
      { skip: "exponent" },
      { citation: [1, 2, 3] },
      { citation: [4] },
      { citation: [5, 6] },
      { skip: "exponent" },
    ]);
  });

  test("matches superscript citations to a numbered reference list", () => {
    const references = {
      page: 2,
      text: [
        "References",
        "1. Lobo RA. Menopause and cardiovascular disease. Ann N Y Acad Sci. 2000;900:1-10.",
        "2. Smith J. Risk factors after menopause. Maturitas. 2001;38:1-9.",
        "3. Lee K. Lipids in older women. Atherosclerosis. 2002;160:1-8.",
        "4. Park S. Fitness and age. J Appl Physiol. 2003;95:1-7.",
        "5. Celermajer DS. Endothelial function after menopause. Ann Intern Med. 1994;121:936-41.",
      ].join("\n"),
    };
    const result = extractCitations([page, references]);
    expect(
      result.inText.map((c) => [
        c.style,
        c.marker,
        c.matches.map((m) => `${m.key}:${m.status}`),
      ]),
    ).toEqual([
      ["superscript", "1–3", ["1:matched", "2:matched", "3:matched"]],
      ["superscript", "4", ["4:matched"]],
      ["superscript", "56", ["5:matched", "6:unmatched"]],
    ]);
    for (const citation of result.inText) {
      expect(text.slice(citation.location.start, citation.location.end)).toBe(
        citation.marker,
      );
    }
  });

  test("pages without layout information keep the previous behaviour", () => {
    const result = extractCitations([
      { page: 1, text: "Risk rose in women.12 More text follows here." },
    ]);
    expect(result.inText).toEqual([]);
  });
});
