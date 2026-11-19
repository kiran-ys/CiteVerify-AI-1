/**
 * Builds page text from pdf.js text items and records superscript runs.
 *
 * The text is joined exactly as unpdf's extractText does (each item's string,
 * plus "\n" when the item ends a line), so offsets match the page text that
 * the rest of the pipeline already uses. Superscripts are identified from
 * layout only: a smaller glyph height on a raised baseline relative to the
 * preceding body text on the same line. Nothing is inferred from digits
 * that merely touch a word.
 */
import type { SuperscriptRun } from "@citeverify/shared";

export type LayoutItem = {
  str: string;
  hasEOL: boolean;
  height: number;
  /** pdf.js transform matrix; [4] is x, [5] is the baseline y. */
  transform: number[];
};

/** A superscript is at most 85% of the body height... */
const MAX_HEIGHT_RATIO = 0.85;
/** ...and its baseline sits at least 15% of the body height higher, but on the same line. */
const MIN_RISE_RATIO = 0.15;

function isBody(item: LayoutItem): boolean {
  return item.str.trim().length > 0 && item.height > 0;
}

export function isSuperscriptOf(item: LayoutItem, body: LayoutItem): boolean {
  if (!isBody(item)) return false;
  const rise = (item.transform[5] ?? 0) - (body.transform[5] ?? 0);
  return (
    item.height <= body.height * MAX_HEIGHT_RATIO &&
    rise >= body.height * MIN_RISE_RATIO &&
    rise < body.height
  );
}

function sameLine(item: LayoutItem, body: LayoutItem): boolean {
  return (
    Math.abs((item.transform[5] ?? 0) - (body.transform[5] ?? 0)) < body.height
  );
}

/** The next body item on the same line, looking a few items ahead. */
function nextBodyOnLine(items: LayoutItem[], index: number): LayoutItem | null {
  const item = items[index];
  if (!item) return null;
  for (const candidate of items.slice(index + 1, index + 8)) {
    if (!isBody(candidate) || candidate.height <= item.height) continue;
    return sameLine(item, candidate) ? candidate : null;
  }
  return null;
}

const CITATION_LIKE = /^[\d,\s\-\u2010-\u2014]+$/;

type Placed = { item: LayoutItem; start: number; end: number };

/**
 * A wrapped superscript: small citation-like digits alone on a line directly
 * below a body line (e.g. "training." then "14 16 17" on the next line).
 * Narrow on purpose so table rows of small numbers do not qualify.
 */
function orphanSuperscriptLine(
  line: Placed[],
  body: LayoutItem | null,
): SuperscriptRun | null {
  const pieces = line.filter((placed) => placed.item.str.trim().length > 0);
  if (!body || pieces.length === 0 || pieces.length > 6) return null;
  const xs = pieces.map((placed) => placed.item.transform[4] ?? 0);
  const drop = (body.transform[5] ?? 0) - (pieces[0]?.item.transform[5] ?? 0);
  const ok =
    pieces.every(
      (placed) =>
        placed.item.height > 0 &&
        placed.item.height <= body.height * MAX_HEIGHT_RATIO &&
        CITATION_LIKE.test(placed.item.str),
    ) &&
    Math.max(...xs) - Math.min(...xs) <= 40 &&
    drop > 0 &&
    drop <= body.height * 1.6;
  const first = pieces[0];
  const last = pieces.at(-1);
  return ok && first && last
    ? {
        start: first.start,
        end: last.end,
        parts: pieces.map((placed) => placed.item.str),
      }
    : null;
}

export type PageLayout = { text: string; superscripts: SuperscriptRun[] };

/** Page text (trimmed, as before) and its superscript runs with offsets into that text. */
export function layoutPage(items: LayoutItem[]): PageLayout {
  let raw = "";
  const runs: SuperscriptRun[] = [];
  let body: LayoutItem | null = null;
  let current: SuperscriptRun | null = null;
  let line: Placed[] = [];
  let lineHasRun = false;
  let bodyBeforeLine: LayoutItem | null = null;

  for (const [index, item] of items.entries()) {
    const start = raw.length;
    raw += item.str;
    line.push({ item, start, end: raw.length });
    // Compare with the body text before it on the same line, or, at the start
    // of a page or line, the body text after it on the same line.
    const reference =
      body && sameLine(item, body)
        ? body
        : (nextBodyOnLine(items, index) ?? body);
    const superscript = reference !== null && isSuperscriptOf(item, reference);
    if (superscript) {
      lineHasRun = true;
      if (current && current.end === start) {
        current.end = raw.length;
        current.parts.push(item.str);
      } else {
        current = { start, end: raw.length, parts: [item.str] };
        runs.push(current);
      }
    } else {
      current = null;
      if (isBody(item)) body = item;
    }
    if (item.hasEOL) {
      raw += "\n";
      current = null;
      const hasBody = line.some(
        (placed) => isBody(placed.item) && !CITATION_LIKE.test(placed.item.str),
      );
      if (!lineHasRun && !hasBody) {
        const orphan = orphanSuperscriptLine(line, bodyBeforeLine);
        if (orphan) runs.push(orphan);
      }
      if (hasBody) bodyBeforeLine = body;
      line = [];
      lineHasRun = false;
    }
  }

  const text = raw.trim();
  const lead = raw.length - raw.trimStart().length;
  return {
    text,
    superscripts: runs
      .map((run) => ({ ...run, start: run.start - lead, end: run.end - lead }))
      .filter((run) => run.start >= 0 && run.end <= text.length),
  };
}
