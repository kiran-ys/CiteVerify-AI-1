import { describe, expect, test } from "bun:test";
import type { EvaluationCaseResponse } from "@citeverify/shared";
import {
  type CaseResult,
  computeMetrics,
  type DatasetLabel,
  mapOutcome,
  parseCsv,
  parseDataset,
  resultsCsv,
} from "./dataset.ts";

const root = new URL("../../../", import.meta.url).pathname;
const read = (name: string) => Bun.file(`${root}eval/datasets/${name}`).text();

const response = (
  patch: Partial<EvaluationCaseResponse>,
): EvaluationCaseResponse => ({
  caseId: "TC",
  mode: "supplied",
  outcome: "verified",
  verdict: "Supported",
  unableCause: null,
  reason: null,
  explanation: null,
  provenance: {
    kind: "dataset_supplied",
    detail: "x",
    resolver: null,
    access: null,
    workTitle: null,
    workDoi: null,
  },
  evidence: [],
  model: null,
  latencyMs: 100,
  ...patch,
});

describe("dataset parsing", () => {
  test("reads the real 55-case JSON and CSV files identically", async () => {
    const json = parseDataset(
      "citeverify_test_dataset.json",
      await read("citeverify_test_dataset.json"),
    );
    const csv = parseDataset(
      "citeverify_test_dataset.csv",
      await read("citeverify_test_dataset.csv"),
    );
    expect(json.ok && csv.ok).toBe(true);
    if (!json.ok || !csv.ok) return;
    expect(json.cases).toHaveLength(55);
    expect(csv.cases).toEqual(json.cases);
    expect(json.cases.find((c) => c.id === "TC-053")?.claim).toBe(
      "   ###   \t\n   ",
    );
  });

  test("CSV handles quotes, commas, and newlines inside fields", () => {
    expect(parseCsv('a,b\n"x, ""y""","line1\nline2"\n')).toEqual([
      ["a", "b"],
      ['x, "y"', "line1\nline2"],
    ]);
    expect(() => parseCsv('a\n"unclosed')).toThrow("unclosed");
  });

  test("gives helpful errors for bad files", () => {
    expect(parseDataset("x.txt", "")).toEqual({
      ok: false,
      errors: ["Choose a .json or .csv file."],
    });
    expect(parseDataset("x.json", "{oops")).toMatchObject({ ok: false });
    expect(parseDataset("x.json", '{"cases": []}')).toMatchObject({
      ok: false,
      errors: [expect.stringContaining("test_cases")],
    });
    expect(parseDataset("x.csv", "test_case_id\nTC-1\n")).toMatchObject({
      ok: false,
      errors: [expect.stringContaining("Missing required fields")],
    });
    const row = (id: string, verdict: string, review = "true") =>
      `${id},cat,claim text here,[1],ref,10.1/x,snippet,${verdict},why,${review}`;
    const header =
      "test_case_id,test_category,document_claim,inline_citation,reference_entry,cited_paper_doi,source_evidence_snippet,expected_verdict,expected_reason,needs_human_review";
    const bad = parseDataset(
      "x.csv",
      [header, row("TC-1", "Maybe"), row("TC-1", "Supported", "perhaps")].join(
        "\n",
      ),
    );
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.errors.join(" ")).toContain('expected_verdict "Maybe"');
    expect(bad.errors.join(" ")).toContain('duplicate test_case_id "TC-1"');
    expect(bad.errors.join(" ")).toContain(
      "needs_human_review must be true or false",
    );
  });
});

describe("verdict mapping is explicit and keeps distinctions", () => {
  test.each([
    [response({ verdict: "Supported" }), "Supported"],
    [response({ verdict: "Partially supported" }), "Partly Supported"],
    [response({ verdict: "Contradicted" }), "Contradictory"],
    [
      response({
        verdict: "Unable to verify",
        unableCause: "insufficient_evidence",
      }),
      "Unsupported",
    ],
    [
      response({
        outcome: "no_evidence",
        verdict: "Unable to verify",
        unableCause: "no_evidence",
      }),
      "Needs Human Review",
    ],
    [
      response({
        outcome: "reference_not_found",
        mode: "live",
        verdict: "Unable to verify",
      }),
      "Invalid/Missing Reference",
    ],
    [response({ outcome: "invalid_input", verdict: null }), "Invalid Input"],
    [response({ outcome: "no_citation", verdict: null }), null],
  ])("%#", (r, label) => {
    expect(mapOutcome(r).label).toBe(label as DatasetLabel | null);
  });

  test("model failures are failures, never a label", () => {
    expect(
      mapOutcome(
        response({
          outcome: "model_failure",
          verdict: "Unable to verify",
          unableCause: "model_error",
        }),
      ),
    ).toMatchObject({
      label: null,
      failed: true,
    });
  });
});

describe("metrics", () => {
  const r = (
    id: string,
    expected: DatasetLabel,
    patch?: Partial<EvaluationCaseResponse>,
    error?: string,
  ): CaseResult => ({
    id,
    expected,
    attempts: 1,
    ...(error ? { error } : { response: response({ caseId: id, ...patch }) }),
  });

  test("scores only comparable cases, reports the rest separately, with denominators", () => {
    const results = [
      r("a", "Supported"),
      r("b", "Supported", { verdict: "Partially supported" }),
      r("c", "Contradictory", { verdict: "Contradicted" }),
      r("d", "Potentially Outdated"), // non-comparable label
      r("e", "Invalid Input", { outcome: "invalid_input", verdict: null }),
      r("f", "Unsupported", {
        outcome: "model_failure",
        verdict: "Unable to verify",
        unableCause: "model_timeout",
        latencyMs: 300,
      }),
      r("g", "Supported", undefined, "HTTP 503"),
      { id: "h", expected: "Supported", attempts: 0 } as CaseResult,
    ];
    const m = computeMetrics(results, "supplied");
    expect(m).toMatchObject({
      total: 8,
      attempted: 7,
      requestErrors: 1,
      modelFailures: 1,
      scored: 3,
      correct: 2,
      inputValidation: { cases: 1, correct: 1 },
    });
    expect(m.accuracy).toBeCloseTo(2 / 3);
    expect(m.nonComparable).toEqual([
      { id: "d", expected: "Potentially Outdated", predicted: "Supported" },
    ]);
    expect(m.confusion).toEqual({
      Supported: { Supported: 1, "Partly Supported": 1 },
      Contradictory: { Contradictory: 1 },
    });
    expect(m.perClass.find((c) => c.label === "Supported")).toMatchObject({
      support: 2,
      precision: 1,
      recall: 0.5,
    });
    expect(m.failureRate).toBeCloseTo(2 / 7);
    expect(m.coverage).toBeCloseTo(5 / 7);
  });

  test("macro F1 is 0, not missing, when no scored case is right", () => {
    const m = computeMetrics(
      [
        r("a", "Supported", { verdict: "Partially supported" }),
        r("b", "Contradictory", { verdict: "Partially supported" }),
      ],
      "supplied",
    );
    expect(m.macroF1).toBe(0);
    expect(m.perClass.find((c) => c.label === "Supported")).toMatchObject({
      precision: null,
      recall: 0,
      f1: 0,
    });
    expect(m.perClass.find((c) => c.label === "Unsupported")?.f1).toBeNull();
  });

  test("Invalid/Missing Reference is comparable only in live mode", () => {
    const results = [
      r("a", "Invalid/Missing Reference", {
        outcome: "reference_not_found",
        mode: "live",
        verdict: "Unable to verify",
      }),
    ];
    expect(computeMetrics(results, "supplied").nonComparable).toHaveLength(1);
    expect(computeMetrics(results, "live")).toMatchObject({
      scored: 1,
      correct: 1,
    });
  });

  test("nothing run means no metrics, not zeros", () => {
    const m = computeMetrics(
      [{ id: "a", expected: "Supported", attempts: 0 }],
      "supplied",
    );
    expect(m).toMatchObject({
      accuracy: null,
      macroF1: null,
      coverage: null,
      failureRate: null,
      latency: null,
    });
  });

  test("CSV export marks agreement, non-comparable, failures, and provenance", () => {
    const parsed = parseDataset(
      "x.json",
      JSON.stringify([
        {
          test_case_id: "A",
          test_category: "c",
          document_claim: "x y z words",
          inline_citation: "[1]",
          reference_entry: "r",
          cited_paper_doi: "d",
          source_evidence_snippet: "s",
          expected_verdict: "Supported",
          expected_reason: "why, with comma",
          needs_human_review: false,
        },
        {
          test_case_id: "B",
          test_category: "c",
          document_claim: "x y z words",
          inline_citation: "[1]",
          reference_entry: "r",
          cited_paper_doi: "d",
          source_evidence_snippet: "s",
          expected_verdict: "Potentially Outdated",
          expected_reason: "why",
          needs_human_review: true,
        },
      ]),
    );
    if (!parsed.ok) throw new Error("fixture");
    const map = new Map([
      ["A", r("A", "Supported")],
      ["B", r("B", "Potentially Outdated")],
    ]);
    const csv = resultsCsv(parsed.cases, map, "supplied");
    const rows = parseCsv(csv);
    expect(rows[1]?.[5]).toBe("agree");
    expect(rows[2]?.[5]).toBe("non-comparable");
    expect(rows[1]?.[9]).toContain("dataset_supplied");
  });
});
