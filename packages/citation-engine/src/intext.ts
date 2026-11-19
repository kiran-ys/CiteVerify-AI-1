/**
 * Finds in-text citation markers and the cited items inside each marker.
 * Markers keep their exact text and page offsets.
 */
import type { PageText } from "./text.ts";

export type CitedItem =
  | { kind: "number"; number: number; key: string }
  | {
      kind: "author-year";
      surnames: string[];
      etAl: boolean;
      year: string;
      key: string;
    };

export type RawCitation = {
  marker: string;
  style: "numeric" | "author-year";
  page: number;
  start: number;
  end: number;
  items: CitedItem[];
};

/** Ranges wider than this are treated as unreadable rather than expanded. */
export const MAX_RANGE = 50;

const DASH = "-‐‑‒–—";
const NUMERIC_MARKER = new RegExp(
  `\\[\\s*\\d{1,3}(?:\\s*[${DASH}]\\s*\\d{1,3})?(?:\\s*[,;]\\s*\\d{1,3}(?:\\s*[${DASH}]\\s*\\d{1,3})?)*\\s*\\]`,
  "g",
);

const NAME =
  "(?:(?:van|von|de|der|den|da|di|du|le|la|del)\\s+)*[A-Z][A-Za-z\\u00c0-\\u024f'\\u2019-]+";
const AUTHORS = `(${NAME})(?:\\s+(et\\s+al\\.?)|\\s+(?:and|&)\\s+(${NAME}))?`;
const YEAR = "((?:19|20)\\d{2}[a-z]?)";

/** One author-year item inside parentheses: "Smith et al., 2020" or "Lee and Park 2019, 2021". */
const PAREN_ITEM = new RegExp(
  `^(?:(?:e\\.g\\.|i\\.e\\.|see|see also|cf\\.)[,\\s]+)?${AUTHORS},?\\s+${YEAR}((?:\\s*,\\s*(?:19|20)\\d{2}[a-z]?)*)\\s*$`,
);
const PAREN_GROUP = /\(([^()]{4,400})\)/g;
/** Narrative: Smith et al. (2020) / Lee and Park (2019) */
const NARRATIVE = new RegExp(`\\b${AUTHORS}\\s+\\(${YEAR}\\)`, "g");

function expandNumbers(body: string): number[] | null {
  const numbers: number[] = [];
  for (const part of body.split(/[,;]/)) {
    const range = new RegExp(
      `^\\s*(\\d{1,4})\\s*[${DASH}]\\s*(\\d{1,4})\\s*$`,
    ).exec(part);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (to <= from || to - from >= MAX_RANGE) return null;
      for (let value = from; value <= to; value++) numbers.push(value);
    } else {
      const value = Number(part.trim());
      if (!Number.isInteger(value) || value < 1) return null;
      numbers.push(value);
    }
  }
  return [...new Set(numbers)];
}

function authorYearItems(
  first: string,
  etAl: string | undefined,
  second: string | undefined,
  years: string[],
): CitedItem[] {
  const surnames = second ? [first, second] : [first];
  const names = second
    ? `${first} and ${second}`
    : etAl
      ? `${first} et al.`
      : first;
  return years.map((year) => ({
    kind: "author-year",
    surnames,
    etAl: Boolean(etAl),
    year,
    key: `${names}, ${year}`,
  }));
}

/** Capitalised words that precede a parenthesised year but are not authors. */
const NOT_AUTHORS = new Set(
  "In On At By For From Since Until During After Before Between The This These That Those Its Their Our We Table Figure Fig Eq Section Chapter Appendix Supplementary January February March April May June July August September October November December Spring Summer Autumn Fall Winter Version Release".split(
    " ",
  ),
);

function isAuthorName(name: string): boolean {
  return !NOT_AUTHORS.has(name);
}

function inSpans(index: number, spans: [number, number][]): boolean {
  return spans.some(([start, end]) => index >= start && index < end);
}

/** Finds citations on one page, ignoring the given excluded character spans. */
export function findCitationsOnPage(
  page: PageText,
  excluded: [number, number][] = [],
): RawCitation[] {
  const text = page.text;
  const found: RawCitation[] = [];

  for (const match of text.matchAll(NUMERIC_MARKER)) {
    const start = match.index ?? 0;
    if (inSpans(start, excluded)) continue;
    const numbers = expandNumbers(match[0].slice(1, -1));
    if (!numbers) continue;
    found.push({
      marker: match[0],
      style: "numeric",
      page: page.page,
      start,
      end: start + match[0].length,
      items: numbers.map((number) => ({
        kind: "number",
        number,
        key: String(number),
      })),
    });
  }

  for (const match of text.matchAll(PAREN_GROUP)) {
    const start = match.index ?? 0;
    if (inSpans(start, excluded)) continue;
    const body = (match[1] ?? "").replace(/\s+/g, " ");
    const items: CitedItem[] = [];
    for (const part of body.split(/\s*;\s*/)) {
      const item = PAREN_ITEM.exec(part.trim());
      if (!item?.[1] || !item[4] || !isAuthorName(item[1])) continue;
      const extraYears = (item[5] ?? "")
        .split(",")
        .map((year) => year.trim())
        .filter(Boolean);
      items.push(
        ...authorYearItems(item[1], item[2], item[3], [item[4], ...extraYears]),
      );
    }
    if (items.length === 0) continue;
    found.push({
      marker: match[0],
      style: "author-year",
      page: page.page,
      start,
      end: start + match[0].length,
      items,
    });
  }

  for (const match of text.matchAll(NARRATIVE)) {
    const start = match.index ?? 0;
    if (inSpans(start, excluded) || !match[1] || !match[4]) continue;
    if (!isAuthorName(match[1])) continue;
    found.push({
      marker: match[0],
      style: "author-year",
      page: page.page,
      start,
      end: start + match[0].length,
      items: authorYearItems(match[1], match[2], match[3], [match[4]]),
    });
  }

  // A marker that repeats an item ("[1, 1]", "(Lee, 2019; Lee, 2019)") cites it once.
  for (const citation of found) {
    const seen = new Set<string>();
    citation.items = citation.items.filter((item) => {
      if (seen.has(item.key)) return false;
      seen.add(item.key);
      return true;
    });
  }
  return found.sort((a, b) => a.start - b.start);
}
