/**
 * Dataset evaluation logic (pure): parse and validate test datasets (JSON or
 * CSV), map CiteVerify outcomes onto the dataset's labels transparently, and
 * compute metrics with explicit denominators. Expected verdicts are the
 * dataset's own labels, not independently validated ground truth.
 */
import type { EvaluationCaseResponse } from "@citeverify/shared";

export const DATASET_FIELDS = [
  "test_case_id",
  "test_category",
  "document_claim",
  "inline_citation",
  "reference_entry",
  "cited_paper_doi",
  "source_evidence_snippet",
  "expected_verdict",
  "expected_reason",
  "needs_human_review",
] as const;

export const DATASET_LABELS = [
  "Supported",
  "Partly Supported",
  "Unsupported",
  "Contradictory",
  "Potentially Outdated",
  "Invalid/Missing Reference",
  "Needs Human Review",
  "Invalid Input",
  "No Citation Needed",
] as const;
export type DatasetLabel = (typeof DATASET_LABELS)[number];

export type DatasetCase = {
  id: string;
  category: string;
  claim: string;
  inlineCitation: string;
  referenceEntry: string;
  doi: string;
  evidenceSnippet: string;
  expected: DatasetLabel;
  expectedReason: string;
  needsHumanReview: boolean;
};

export const MAX_DATASET_BYTES = 5 * 1024 * 1024;
export const MAX_CASES = 1000;

// ------------------------------------------------------------------ parsing

/** RFC 4180 CSV: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (quoted) throw new Error("The CSV has an unclosed quoted field.");
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

export type ParseResult =
  | { ok: true; cases: DatasetCase[]; warnings: string[] }
  | { ok: false; errors: string[] };

function toBool(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  const s = String(value ?? "")
    .trim()
    .toLowerCase();
  if (["true", "yes", "1"].includes(s)) return true;
  if (["false", "no", "0", ""].includes(s)) return false;
  return null;
}

function validateRows(rows: Record<string, unknown>[]): ParseResult {
  const errors: string[] = [];
  if (rows.length === 0)
    return { ok: false, errors: ["The dataset has no test cases."] };
  if (rows.length > MAX_CASES)
    return {
      ok: false,
      errors: [
        `The dataset has ${rows.length} cases; the limit is ${MAX_CASES}.`,
      ],
    };
  const missing = DATASET_FIELDS.filter((f) => !(f in (rows[0] ?? {})));
  if (missing.length)
    return {
      ok: false,
      errors: [`Missing required fields: ${missing.join(", ")}.`],
    };
  const ids = new Set<string>();
  const cases: DatasetCase[] = [];
  rows.forEach((r, i) => {
    const where = `Row ${i + 1}${r.test_case_id ? ` (${String(r.test_case_id)})` : ""}`;
    const str = (key: (typeof DATASET_FIELDS)[number]) =>
      r[key] === null || r[key] === undefined ? "" : String(r[key]);
    const id = str("test_case_id").trim();
    if (!id) errors.push(`${where}: test_case_id is empty.`);
    else if (ids.has(id))
      errors.push(`${where}: duplicate test_case_id "${id}".`);
    ids.add(id);
    const expected = str("expected_verdict").trim();
    if (!(DATASET_LABELS as readonly string[]).includes(expected))
      errors.push(
        `${where}: expected_verdict "${expected}" is not one of ${DATASET_LABELS.join(", ")}.`,
      );
    const review = toBool(r.needs_human_review);
    if (review === null)
      errors.push(`${where}: needs_human_review must be true or false.`);
    cases.push({
      id,
      category: str("test_category"),
      claim: str("document_claim"),
      inlineCitation: str("inline_citation"),
      referenceEntry: str("reference_entry"),
      doi: str("cited_paper_doi"),
      evidenceSnippet: str("source_evidence_snippet"),
      expected: expected as DatasetLabel,
      expectedReason: str("expected_reason"),
      needsHumanReview: review ?? false,
    });
  });
  if (errors.length)
    return {
      ok: false,
      errors: errors
        .slice(0, 20)
        .concat(errors.length > 20 ? [`…and ${errors.length - 20} more.`] : []),
    };
  return { ok: true, cases, warnings: [] };
}

/** Parses a dataset file's text by its name (.json or .csv). */
export function parseDataset(name: string, text: string): ParseResult {
  if (text.length > MAX_DATASET_BYTES)
    return { ok: false, errors: ["The file is larger than 5 MB."] };
  const lower = name.toLowerCase();
  try {
    if (lower.endsWith(".json")) {
      const data: unknown = JSON.parse(text);
      const list = Array.isArray(data)
        ? data
        : typeof data === "object" &&
            data !== null &&
            Array.isArray((data as { test_cases?: unknown }).test_cases)
          ? (data as { test_cases: unknown[] }).test_cases
          : null;
      if (!list)
        return {
          ok: false,
          errors: [
            'JSON must be an array of cases or an object with a "test_cases" array.',
          ],
        };
      if (
        !list.every(
          (x) => typeof x === "object" && x !== null && !Array.isArray(x),
        )
      )
        return {
          ok: false,
          errors: ["Every test case must be a JSON object."],
        };
      return validateRows(list as Record<string, unknown>[]);
    }
    if (lower.endsWith(".csv")) {
      const [header, ...body] = parseCsv(text);
      if (!header) return { ok: false, errors: ["The CSV is empty."] };
      const keys = header.map((h) => h.trim());
      const bad = body.findIndex((r) => r.length !== keys.length);
      if (bad >= 0)
        return {
          ok: false,
          errors: [
            `CSV row ${bad + 2} has ${body[bad]?.length} columns; the header has ${keys.length}.`,
          ],
        };
      return validateRows(
        body.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i]]))),
      );
    }
    return { ok: false, errors: ["Choose a .json or .csv file."] };
  } catch (error) {
    return {
      ok: false,
      errors: [
        error instanceof Error
          ? `Could not read the file: ${error.message}`
          : "Could not read the file.",
      ],
    };
  }
}

// ------------------------------------------------------------------ mapping

export type Mode = EvaluationCaseResponse["mode"];
export type Prediction = {
  label: DatasetLabel | null;
  failed: boolean;
  rule: string;
};

/**
 * How a CiteVerify outcome becomes a dataset label. Shown in the UI so the
 * mapping is never hidden.
 */
export const MAPPING_RULES: { from: string; to: string }[] = [
  { from: "Supported", to: "Supported" },
  { from: "Partially supported", to: "Partly Supported" },
  { from: "Contradicted", to: "Contradictory" },
  {
    from: "Unable to verify: evidence did not establish the claim",
    to: "Unsupported",
  },
  {
    from: "Unable to verify: no usable evidence (supplied or retrieved)",
    to: "Needs Human Review",
  },
  {
    from: "Live mode: no scholarly record matched the reference",
    to: "Invalid/Missing Reference",
  },
  {
    from: "Claim empty or too short (rejected before any model call)",
    to: "Invalid Input",
  },
  {
    from: "No citation supplied",
    to: "(no label: CiteVerify does not judge whether a citation is needed)",
  },
  {
    from: "AI model unavailable, error, timeout, or invalid answer",
    to: "(failure: excluded from accuracy, counted in failure rate)",
  },
];

export function mapOutcome(r: EvaluationCaseResponse): Prediction {
  switch (r.outcome) {
    case "invalid_input":
      return { label: "Invalid Input", failed: false, rule: "input rejected" };
    case "no_citation":
      return { label: null, failed: false, rule: "no citation supplied" };
    case "model_failure":
      return {
        label: null,
        failed: true,
        rule: `model failure (${r.unableCause ?? "unknown"})`,
      };
    case "reference_not_found":
      return {
        label: "Invalid/Missing Reference",
        failed: false,
        rule: "no record matched",
      };
    case "no_evidence":
      return {
        label: "Needs Human Review",
        failed: false,
        rule: "no usable evidence",
      };
    default:
      if (r.verdict === "Supported")
        return { label: "Supported", failed: false, rule: "Supported" };
      if (r.verdict === "Partially supported")
        return {
          label: "Partly Supported",
          failed: false,
          rule: "Partially supported",
        };
      if (r.verdict === "Contradicted")
        return { label: "Contradictory", failed: false, rule: "Contradicted" };
      if (r.verdict === "Unsupported")
        return { label: "Unsupported", failed: false, rule: "Unsupported" };
      return {
        label: "Unsupported",
        failed: false,
        rule: "Unable to verify: evidence did not establish the claim",
      };
  }
}

/** Dataset labels CiteVerify can produce in each mode; others are non-comparable. */
export function producibleLabels(mode: Mode): DatasetLabel[] {
  const base: DatasetLabel[] = [
    "Supported",
    "Partly Supported",
    "Unsupported",
    "Contradictory",
    "Needs Human Review",
    "Invalid Input",
  ];
  return mode === "live" ? [...base, "Invalid/Missing Reference"] : base;
}

// ------------------------------------------------------------------ metrics

export type CaseResult = {
  id: string;
  expected: DatasetLabel;
  response?: EvaluationCaseResponse;
  error?: string;
  attempts: number;
};

export type Metrics = {
  mode: Mode;
  total: number;
  attempted: number;
  requestErrors: number;
  modelFailures: number;
  nonComparable: {
    id: string;
    expected: DatasetLabel;
    predicted: DatasetLabel | null;
  }[];
  inputValidation: { cases: number; correct: number };
  scored: number;
  correct: number;
  accuracy: number | null;
  perClass: {
    label: DatasetLabel;
    support: number;
    precision: number | null;
    recall: number | null;
    f1: number | null;
  }[];
  macroF1: number | null;
  labels: DatasetLabel[];
  /** confusion[expected][predicted]; predicted may also be "(none)". */
  confusion: Record<string, Record<string, number>>;
  coverage: number | null;
  failureRate: number | null;
  latency: { mean: number; p50: number; p90: number } | null;
};

export function computeMetrics(results: CaseResult[], mode: Mode): Metrics {
  const producible = new Set(producibleLabels(mode));
  const done = results.filter((r) => r.response || r.error);
  const requestErrors = done.filter((r) => !r.response).length;
  const answered = done.filter((r) => r.response) as (CaseResult & {
    response: EvaluationCaseResponse;
  })[];
  const predictions = answered.map((r) => ({ r, p: mapOutcome(r.response) }));
  const modelFailures = predictions.filter((x) => x.p.failed).length;
  const nonComparable = predictions
    .filter((x) => !producible.has(x.r.expected))
    .map((x) => ({ id: x.r.id, expected: x.r.expected, predicted: x.p.label }));
  const inputCases = predictions.filter(
    (x) => x.r.expected === "Invalid Input" && !x.p.failed,
  );
  const scoredItems = predictions.filter(
    (x) =>
      !x.p.failed &&
      producible.has(x.r.expected) &&
      x.r.expected !== "Invalid Input",
  );
  const labels = producibleLabels(mode).filter((l) => l !== "Invalid Input");
  const correct = scoredItems.filter((x) => x.p.label === x.r.expected).length;
  const perClass = labels.map((label) => {
    const tp = scoredItems.filter(
      (x) => x.r.expected === label && x.p.label === label,
    ).length;
    const fp = scoredItems.filter(
      (x) => x.r.expected !== label && x.p.label === label,
    ).length;
    const fn = scoredItems.filter(
      (x) => x.r.expected === label && x.p.label !== label,
    ).length;
    const precision = tp + fp ? tp / (tp + fp) : null;
    const recall = tp + fn ? tp / (tp + fn) : null;
    // F1 for every label that has cases; an undefined precision (the label
    // was never predicted) counts as 0, as in scikit-learn's zero_division=0.
    const p = precision ?? 0;
    const r = recall ?? 0;
    const f1 = tp + fn > 0 ? (p + r > 0 ? (2 * p * r) / (p + r) : 0) : null;
    return { label, support: tp + fn, precision, recall, f1 };
  });
  const withSupport = perClass.filter((c) => c.support > 0 && c.f1 !== null);
  const confusion: Record<string, Record<string, number>> = {};
  for (const x of scoredItems) {
    const row = confusion[x.r.expected] ?? {};
    confusion[x.r.expected] = row;
    const key = x.p.label ?? "(none)";
    row[key] = (row[key] ?? 0) + 1;
  }
  const latencies = answered
    .map((r) => r.response.latencyMs)
    .sort((a, b) => a - b);
  const at = (q: number) =>
    latencies[
      Math.min(latencies.length - 1, Math.floor(q * latencies.length))
    ] ?? 0;
  return {
    mode,
    total: results.length,
    attempted: done.length,
    requestErrors,
    modelFailures,
    nonComparable,
    inputValidation: {
      cases: inputCases.length,
      correct: inputCases.filter((x) => x.p.label === "Invalid Input").length,
    },
    scored: scoredItems.length,
    correct,
    accuracy: scoredItems.length ? correct / scoredItems.length : null,
    perClass,
    macroF1: withSupport.length
      ? withSupport.reduce((s, c) => s + (c.f1 ?? 0), 0) / withSupport.length
      : null,
    labels,
    confusion,
    coverage: done.length
      ? (answered.length - modelFailures) / done.length
      : null,
    failureRate: done.length
      ? (requestErrors + modelFailures) / done.length
      : null,
    latency: latencies.length
      ? {
          mean: latencies.reduce((s, v) => s + v, 0) / latencies.length,
          p50: at(0.5),
          p90: at(0.9),
        }
      : null,
  };
}

// ------------------------------------------------------------------ exports

const csvCell = (value: unknown) => {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function resultsCsv(
  cases: DatasetCase[],
  results: Map<string, CaseResult>,
  mode: Mode,
): string {
  const header = [
    "test_case_id",
    "test_category",
    "mode",
    "expected_verdict (dataset label)",
    "predicted_label",
    "agreement",
    "citeverify_outcome",
    "citeverify_verdict",
    "mapping_rule",
    "evidence_provenance",
    "explanation",
    "reason",
    "error",
    "latency_ms",
  ];
  const lines = [header.join(",")];
  for (const c of cases) {
    const r = results.get(c.id);
    const p = r?.response ? mapOutcome(r.response) : null;
    const comparable = producibleLabels(mode).includes(c.expected);
    lines.push(
      [
        c.id,
        c.category,
        mode,
        c.expected,
        p?.label ?? "",
        !r
          ? "not run"
          : !r.response
            ? "error"
            : p?.failed
              ? "failure"
              : !comparable
                ? "non-comparable"
                : p?.label === c.expected
                  ? "agree"
                  : "mismatch",
        r?.response?.outcome ?? "",
        r?.response?.verdict ?? "",
        p?.rule ?? "",
        r?.response
          ? `${r.response.provenance.kind}: ${r.response.provenance.detail}`
          : "",
        r?.response?.explanation ?? "",
        r?.response?.reason ?? "",
        r?.error ?? "",
        r?.response?.latencyMs ?? "",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}
