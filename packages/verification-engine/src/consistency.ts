/**
 * Internal consistency of a paper's own findings, checked against the rest of
 * the same paper. Deterministic; no model.
 *
 * What this can show: whether a value stated in a finding also appears
 * elsewhere in the paper (e.g. the abstract's result in the Results text or a
 * table), whether a reported 95% confidence interval agrees with the p-value,
 * and whether "significant" wording agrees with the reported statistics.
 *
 * What it cannot show: that the study happened as described or that the data
 * are genuine. A value missing elsewhere is "not checkable", not an error.
 */
import type {
  ClaimConsistency,
  ConsistencyCheck,
  ConsistencyStatus,
  ExtractedClaim,
  InternalConsistency,
  PaperQuote,
} from "@citeverify/shared";

export const CONSISTENCY_VERSION = "1.0.0";
export const CONSISTENCY_DISCLAIMER =
  "Internal consistency compares numbers and statistical statements within this paper only. It cannot show that the study was conducted as reported or that the data are genuine.";

type Page = { page: number; text: string };

const MAX_VALUES = 8;
const CONTEXT = 70;
/** Common significance thresholds; their repetition elsewhere says nothing. */
const THRESHOLDS = new Set(["0.05", "0.01", "0.001", ".05", ".01", ".001"]);


/** Specific values worth looking for elsewhere: decimals, percentages, and sample sizes. */
export function specificValues(text: string): string[] {
  const values: string[] = [];
  for (const match of text.matchAll(/(?<![\d.])(\d+\.\d+)(?![\d])\s?(%?)/g)) {
    values.push(`${match[1]}${match[2] ?? ""}`);
  }
  // "95% CI" is a confidence level, not a result.
  for (const match of text.matchAll(
    /(?<![\d.])(\d+)\s?%(?!\s*(?:CI|confidence)\b)/gi,
  )) {
    values.push(`${match[1]}%`);
  }
  for (const match of text.matchAll(/\bn\s?=\s?(\d+)/gi))
    values.push(match[1] ?? "");
  return [
    ...new Set(
      values.filter(
        (value) => value && !THRESHOLDS.has(value.replace("%", "")),
      ),
    ),
  ].slice(0, MAX_VALUES);
}

function quoteAt(page: Page, start: number, end: number): PaperQuote {
  const from = Math.max(0, start - CONTEXT);
  const to = Math.min(page.text.length, end + CONTEXT);
  return { page: page.page, start, end, text: page.text.slice(from, to) };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Where else the value occurs in the paper, outside the claim itself. */
function occurrencesElsewhere(
  value: string,
  claim: ExtractedClaim,
  pages: Page[],
): PaperQuote[] {
  const number = value.replace("%", "");
  const pattern = new RegExp(
    `(?<![\\d.])${escapeRegExp(number)}(?![\\d])(?:\\.(?!\\d))?`,
    "g",
  );
  const quotes: PaperQuote[] = [];
  for (const page of pages) {
    for (const match of page.text.matchAll(pattern)) {
      const start = match.index ?? 0;
      const end = start + number.length;
      const insideClaim =
        page.page === claim.page &&
        start >= claim.location.start &&
        start < claim.location.end;
      if (!insideClaim) quotes.push(quoteAt(page, start, end));
      if (quotes.length >= 3) return quotes;
    }
  }
  return quotes;
}

function valueChecks(claim: ExtractedClaim, pages: Page[]): ConsistencyCheck[] {
  return specificValues(claim.text).map((value) => {
    const quotes = occurrencesElsewhere(value, claim, pages);
    return quotes.length > 0
      ? {
          kind: "value_reported_elsewhere",
          status: "consistent",
          detail: `The value ${value} also appears elsewhere in the paper (${quotes
            .map((quote) => `page ${quote.page}`)
            .join(", ")}).`,
          quotes,
        }
      : {
          kind: "value_reported_elsewhere",
          status: "not_checkable",
          detail: `The value ${value} does not appear elsewhere in the extracted text; tables or figures may not have been extractable.`,
          quotes: [],
        };
  });
}

type PValue = { comparator: string; value: number; raw: string; index: number };

export function pValues(text: string): PValue[] {
  return [...text.matchAll(/\bp\s*(?:values?\s*)?([<>=≤≥])\s*(0?\.\d+)/gi)].map(
    (match) => ({
      comparator: match[1] ?? "=",
      value: Number(match[2]),
      raw: match[0],
      index: match.index ?? 0,
    }),
  );
}

/**
 * True/false when the p-value states significance at 0.05; null when it
 * cannot say. A p reported as exactly 0.05 is borderline: rounding could
 * place the true value on either side of the threshold.
 */
export function pSignificant(p: PValue): boolean | null {
  if (p.comparator === "<" || p.comparator === "≤")
    return p.value <= 0.05 ? true : null;
  if (p.comparator === ">" || p.comparator === "≥")
    return p.value >= 0.05 ? false : null;
  if (p.value === 0.05) return null;
  return p.value < 0.05;
}

export type Interval = {
  low: number;
  high: number;
  raw: string;
  index: number;
  /** False when a sign before a bound was not extracted legibly (e.g. "!" for a minus). */
  legible: boolean;
};

/** 95% confidence intervals; each one is judged on its own. */
export function confidenceIntervals(text: string): Interval[] {
  const pattern =
    /95%\s*CI[:,]?\s*(\S?)(\d+(?:\.\d+)?)\s*(?:to|–|—|,)\s*(\S?)(\d+(?:\.\d+)?)/gi;
  return [...text.matchAll(pattern)].map((match) => {
    const signs = [match[1] ?? "", match[3] ?? ""];
    const legible = signs.every((sign) => !sign || /^[-−–(]$/.test(sign));
    const negative = (sign: string) => /^[-−–]$/.test(sign);
    return {
      low: Number(match[2]) * (negative(signs[0] ?? "") ? -1 : 1),
      high: Number(match[4]) * (negative(signs[1] ?? "") ? -1 : 1),
      raw: match[0],
      index: match.index ?? 0,
      legible,
    };
  });
}

const RATIO =
  /\b(odds ratio|hazard ratio|relative risk|risk ratio|rate ratio|OR|HR|RR|IRR)\b/;

function excludesNull(interval: Interval, nullValue: number): boolean {
  return (
    (interval.low > nullValue && interval.high > nullValue) ||
    (interval.low < nullValue && interval.high < nullValue)
  );
}

type Wording = "significant" | "not_significant" | "approached" | null;

export function significanceWording(text: string): Wording {
  if (
    /\b(approach(?:ed|ing)?|trend(?:ed)? toward)\s+(?:statistical\s+)?significance\b/i.test(
      text,
    )
  )
    return "approached";
  if (
    /\b(?:no|not|non-?)\s+(?:statistically\s+)?significant(?:ly)?\b|\bdid not\s+(?:\w+\s+){0,2}significantly\b/i.test(
      text,
    )
  ) {
    return "not_significant";
  }
  if (/\bsignificant(?:ly)?\b/i.test(text)) return "significant";
  return null;
}

function claimQuote(
  claim: ExtractedClaim,
  pages: Page[],
  raw: string,
): PaperQuote[] {
  const page = pages.find((candidate) => candidate.page === claim.page);
  if (!page) return [];
  const slice = page.text.slice(claim.location.start, claim.location.end);
  const at = slice.indexOf(raw);
  if (at === -1) return [];
  const start = claim.location.start + at;
  return [{ page: page.page, start, end: start + raw.length, text: raw }];
}

/** The p-value reported right after an interval, e.g. "95% CI: 1.17 to 2.38; p<0.001". */
function pairedP(interval: Interval, ps: PValue[]): PValue | null {
  const after = interval.index + interval.raw.length;
  return ps.find((p) => p.index >= after && p.index - after <= 6) ?? null;
}

function statisticalChecks(
  claim: ExtractedClaim,
  pages: Page[],
): ConsistencyCheck[] {
  const checks: ConsistencyCheck[] = [];
  const ps = pValues(claim.text);
  const intervals = confidenceIntervals(claim.text);
  const nullValue = RATIO.test(claim.text) ? 1 : 0;

  const illegible = intervals.filter((interval) => !interval.legible);
  if (illegible.length > 0) {
    checks.push({
      kind: "ci_p_agreement",
      status: "not_checkable",
      detail: `${illegible.length} confidence interval${illegible.length > 1 ? "s contain" : " contains"} a sign the PDF text did not render legibly (for example "!" in place of a minus), so ${illegible.length > 1 ? "they were" : "it was"} not interpreted.`,
      quotes: illegible.flatMap((interval) =>
        claimQuote(claim, pages, interval.raw),
      ),
    });
  }

  const pairedPs = new Set<PValue>();
  for (const interval of intervals.filter((item) => item.legible)) {
    const p = pairedP(interval, ps);
    if (!p) continue;
    pairedPs.add(p);
    const significant = pSignificant(p);
    const quotes = [
      ...claimQuote(claim, pages, interval.raw),
      ...claimQuote(claim, pages, p.raw),
    ];
    if (significant === null) {
      checks.push({
        kind: "ci_p_agreement",
        status: "not_checkable",
        detail: `${p.raw.trim()} is at the 0.05 threshold, so agreement with the 95% CI (${interval.low} to ${interval.high}) cannot be judged.`,
        quotes,
      });
      continue;
    }
    const excludes = excludesNull(interval, nullValue);
    checks.push({
      kind: "ci_p_agreement",
      status: excludes === significant ? "consistent" : "inconsistent",
      detail:
        excludes === significant
          ? `The 95% CI (${interval.low} to ${interval.high}) ${excludes ? "excludes" : "includes"} ${nullValue}, in line with ${p.raw.trim()}.`
          : `The 95% CI (${interval.low} to ${interval.high}) ${excludes ? "excludes" : "includes"} ${nullValue}, but ${p.raw.trim()} implies the opposite at the 0.05 level.`,
      quotes,
    });
  }

  const wording = significanceWording(claim.text);
  if (wording) {
    const pResults = ps.map(pSignificant);
    const borderline = pResults.some((value) => value === null);
    const signals = [
      ...pResults.filter((value): value is boolean => value !== null),
      // Intervals without their own p-value also carry a significance result.
      ...intervals
        .filter((interval) => interval.legible && !pairedP(interval, ps))
        .map((interval) => excludesNull(interval, nullValue)),
    ];
    const quotes = [
      ...ps.flatMap((p) => claimQuote(claim, pages, p.raw)),
      ...intervals
        .filter((interval) => interval.legible)
        .flatMap((interval) => claimQuote(claim, pages, interval.raw)),
    ];
    const expectSignificant = wording === "significant";
    const label = wording.replace("_", " ");
    if (signals.length === 0 && borderline) {
      checks.push({
        kind: "significance_wording",
        status: "not_checkable",
        detail: `The wording (${label}) rests on a p-value of exactly 0.05, which is borderline after rounding.`,
        quotes,
      });
    } else if (signals.length > 0) {
      const agrees = signals.every((signal) => signal === expectSignificant);
      const mixed =
        signals.some((signal) => signal) && signals.some((signal) => !signal);
      checks.push({
        kind: "significance_wording",
        status: agrees
          ? "consistent"
          : mixed
            ? "not_checkable"
            : "inconsistent",
        detail: agrees
          ? `The wording (${label}) agrees with the reported statistics.`
          : mixed
            ? "The finding reports several results, some significant and some not, so the wording cannot be compared as a whole."
            : `The wording (${label}) disagrees with the reported statistics.`,
        quotes,
      });
    }
  }
  return checks;
}

function overall(checks: ConsistencyCheck[]): ConsistencyStatus {
  if (checks.some((check) => check.status === "inconsistent"))
    return "inconsistent";
  if (checks.some((check) => check.status === "consistent"))
    return "consistent";
  return "not_checkable";
}

/** Runs the checks for claims that report the paper's own findings. */
export function checkInternalConsistency(
  pages: Page[],
  claims: ExtractedClaim[],
): InternalConsistency {
  const results: ClaimConsistency[] = claims
    .filter((claim) => claim.type === "reported_finding")
    .map((claim) => {
      const checks = [
        ...statisticalChecks(claim, pages),
        ...valueChecks(claim, pages),
      ];
      return { claimId: claim.id, status: overall(checks), checks };
    });
  return {
    results,
    scope: "original_findings",
    method: "rule-based",
    version: CONSISTENCY_VERSION,
    disclaimer: CONSISTENCY_DISCLAIMER,
  };
}
