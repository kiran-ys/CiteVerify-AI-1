import { describe, expect, test } from "bun:test";
import type { ExtractedClaim } from "@citeverify/shared";
import {
  checkInternalConsistency,
  confidenceIntervals,
  pValues,
  significanceWording,
  specificValues,
} from "./index.ts";

function claimAt(
  id: string,
  pageText: string,
  sentence: string,
  type: ExtractedClaim["type"] = "reported_finding",
): ExtractedClaim {
  const start = pageText.indexOf(sentence);
  if (start === -1) throw new Error(`sentence not in page: ${sentence}`);
  return {
    id,
    text: sentence,
    page: 1,
    location: { start, end: start + sentence.length },
    section: "Abstract",
    context: { before: null, after: null },
    type,
    extraction: { method: "rule-based", version: "1.0.0", signals: [] },
  };
}

describe("parsing statistics from a finding", () => {
  test("collects specific values but not significance thresholds", () => {
    expect(
      specificValues(
        "FMD improved by 1.8% (95% CI: 1.17 to 2.38; p<0.001) in women (n=155) versus 0.5%.",
      ),
    ).toEqual(["1.8%", "1.17", "2.38", "0.5%", "155"]);
  });

  test("reads p-values and confidence intervals", () => {
    expect(
      pValues("r=-0.17, p=0.05 and p<0.001").map((p) => [
        p.comparator,
        p.value,
      ]),
    ).toEqual([
      ["=", 0.05],
      ["<", 0.001],
    ]);
    expect(confidenceIntervals("1.8%, 95% CI: 1.17 to 2.38")).toMatchObject([
      { low: 1.17, high: 2.38, legible: true },
    ]);
    expect(
      confidenceIntervals("difference -0.4 (95% CI −1.1 to 0.3)"),
    ).toMatchObject([{ low: -1.1, high: 0.3, legible: true }]);
  });

  test("marks an interval with a mis-rendered minus sign as illegible", () => {
    // The real PDF renders a minus as "!", as in "95% CI: !1.17 to 0.69".
    expect(confidenceIntervals("95% CI: !1.17 to 0.69")).toMatchObject([
      { legible: false },
    ]);
  });

  test("distinguishes significance wording", () => {
    expect(significanceWording("FMD improved significantly")).toBe(
      "significant",
    );
    expect(significanceWording("there was no significant change")).toBe(
      "not_significant",
    );
    expect(significanceWording("did not significantly affect FMD")).toBe(
      "not_significant",
    );
    expect(significanceWording("the correlation approached significance")).toBe(
      "approached",
    );
    expect(significanceWording("FMD improved")).toBeNull();
  });
});

describe("internal consistency of the paper's own findings", () => {
  const abstract =
    "Exercisers with dysfunction improved FMD by 1.8% (95% CI: 1.17 to 2.38; p<0.001) after training.";
  const results =
    "In the results, the improvement was 1.8% (95% CI: 1.17 to 2.38) in 72 women with dysfunction.";
  const page = { page: 1, text: `${abstract}\n${results}` };

  test("finds the abstract's values again in the results, with exact quotes", () => {
    const { results: out } = checkInternalConsistency(
      [page],
      [claimAt("claim-001", page.text, abstract)],
    );
    const valueChecks = out[0]?.checks.filter(
      (check) => check.kind === "value_reported_elsewhere",
    );
    expect(valueChecks?.map((check) => check.status)).toEqual([
      "consistent",
      "consistent",
      "consistent",
    ]);
    for (const check of valueChecks ?? []) {
      for (const quote of check.quotes) {
        // Quotes come from the paper and point outside the claim itself.
        expect(page.text).toContain(quote.text);
        expect(quote.start).toBeGreaterThanOrEqual(abstract.length);
      }
    }
  });

  test("agrees when the interval and p-value tell the same story", () => {
    const { results: out } = checkInternalConsistency(
      [page],
      [claimAt("claim-001", page.text, abstract)],
    );
    expect(
      out[0]?.checks.find((check) => check.kind === "ci_p_agreement"),
    ).toMatchObject({
      status: "consistent",
      detail: "The 95% CI (1.17 to 2.38) excludes 0, in line with p<0.001.",
    });
    expect(out[0]?.status).toBe("consistent");
  });

  test("flags an interval that contradicts its p-value", () => {
    const text =
      "Training changed FMD by 0.4% (95% CI: -0.2 to 1.0; p=0.01) in all women.";
    const out = checkInternalConsistency(
      [{ page: 1, text }],
      [claimAt("claim-002", text, text)],
    );
    expect(out.results[0]?.status).toBe("inconsistent");
    expect(
      out.results[0]?.checks.find((check) => check.kind === "ci_p_agreement")
        ?.detail,
    ).toBe(
      "The 95% CI (-0.2 to 1) includes 0, but p=0.01 implies the opposite at the 0.05 level.",
    );
  });

  test("flags 'significant' wording with a non-significant p-value", () => {
    const text =
      "FMD improved significantly after training (p=0.21) in the exercise group.";
    const out = checkInternalConsistency(
      [{ page: 1, text }],
      [claimAt("claim-003", text, text)],
    );
    expect(out.results[0]?.checks[0]).toMatchObject({
      kind: "significance_wording",
      status: "inconsistent",
    });
  });

  test("treats p = 0.05 as borderline rather than inconsistent", () => {
    const text =
      "Change in FMD was significantly, but weakly, associated with waist (r=-0.17, p=0.05).";
    const out = checkInternalConsistency(
      [{ page: 1, text }],
      [claimAt("claim-004", text, text)],
    );
    expect(
      out.results[0]?.checks.find(
        (check) => check.kind === "significance_wording",
      ),
    ).toMatchObject({
      status: "not_checkable",
    });
    expect(out.results[0]?.status).not.toBe("inconsistent");
  });

  test("a value found nowhere else is not checkable, not an error", () => {
    const text = "FMD rose by 3.14% in the subgroup of women.";
    const out = checkInternalConsistency(
      [{ page: 1, text }],
      [claimAt("claim-005", text, text)],
    );
    expect(out.results[0]).toMatchObject({ status: "not_checkable" });
    expect(out.results[0]?.checks[0]?.detail).toContain(
      "does not appear elsewhere",
    );
  });

  test("only the paper's own findings are checked, and the disclaimer is always present", () => {
    const text =
      "Exercise improves endothelial function in women.12 We found FMD rose by 1.8% (p<0.001).";
    const out = checkInternalConsistency(
      [{ page: 1, text }],
      [
        claimAt(
          "claim-006",
          text,
          "Exercise improves endothelial function in women.12",
          "cited_claim",
        ),
        claimAt("claim-007", text, "We found FMD rose by 1.8% (p<0.001)."),
      ],
    );
    expect(out.results.map((result) => result.claimId)).toEqual(["claim-007"]);
    expect(out.disclaimer).toContain(
      "cannot show that the study was conducted as reported",
    );
  });
});
