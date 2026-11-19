/**
 * Turns per-page extracted text into sentences with exact page offsets.
 *
 * Nothing here rewrites text: every sentence is a slice of the original
 * page text, and offsets always point back into that page text.
 */

export type PageText = { page: number; text: string };

export type SectionKind =
  | "front"
  | "abstract"
  | "introduction"
  | "methods"
  | "results"
  | "discussion"
  | "conclusion"
  | "references"
  | "excluded"
  | "unknown";

export type Sentence = {
  page: number;
  start: number;
  end: number;
  /** Original slice with line breaks and whitespace runs collapsed. */
  text: string;
  section: string | null;
  sectionKind: SectionKind;
  /** False when the sentence is cut off by a page, column, or block edge. */
  complete: boolean;
};

type Line = { start: number; end: number; text: string };

const SECTION_NAMES: [Exclude<SectionKind, "front" | "unknown">, RegExp][] = [
  ["abstract", /^(abstract|summary)$/],
  [
    "introduction",
    /^(introduction|background|related work|literature review|overview)$/,
  ],
  [
    "methods",
    /^(methods?|materials and methods|methods and materials|methodology|experimental( section| procedures| setup| design)?|study design|data and methods|patients and methods|subjects and methods)$/,
  ],
  ["results", /^(results?|findings|results and discussion)$/],
  ["discussion", /^(discussion|general discussion)$/],
  [
    "conclusion",
    /^(conclusions?|concluding remarks|summary and conclusions?)$/,
  ],
  [
    "references",
    /^(references|bibliography|literature cited|works cited|reference list)$/,
  ],
  [
    "excluded",
    /^(acknowledge?ments?|funding( information| sources)?|author contributions?|conflicts? of interest|competing interests?|declaration of competing interests?|data availability( statement)?|ethics( statement| approval)?|abbreviations|keywords|supplementary (material|materials|information)|appendix( [a-z0-9]+)?)$/,
  ],
];

/** Optional numbering such as "2.", "2.1", "IV." before a heading label. */
const HEADING_NUMBER = /^(?:(?:\d+(?:\.\d+)*|[IVX]+)\.?\s+)?/;

/** Inline headings in structured abstracts, e.g. "Results: Mean age was ...". */
const INLINE_HEADING =
  /^(abstract|summary|background|introduction|methods?|results?|discussion|conclusions?)\s*[:.—–-]\s+(?=[A-Z0-9])/i;

const PAGE_NUMBER = /^(?:page\s*)?\d{1,4}(?:\s*(?:of|\/)\s*\d{1,4})?$/i;

const ABBREVIATIONS = new Set([
  "al",
  "fig",
  "figs",
  "eq",
  "eqs",
  "ref",
  "refs",
  "tab",
  "sec",
  "vs",
  "cf",
  "approx",
  "ca",
  "no",
  "nos",
  "vol",
  "pp",
  "dr",
  "prof",
  "mr",
  "mrs",
  "ms",
  "st",
  "inc",
  "ltd",
  "co",
  "jr",
  "sr",
  "resp",
  "incl",
  "suppl",
  "e.g",
  "i.e",
]);

function collapse(text: string): string {
  return text
    .replace(/-\n\s*/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

export function sectionKindForHeading(line: string): SectionKind | null {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > 80) return null;
  const original = trimmed.replace(HEADING_NUMBER, "").replace(/[:.]$/, "");
  // Headings start with a capital; "results." on its own line is wrapped prose.
  if (!/^[A-Z]/.test(original)) return null;
  const label = original.trim().toLowerCase();
  for (const [kind, pattern] of SECTION_NAMES) {
    if (pattern.test(label)) return kind;
  }
  return null;
}

function splitLines(text: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  for (let index = 0; index <= text.length; index++) {
    if (index === text.length || text[index] === "\n") {
      lines.push({ start, end: index, text: text.slice(start, index) });
      start = index + 1;
    }
  }
  return lines;
}

function repetitionKey(line: string): string {
  return line.trim().toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ");
}

/**
 * Lines that repeat on at least half of the pages (running heads, journal
 * footers, licence lines) are layout furniture, not prose.
 */
function findRepeatedLines(pages: PageText[]): Set<string> {
  const repeated = new Set<string>();
  if (pages.length < 3) return repeated;
  const pagesPerKey = new Map<string, number>();
  for (const page of pages) {
    const keys = new Set(
      splitLines(page.text)
        .map((line) => repetitionKey(line.text))
        .filter((key) => key.length > 0 && key.length <= 160),
    );
    for (const key of keys) {
      pagesPerKey.set(key, (pagesPerKey.get(key) ?? 0) + 1);
    }
  }
  const threshold = Math.max(2, Math.ceil(pages.length / 2));
  for (const [key, count] of pagesPerKey) {
    if (count >= threshold) repeated.add(key);
  }
  return repeated;
}

function isSentenceBoundary(text: string, periodIndex: number): boolean {
  if (text[periodIndex] !== ".") return true;
  const before = text.slice(0, periodIndex);
  const word = /(\S+)$/.exec(before)?.[1] ?? "";
  const bare = word.replace(/^[("[]+/, "").toLowerCase();
  if (ABBREVIATIONS.has(bare)) return false;
  // Initials ("J. Smith") and dotted abbreviations ("U.S.").
  if (/^[A-Z]$/.test(word)) return false;
  if (/^(?:[A-Za-z]\.)+[A-Za-z]$/.test(word)) return false;
  // "Figure 2. Mean ..." at the start of a line is one caption, not two sentences.
  if (
    /(?:^|\n)\s*(?:fig(?:ure)?s?|table|tab|scheme|box)\.?\s*S?\d+[a-z]?$/i.test(
      before,
    )
  ) {
    return false;
  }
  return true;
}

const BOUNDARY = /[.!?]["'”’)\]]*(?=\s+["'“‘([]?[A-Z0-9])/g;
const TERMINAL = /[.!?]["'”’)\]]*$/;

type Block = { start: number; end: number };

function splitBlock(
  pageText: string,
  block: Block,
): { start: number; end: number; complete: boolean }[] {
  const text = pageText.slice(block.start, block.end);
  const spans: { start: number; end: number; complete: boolean }[] = [];
  let cursor = 0;
  BOUNDARY.lastIndex = 0;
  for (
    let match = BOUNDARY.exec(text);
    match !== null;
    match = BOUNDARY.exec(text)
  ) {
    if (!isSentenceBoundary(text, match.index)) continue;
    const end = match.index + match[0].length;
    spans.push({ start: cursor, end, complete: true });
    cursor = end;
  }
  spans.push({
    start: cursor,
    end: text.length,
    complete: TERMINAL.test(text.trimEnd()),
  });

  return spans
    .map((span) => {
      const slice = text.slice(span.start, span.end);
      const leading = slice.length - slice.trimStart().length;
      const trailing = slice.length - slice.trimEnd().length;
      return {
        start: block.start + span.start + leading,
        end: block.start + span.end - trailing,
        complete: span.complete,
      };
    })
    .filter((span) => span.end > span.start)
    .map((span, index) => {
      // A block that opens mid-sentence continues text from an earlier
      // page or column; it cannot be attributed safely.
      const opensMidSentence =
        index === 0 && /^[a-z,;)]/.test(pageText.slice(span.start));
      return { ...span, complete: span.complete && !opensMidSentence };
    });
}

/** Splits every page into sentences, tracking the current section. */
export function segmentPages(pages: PageText[]): Sentence[] {
  const repeated = findRepeatedLines(pages);
  const hasHeadings = pages.some((page) =>
    splitLines(page.text).some(
      (line) => sectionKindForHeading(line.text) !== null,
    ),
  );
  let sectionKind: SectionKind = hasHeadings ? "front" : "unknown";
  let section: string | null = null;
  const sentences: Sentence[] = [];

  for (const page of pages) {
    let block = null as Block | null;
    let blockSection = section;
    let blockKind = sectionKind;

    const flush = () => {
      if (block) {
        for (const span of splitBlock(page.text, block)) {
          sentences.push({
            page: page.page,
            start: span.start,
            end: span.end,
            text: collapse(page.text.slice(span.start, span.end)),
            section: blockSection,
            sectionKind: blockKind,
            complete: span.complete,
          });
        }
      }
      block = null;
    };

    for (const line of splitLines(page.text)) {
      const trimmed = line.text.trim();
      const headingKind = sectionKindForHeading(trimmed);
      if (headingKind) {
        flush();
        sectionKind = headingKind;
        section = collapse(trimmed);
        continue;
      }
      if (
        trimmed.length === 0 ||
        PAGE_NUMBER.test(trimmed) ||
        repeated.has(repetitionKey(trimmed))
      ) {
        flush();
        continue;
      }

      let lineStart =
        line.start + (line.text.length - line.text.trimStart().length);
      const inline = INLINE_HEADING.exec(trimmed);
      if (inline && /^[A-Z]/.test(inline[1] ?? "")) {
        const kind = sectionKindForHeading(inline[1] ?? "");
        if (kind) {
          flush();
          sectionKind = kind;
          section = collapse(inline[1] ?? "");
          lineStart += inline[0].length;
        }
      }

      if (!block) {
        block = { start: lineStart, end: line.end };
        blockSection = section;
        blockKind = sectionKind;
      } else {
        block.end = line.end;
      }
    }
    flush();
  }
  return sentences;
}
