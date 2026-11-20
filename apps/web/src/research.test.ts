// biome-ignore-all lint/style/noNonNullAssertion: test fixtures index known array elements.
import { describe, expect, test } from "bun:test";
import {
  citationGraph,
  exportJson,
  exportMarkdown,
  filterSources,
  HISTORY_LIMIT,
  listHistory,
  loadFromHistory,
  loadReviews,
  paperKey,
  removeFromHistory,
  reviewQueue,
  saveReviews,
  saveToHistory,
} from "./research.ts";
import { paper, passage, verified, withEvidence } from "./test-fixtures.ts";

const memory = (limitBytes = Infinity) => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (v.length > limitBytes) throw new Error("QuotaExceededError");
      data.set(k, v);
    },
    removeItem: (k: string) => void data.delete(k),
  };
};
const now = new Date("2026-11-20T12:00:00Z");

describe("review queue", () => {
  test("lists cited claims needing review, with the reason, and never changes verdicts", () => {
    expect(reviewQueue(paper)).toMatchObject([
      { claimId: "claim-001", reason: "not_verified", verdict: null },
    ]);
    const [item] = reviewQueue(verified);
    expect(item).toMatchObject({
      reason: "partially_supported",
      verdict: "Partially supported",
    });
  });

  test("a supported claim with clean citations is not queued; failures and missing evidence are", () => {
    const supported = structuredClone(verified);
    supported.verification.results[0]!.verdict = "Supported";
    expect(reviewQueue(supported)).toEqual([]);
    const failed = structuredClone(verified);
    Object.assign(failed.verification.results[0]!, {
      verdict: "Unable to verify",
      unableCause: "model_error",
    });
    expect(reviewQueue(failed)[0]?.reason).toBe("model_failure");
    Object.assign(failed.verification.results[0]!, {
      unableCause: "no_evidence",
    });
    expect(reviewQueue(failed)[0]?.reason).toBe("missing_evidence");
  });

  test("review state is stored per paper and survives a reload; bad storage is safe", () => {
    const store = memory();
    const key = paperKey(verified);
    expect(loadReviews(store, key)).toEqual({});
    saveReviews(store, key, {
      "claim-001": { status: "follow_up", note: "check full text" },
    });
    expect(loadReviews(store, key)).toEqual({
      "claim-001": { status: "follow_up", note: "check full text" },
    });
    store.setItem(`citeverify.review.${key}`, "{oops");
    expect(loadReviews(store, key)).toEqual({});
  });
});

describe("document history", () => {
  test("saves, lists, reopens, updates, and deletes analyses without storing the PDF", () => {
    const store = memory();
    expect(saveToHistory(store, paper, now, "Title")).toBe(true);
    expect(listHistory(store)).toMatchObject([
      {
        name: "pierce study.pdf",
        status: "extracted",
        claims: 1,
        pdfStored: false,
      },
    ]);
    expect(saveToHistory(store, verified, now, "Title")).toBe(true);
    expect(listHistory(store)).toHaveLength(1);
    expect(listHistory(store)[0]).toMatchObject({
      status: "verified",
      verified: 1,
    });
    expect(loadFromHistory(store, paperKey(verified))).toEqual(verified);
    expect(store.data.get("citeverify.history.v1")).not.toContain("%PDF");
    removeFromHistory(store, paperKey(verified));
    expect(listHistory(store)).toEqual([]);
  });

  test("keeps at most the limit, newest first", () => {
    const store = memory();
    for (let i = 0; i < HISTORY_LIMIT + 3; i++) {
      const p = structuredClone(paper);
      p.document.name = `paper-${i}.pdf`;
      saveToHistory(store, p, now, null);
    }
    const names = listHistory(store).map((e) => e.name);
    expect(names).toHaveLength(HISTORY_LIMIT);
    expect(names[0]).toBe(`paper-${HISTORY_LIMIT + 2}.pdf`);
  });

  test("drops the oldest entries when storage is full, and reports failure if nothing fits", () => {
    const one = JSON.stringify([{ ...paper }]).length;
    const store = memory(one * 2.6);
    for (let i = 0; i < 4; i++) {
      const p = structuredClone(paper);
      p.document.name = `p${i}.pdf`;
      expect(saveToHistory(store, p, now, null)).toBe(true);
    }
    expect(listHistory(store).length).toBeLessThan(4);
    expect(listHistory(store)[0]?.name).toBe("p3.pdf");
    expect(saveToHistory(memory(10), paper, now, null)).toBe(false);
  });
});

describe("source explorer filtering", () => {
  test("filters by query, resolution, and access; no retrieval means no sources", () => {
    expect(
      filterSources(paper, { query: "", resolution: "all", access: "all" }),
    ).toEqual([]);
    const base = { query: "", resolution: "all", access: "all" } as const;
    expect(filterSources(withEvidence, base)).toHaveLength(1);
    expect(
      filterSources(withEvidence, { ...base, query: "10.1042/cs20100174" }),
    ).toHaveLength(1);
    expect(
      filterSources(withEvidence, { ...base, query: "ref 1" }),
    ).toHaveLength(1);
    expect(
      filterSources(withEvidence, { ...base, query: "Pierce" }),
    ).toHaveLength(1);
    expect(
      filterSources(withEvidence, { ...base, resolution: "unresolved" }),
    ).toHaveLength(0);
    expect(
      filterSources(withEvidence, { ...base, access: "full_text" }),
    ).toHaveLength(0);
  });
});

describe("citation graph", () => {
  test("links claim → matched reference → record → passages → verdict from real data", () => {
    expect(citationGraph(paper)).toMatchObject([
      {
        claimId: "claim-001",
        references: [{ number: 1, match: "matched", record: "not looked up" }],
        verdict: null,
      },
    ]);
    const [row] = citationGraph(verified);
    expect(row).toMatchObject({
      references: [
        { record: "resolved", access: "abstract_only", passages: 1 },
      ],
      verdict: { verdict: "Partially supported" },
      citedEvidence: 1,
    });
  });

  test("unmatched citations are shown as such, not as references", () => {
    const broken = structuredClone(paper);
    broken.citations.inText[0]!.matches = [
      { key: "9", status: "unmatched", referenceIds: [], reason: "no entry" },
    ];
    expect(citationGraph(broken)[0]).toMatchObject({
      references: [],
      unmatchedMarkers: ["9 (unmatched)"],
    });
  });
});

describe("JSON and Markdown exports", () => {
  test("say AI verification not performed when it was not run, with limitations", () => {
    const json = exportJson(paper, {}, now);
    expect(json.verification).toEqual({
      status: "AI verification not performed",
    });
    expect(json.claims[0]).toMatchObject({
      verdict: "Not verified",
      humanReview: { status: "unreviewed" },
    });
    expect(json.limitations.join(" ")).toContain("not that the claim is false");
    const md = exportMarkdown(paper, {}, now);
    expect(md).toContain("AI verification: AI verification not performed");
    expect(md).toContain("## Limitations");
  });

  test("include real verdicts, exact passages, provenance, model, and review notes kept apart", () => {
    const reviews = {
      "claim-001": { status: "reviewed" as const, note: "Agree" },
    };
    const json = exportJson(verified, reviews, now);
    expect(json.verification).toMatchObject({
      model: { name: "openai/gpt-oss-120b" },
    });
    expect(json.claims[0]).toMatchObject({
      verdict: "Partially supported",
      explanationIsEvidence: false,
      evidence: [
        {
          id: "E1",
          relation: "supports",
          text: passage,
          doi: "10.1042/cs20100174",
        },
      ],
      humanReview: { status: "reviewed", note: "Agree" },
    });
    const md = exportMarkdown(verified, reviews, now);
    expect(md).toContain(`"${passage}"`);
    expect(md).toContain("AI explanation (generated text, not evidence)");
    expect(md).toContain("Human review: reviewed — Agree");
  });
});
