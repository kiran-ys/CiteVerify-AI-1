/**
 * Finds the paper's reference list and splits it into entries, keeping each
 * entry's exact text and page provenance.
 */
import {
  collapse,
  furnitureDetector,
  type Line,
  type PageText,
  splitLines,
} from "./text.ts";

export type RawReference = {
  number: number | null;
  text: string;
  page: number;
  pageEnd: number;
  location: { start: number; end: number } | null;
};

export type ReferenceList = {
  found: boolean;
  page: number | null;
  style: "numbered" | "author-year" | null;
  entries: RawReference[];
  /** Where the list begins and ends, so citation scanning can skip it. */
  span: {
    startPage: number;
    startOffset: number;
    endPage: number;
    endOffset: number;
  } | null;
};

const REFERENCE_HEADING =
  /^(?:(?:\d+|[IVX]+)\.?\s+)?(?:references(?: and notes)?|bibliography|literature cited|works cited|reference list|cited literature)\s*:?$/i;

/** Headings that commonly follow the reference list. */
const END_HEADING =
  /^(?:(?:[A-Z]|\d+|[IVX]+)[.:]?\s+)?(?:appendix|appendices|supplementary|supplemental|acknowledge?ments?|author contributions?|conflicts? of interest|competing interests?|declaration of competing|funding|data availability|biograph(?:y|ies)|about the authors?)\b/i;

/** "[12] ...", "12. ...", or "12 Smith ..." at the start of a line. */
const NUMBERED_START =
  /^\s*(?:\[(\d{1,4})\]|(\d{1,4})\.(?=\s)|(\d{1,4})(?=\s+[A-Z]))/;

/** "Smith, J." / "Smith J," / "van der Berg, A." / "Smith, John" at the start of a line. */
const AUTHOR_START =
  /^\s*(?:(?:van|von|de|der|den|da|di|du|le|la|del)\s+)*[A-Z][A-Za-zÀ-ɏ'’-]+(?:\s+[A-Z][A-Za-zÀ-ɏ'’-]+)?(?:,?\s+(?:[A-Z]\.|[A-Z]{1,3}[,.\s])|,\s+[A-Z][a-z]+,)/;

/** Full-name style common in machine-learning papers: "John Smith, Jane Doe, and ..." or "John A. Smith and ...". */
const FULL_NAME_START =
  /^\s*[A-Z][a-zà-ɏ'’-]+(?:\s+[A-Z]\.)?(?:\s+(?:van|von|de|der|den|da|di|du|le|la|del))*\s+[A-Z][A-Za-zÀ-ɏ'’-]+(?:,\s+[A-Z][a-z]|\s+and\s+[A-Z]|\.\s+[A-Z][a-z])/;

const ENTRY_END = /(?:[.)\]]|\b10\.\d{4,9}\/\S+|https?:\/\/\S+)\s*$/;

function numberOf(line: string): number | null {
  const match = NUMBERED_START.exec(line);
  if (!match) return null;
  return Number(match[1] ?? match[2] ?? match[3]);
}

function isHeading(line: string, pattern: RegExp): boolean {
  const trimmed = line.trim();
  return trimmed.length > 0 && trimmed.length <= 80 && pattern.test(trimmed);
}

/** Lines of the reference list, from just after its heading to the next end heading. */
function referenceLines(
  pages: PageText[],
): { heading: Line; lines: Line[] } | null {
  const isFurniture = furnitureDetector(pages);
  const all = pages.flatMap((page) => splitLines(page));
  let headingIndex = -1;
  for (const [index, line] of all.entries()) {
    if (isHeading(line.text, REFERENCE_HEADING)) headingIndex = index;
  }
  if (headingIndex === -1) return null;

  const heading = all[headingIndex] as Line;
  const lines: Line[] = [];
  for (const line of all.slice(headingIndex + 1)) {
    if (isHeading(line.text, END_HEADING)) break;
    if (line.text.trim().length === 0 || isFurniture(line.text)) continue;
    lines.push(line);
  }
  return { heading, lines };
}

/** Numbered entries must count up from the first number, one at a time. */
function splitNumbered(lines: Line[]): Line[][] | null {
  const firstIndex = lines.findIndex((line) => numberOf(line.text) !== null);
  if (firstIndex === -1) return null;
  let expected = numberOf(lines[firstIndex]?.text ?? "") ?? 1;
  if (expected > 1) return null;

  const groups: Line[][] = [];
  for (const line of lines.slice(firstIndex)) {
    if (numberOf(line.text) === expected) {
      groups.push([line]);
      expected++;
    } else {
      groups.at(-1)?.push(line);
    }
  }
  return groups.length >= 2 ? groups : null;
}

function splitAuthorYear(lines: Line[]): Line[][] {
  const groups: Line[][] = [];
  for (const line of lines) {
    const previous = groups.at(-1)?.at(-1);
    const startsEntry =
      (AUTHOR_START.test(line.text) || FULL_NAME_START.test(line.text)) &&
      (previous === undefined || ENTRY_END.test(previous.text.trim()));
    if (startsEntry || groups.length === 0) groups.push([line]);
    else groups.at(-1)?.push(line);
  }
  return groups;
}

function toReference(
  group: Line[],
  pages: PageText[],
  numbered: boolean,
): RawReference {
  const first = group[0] as Line;
  const last = group.at(-1) as Line;
  const pieces = group.map((line) => line.text);
  const text = collapse(pieces.join("\n"));
  const samePage = first.page === last.page;
  const start =
    first.start + (first.text.length - first.text.trimStart().length);
  const pageText = pages.find((page) => page.page === first.page)?.text ?? "";
  // Only report offsets when the slice really reproduces the entry text.
  const location =
    samePage && collapse(pageText.slice(start, last.end)) === text
      ? { start, end: last.end }
      : null;
  return {
    number: numbered ? numberOf(first.text) : null,
    text,
    page: first.page,
    pageEnd: last.page,
    location,
  };
}

export function findReferenceList(pages: PageText[]): ReferenceList {
  const section = referenceLines(pages);
  if (!section || section.lines.length === 0) {
    return { found: false, page: null, style: null, entries: [], span: null };
  }

  const numbered = splitNumbered(section.lines);
  const groups = numbered ?? splitAuthorYear(section.lines);
  const lastLine = section.lines.at(-1) as Line;
  return {
    found: true,
    page: section.heading.page,
    style: numbered ? "numbered" : "author-year",
    entries: groups.map((group) =>
      toReference(group, pages, numbered !== null),
    ),
    span: {
      startPage: section.heading.page,
      startOffset: section.heading.start,
      endPage: lastLine.page,
      endOffset: lastLine.end,
    },
  };
}
