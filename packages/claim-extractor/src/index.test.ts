import { describe, expect, test } from "bun:test";
import { classifySentence, extractClaims, type PageText } from "./index.ts";

const header = "Journal of Applied Physiology 2021";

/** A small three-page paper laid out the way unpdf emits text: one PDF line per line. */
const paper: PageText[] = [
  {
    page: 1,
    text: [
      header,
      "Effects of Interval Training on Cardiorespiratory Fitness",
      "Jane A. Doe, Rahul K. Mehta, Li Wei",
      "Department of Kinesiology, University of Example, Springfield, USA",
      "Corresponding author: jane.doe@example.edu",
      "Abstract",
      "Interval training is widely used in rehabilitation programs.",
      "We found that peak oxygen uptake increased by 12% after eight weeks of",
      "interval training (p < 0.01).",
      "1. Introduction",
      "Cardiorespiratory fitness is a strong predictor of mortality [1].",
      "Exercise is popular among adults of all ages and many people enjoy it.",
      "Previous trials reported that high-intensity interval training improves",
      "endurance more than continuous training (Smith et al., 2019).",
      "In this paper, we aim to compare two training protocols in older adults.",
    ].join("\n"),
  },
  {
    page: 2,
    text: [
      header,
      "2. Methods",
      "Participants were randomly assigned to interval or continuous training for eight weeks.",
      "Oxygen uptake was measured with a calibrated metabolic cart [4].",
      "3. Results",
      "Peak oxygen uptake was significantly higher in the interval group than in",
      "the control group.",
      "Figure 1. Change in peak oxygen uptake by group.",
      "Our results show that resting heart rate decreased in both groups.",
      "Did training adherence differ between the two groups?",
      "2",
    ].join("\n"),
  },
  {
    page: 3,
    text: [
      header,
      "4. Discussion",
      "These findings suggest that interval training may be preferable for older adults.",
      "Similar improvements were reported in younger cohorts (Lee and Park, 2020).",
      "References",
      "1. Kodama S, Saito K, Tanaka S. Cardiorespiratory fitness as a quantitative predictor of all-cause mortality. JAMA. 2009;301(19):2024-35.",
      "Smith, J. A., Brown, K. L., High-intensity training improves endurance, J Sports Sci, 12(3): 45-67.",
      "3",
    ].join("\n"),
  },
];

describe("extractClaims on a structured paper", () => {
  const { claims, truncated } = extractClaims(paper);

  test("finds exactly the genuine claims, in reading order", () => {
    expect(truncated).toBe(false);
    expect(
      claims.map((claim) => [claim.id, claim.page, claim.type, claim.text]),
    ).toEqual([
      [
        "claim-001",
        1,
        "reported_finding",
        "We found that peak oxygen uptake increased by 12% after eight weeks of interval training (p < 0.01).",
      ],
      [
        "claim-002",
        1,
        "cited_claim",
        "Cardiorespiratory fitness is a strong predictor of mortality [1].",
      ],
      [
        "claim-003",
        1,
        "cited_claim",
        "Previous trials reported that high-intensity interval training improves endurance more than continuous training (Smith et al., 2019).",
      ],
      [
        "claim-004",
        2,
        "reported_finding",
        "Peak oxygen uptake was significantly higher in the interval group than in the control group.",
      ],
      [
        "claim-005",
        2,
        "reported_finding",
        "Our results show that resting heart rate decreased in both groups.",
      ],
      [
        "claim-006",
        3,
        "reported_finding",
        "These findings suggest that interval training may be preferable for older adults.",
      ],
      [
        "claim-007",
        3,
        "cited_claim",
        "Similar improvements were reported in younger cohorts (Lee and Park, 2020).",
      ],
    ]);
  });

  test("maps every claim back to its exact page text", () => {
    for (const claim of claims) {
      const pageText = paper[claim.page - 1]?.text ?? "";
      const source = pageText.slice(claim.location.start, claim.location.end);
      expect(source.replace(/\s+/g, " ")).toBe(claim.text);
    }
  });

  test("records section, surrounding context, method, and signals", () => {
    const finding = claims[0];
    expect(finding?.section).toBe("Abstract");
    expect(finding?.context).toEqual({
      before: "Interval training is widely used in rehabilitation programs.",
      after:
        "Cardiorespiratory fitness is a strong predictor of mortality [1].",
    });
    expect(finding?.extraction).toEqual({
      method: "rule-based",
      version: "1.0.0",
      signals: [
        "first-person result statement",
        "statistical result",
        "quantified comparison",
      ],
    });
    expect(claims[3]?.section).toBe("3. Results");
    expect(claims[5]?.extraction.signals).toContain("hedged language");
  });

  test("never includes titles, authors, methods, captions, questions, or references", () => {
    const all = claims.map((claim) => claim.text).join("\n");
    for (const excluded of [
      "Jane A. Doe",
      "University of Example",
      "jane.doe@example.edu",
      "Exercise is popular",
      "we aim to compare",
      "randomly assigned",
      "metabolic cart",
      "Figure 1",
      "training adherence",
      "Kodama",
      "J Sports Sci",
      header,
    ]) {
      expect(all).not.toContain(excluded);
    }
  });

  test("is deterministic", () => {
    expect(extractClaims(paper)).toEqual({ claims, truncated });
  });

  test("reports truncation instead of silently dropping claims", () => {
    const limited = extractClaims(paper, { maxClaims: 2 });
    expect(limited.claims).toHaveLength(2);
    expect(limited.truncated).toBe(true);
  });
});

describe("extractClaims on empty or claim-free documents", () => {
  test("returns no claims for no pages", () => {
    expect(extractClaims([])).toEqual({ claims: [], truncated: false });
  });

  test("returns no claims for blank pages", () => {
    expect(
      extractClaims([
        { page: 1, text: "" },
        { page: 2, text: "   \n  " },
      ]),
    ).toEqual({ claims: [], truncated: false });
  });

  test("returns no claims for ordinary prose without claim signals", () => {
    const result = extractClaims([
      {
        page: 1,
        text: "The weather was pleasant during the conference week.\nMany delegates walked to the venue each morning.",
      },
    ]);
    expect(result.claims).toEqual([]);
  });
});

describe("page mapping", () => {
  test("uses the page number supplied by the parser and skips sentences split across pages", () => {
    const { claims } = extractClaims([
      {
        page: 7,
        text: "Results\nWe observed that tumour volume decreased by 40% in treated mice.\nWe also found that",
      },
      {
        page: 8,
        text: "body weight was unchanged across groups.\nOur data indicate that the drug was well tolerated.",
      },
    ]);
    expect(claims.map((claim) => [claim.page, claim.text])).toEqual([
      [7, "We observed that tumour volume decreased by 40% in treated mice."],
      [8, "Our data indicate that the drug was well tolerated."],
    ]);
    expect(claims[1]?.context.before).toBe(
      "body weight was unchanged across groups.",
    );
    expect(claims[0]?.context.after).toBe("We also found that");
  });
});

describe("classifySentence", () => {
  test.each([
    [
      "We demonstrate that the mutant protein binds DNA with tenfold higher affinity.",
      "results",
      "reported_finding",
    ],
    [
      "Mortality was significantly lower among vaccinated patients than among unvaccinated patients.",
      "results",
      "reported_finding",
    ],
    [
      "The intervention reduced systolic blood pressure by 8 mmHg on average (95% CI 5 to 11).",
      "results",
      "reported_finding",
    ],
    [
      "Smoking is associated with an increased risk of lung cancer [12].",
      "introduction",
      "cited_claim",
    ],
    [
      "Insulin resistance precedes the onset of type 2 diabetes by several years (Martin et al., 1992).",
      "discussion",
      "cited_claim",
    ],
  ] as const)("accepts a genuine claim: %s", (text, section, type) => {
    const result = classifySentence(text, section);
    expect(result).toMatchObject({ accepted: true, type });
  });

  test.each([
    ["Jane A. Doe, Rahul K. Mehta, Li Wei, and Omar Haddad.", "names_or_title"],
    [
      "Department of Kinesiology, University of Example, Springfield, IL 62701, USA.",
      "contact_or_affiliation",
    ],
    [
      "Correspondence should be addressed to the first author at jane.doe@example.edu today.",
      "contact_or_affiliation",
    ],
    [
      "1. Kodama S, Saito K, Tanaka S. Cardiorespiratory fitness and mortality. JAMA. 2009;301(19):2024-35.",
      "reference_entry",
    ],
    [
      "Figure 2. Mean heart rate across all training sessions in both groups.",
      "figure_or_table_caption",
    ],
    [
      "This article is published under a Creative Commons licence by Example Press.",
      "publication_metadata",
    ],
    [
      "Effects Of Interval Training On Cardiorespiratory Fitness In Older Adults.",
      "names_or_title",
    ],
    [
      "Does interval training improve fitness more than continuous training?",
      "question",
    ],
    [
      "Exercise is popular among adults of all ages and many people enjoy it.",
      "background_without_citation",
    ],
    [
      "The remainder of this paper is organized as follows for the reader.",
      "aim_or_outline",
    ],
    ["Results were good.", "too_short"],
    [
      "For a detailed review of training physiology, see [3-5].",
      "no_claim_signal",
    ],
  ] as const)("rejects a non-claim: %s", (text, reason) => {
    const section =
      reason === "background_without_citation" ? "introduction" : "discussion";
    expect(classifySentence(text, section)).toEqual({
      accepted: false,
      reason,
    });
  });

  test("rejects every sentence in methods, references, and administrative sections", () => {
    const text =
      "We found that the assay detected 95% of positive samples (p < 0.001).";
    for (const section of ["methods", "references", "excluded"] as const) {
      expect(classifySentence(text, section)).toEqual({
        accepted: false,
        reason: "excluded_section",
      });
    }
  });

  test("accepts short cited claims and open-ended significance wording", () => {
    expect(
      classifySentence(
        "Chronic sleep restriction impairs attention [2].",
        "introduction",
      ),
    ).toMatchObject({ accepted: true, type: "cited_claim" });
    expect(
      classifySentence(
        "Reaction times were significantly longer after night shifts.",
        "results",
      ),
    ).toMatchObject({ accepted: true, type: "reported_finding" });
  });

  test("does not treat colloquial 'significant' as a statistical finding", () => {
    expect(
      classifySentence(
        "Obesity remains a significant public health problem worldwide.",
        "discussion",
      ),
    ).toEqual({ accepted: false, reason: "no_claim_signal" });
  });

  test("rejects an incomplete sentence even when it has claim signals", () => {
    expect(
      classifySentence(
        "We found that peak oxygen uptake increased by 12% in",
        "results",
        false,
      ),
    ).toEqual({ accepted: false, reason: "incomplete_sentence" });
  });
});

describe("citation markers from PDF layout", () => {
  const text = [
    "INTRODUCTION",
    "Menopause is associated with a worsening of cardiovascular risk factors1–3 compared with premenopausal women.",
    "Vascular function is impaired after menopause.56 Exercise is a common intervention in many clinics.",
    "Subject populations with elevated blood pressure have shown improvement in function with training.",
    "141617",
    "RESULTS",
    "We found that function improved by 1.8% in exercisers (p<0.001).",
  ].join("\n");
  const span = (needle: string, marker: string) => {
    const start = text.indexOf(needle) + needle.length - marker.length;
    return { page: 1, start, end: start + marker.length };
  };
  const citationSpans = [
    span("factors1–3", "1–3"),
    span("menopause.56", "56"),
    span("training.\n141617", "141617"),
  ];

  test("without markers, cited introduction sentences are dropped as background", () => {
    const { claims } = extractClaims([{ page: 1, text }]);
    expect(claims.map((c) => [c.type, c.text])).toEqual([
      [
        "reported_finding",
        "We found that function improved by 1.8% in exercisers (p<0.001).",
      ],
    ]);
  });

  test("with markers, they are kept as claims citing external papers", () => {
    const { claims } = extractClaims([{ page: 1, text }], { citationSpans });
    expect(claims.map((c) => [c.type, c.text])).toEqual([
      [
        "cited_claim",
        "Menopause is associated with a worsening of cardiovascular risk factors1–3 compared with premenopausal women.",
      ],
      ["cited_claim", "Vascular function is impaired after menopause.56"],
      [
        "cited_claim",
        "Subject populations with elevated blood pressure have shown improvement in function with training. 141617",
      ],
      [
        "reported_finding",
        "We found that function improved by 1.8% in exercisers (p<0.001).",
      ],
    ]);
    expect(claims[0]?.extraction.signals).toContain(
      "superscript citation marker",
    );
  });

  test("a marker after a full stop ends the sentence and never starts the next one", () => {
    const { claims } = extractClaims([{ page: 1, text }], { citationSpans });
    expect(claims.some((c) => /^\d/.test(c.text))).toBe(false);
    for (const claim of claims) {
      expect(
        text
          .slice(claim.location.start, claim.location.end)
          .replace(/\s+/g, " "),
      ).toBe(claim.text);
    }
  });
});
