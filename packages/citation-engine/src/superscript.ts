/**
 * Numeric citations typeset as superscripts (e.g. "risk factors¹⁻³").
 *
 * Text extraction flattens these into digits glued to the preceding word
 * ("factors1–3", "menopause.56"), which cannot be split reliably from text
 * alone. The parser instead reports superscript runs from the PDF layout,
 * with the separately typeset pieces ("5", "6"). This module turns those
 * runs into citations and skips superscripts that are not citations:
 * author-affiliation marks in the front matter, unit exponents (kg/m²),
 * statistic symbols (χ², r²), and scientific notation (10⁻³).
 */
import type { SuperscriptRun } from "@citeverify/shared";
import type { CitedItem, RawCitation } from "./intext.ts";
import type { PageText } from "./text.ts";

const DASH = /^[-‐‑‒–—]$/;
const CITATION_CHARS = /^[\d,\s\-‐-—]+$/;
const MAX_RANGE = 50;

/** Units whose exponents are typeset as superscripts. */
const UNIT_BEFORE =
  /(?:^|[\s\d/(·×])(?:m|cm|mm|km|nm|µm|μm|g|kg|mg|µg|μg|s|ms|min|h|ft|in|mL|ml|L|l|m\/s)$/;
/** Symbols and notation followed by a power, not a citation. */
const SYMBOL_BEFORE =
  /(?:^|[\s(=,;])(?:χ|chi|r|R|R²|x|X|e|σ|η|ω|SD|df)$|(?:×|x|\s)10$/;

const FRONT_MATTER_END =
  /^\s*(?:abstract|summary|introduction|background|keywords?)\b/im;

/** Where the body starts: the first Abstract/Introduction-style heading. */
export function bodyStart(
  pages: PageText[],
): { page: number; offset: number } | null {
  for (const page of pages) {
    const match = FRONT_MATTER_END.exec(page.text);
    if (match) return { page: page.page, offset: match.index };
  }
  return null;
}

/** Splits typeset pieces into cited numbers; null when the run is not a readable citation. */
export function superscriptNumbers(parts: string[]): number[] | null {
  const tokens: string[] = [];
  for (const part of parts) {
    for (const token of part.split(/([,\-‐-—])/)) {
      if (token.trim()) tokens.push(token.trim());
    }
  }
  const numbers: number[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index] ?? "";
    if (token === ",") continue;
    if (!/^\d{1,3}$/.test(token)) return null;
    const value = Number(token);
    if (value < 1) return null;
    const dash = tokens[index + 1];
    const next = tokens[index + 2];
    if (dash && DASH.test(dash) && next && /^\d{1,3}$/.test(next)) {
      const to = Number(next);
      if (to <= value || to - value >= MAX_RANGE) return null;
      for (let n = value; n <= to; n++) numbers.push(n);
      index += 2;
    } else if (dash && DASH.test(dash)) {
      return null;
    } else {
      numbers.push(value);
    }
  }
  return numbers.length > 0 ? [...new Set(numbers)] : null;
}

export type SkipReason =
  | "front_matter"
  | "not_numeric"
  | "exponent"
  | "unreadable";

export function classifySuperscript(
  page: PageText,
  run: SuperscriptRun,
  body: { page: number; offset: number } | null,
): { citation: number[] } | { skip: SkipReason } {
  if (
    body &&
    (page.page < body.page ||
      (page.page === body.page && run.start < body.offset))
  ) {
    return { skip: "front_matter" };
  }
  const joined = run.parts.join("");
  if (!CITATION_CHARS.test(joined) || !/\d/.test(joined))
    return { skip: "not_numeric" };
  const before = page.text.slice(Math.max(0, run.start - 12), run.start);
  if (UNIT_BEFORE.test(before) || SYMBOL_BEFORE.test(before))
    return { skip: "exponent" };
  const numbers = superscriptNumbers(run.parts);
  return numbers ? { citation: numbers } : { skip: "unreadable" };
}

export function findSuperscriptCitations(
  page: PageText & { superscripts?: SuperscriptRun[] },
  body: { page: number; offset: number } | null,
  excluded: [number, number][] = [],
): RawCitation[] {
  const found: RawCitation[] = [];
  for (const run of page.superscripts ?? []) {
    if (excluded.some(([start, end]) => run.start >= start && run.start < end))
      continue;
    const result = classifySuperscript(page, run, body);
    if (!("citation" in result)) continue;
    const items: CitedItem[] = result.citation.map((number) => ({
      kind: "number",
      number,
      key: String(number),
    }));
    found.push({
      marker: page.text.slice(run.start, run.end),
      style: "superscript",
      page: page.page,
      start: run.start,
      end: run.end,
      items,
    });
  }
  return found;
}
