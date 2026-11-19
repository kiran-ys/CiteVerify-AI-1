/**
 * Turns JATS full text and service abstracts into plain paragraphs, keeping
 * the source's own words. Markup is removed (and flagged), never rewritten.
 */

export type SourceParagraph = {
  section: string | null;
  /** 1-based position within the body or abstract. */
  paragraph: number;
  text: string;
  markupRemoved: boolean;
};

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (whole, code: string) => {
      if (code.startsWith("#x") || code.startsWith("#X"))
        return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
      if (code.startsWith("#"))
        return String.fromCodePoint(Number(code.slice(1)));
      return ENTITIES[code.toLowerCase()] ?? whole;
    },
  );
}

/**
 * A markup tag: "<" directly followed by a tag name (or "/" and a name),
 * with no "<" or ">" inside. Statistics such as "P<0.01 ... >50%" or
 * "P < 0.05" are not tags and must survive as exact source text.
 */
export const TAG = /<\/?[A-Za-z][\w:.-]*(?:\s[^<>]*)?\/?>/g;

/** Removes tags without inserting text; block boundaries become spaces. */
export function stripMarkup(xml: string): {
  text: string;
  markupRemoved: boolean;
} {
  const markupRemoved = new RegExp(TAG.source).test(xml);
  const text = decodeEntities(
    xml
      .replace(
        /<(?:\/p|\/list-item|\/title|\/h\d|br\s*\/?|break\s*\/?)>/gi,
        " ",
      )
      .replace(TAG, ""),
  )
    .replace(/\s+/g, " ")
    .trim();
  return { text, markupRemoved };
}

/** Non-prose blocks whose text should not be quoted as passages. */
const DROP_BLOCKS = [
  "fig",
  "table-wrap",
  "disp-formula",
  "supplementary-material",
  "ref-list",
  "fn-group",
];

function dropBlocks(xml: string): string {
  let result = xml;
  for (const tag of DROP_BLOCKS) {
    result = result.replace(
      new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}>`, "gi"),
      " ",
    );
  }
  return result;
}

/** Paragraphs of a JATS article body with their nearest section titles. */
export function jatsBodyParagraphs(xml: string): SourceParagraph[] {
  const bodyStart = xml.search(/<body\b/i);
  const bodyEnd = xml.search(/<\/body>/i);
  if (bodyStart === -1 || bodyEnd === -1) return [];
  const body = dropBlocks(xml.slice(bodyStart, bodyEnd));

  const paragraphs: SourceParagraph[] = [];
  const sectionTitles: (string | null)[] = [];
  let pDepth = 0;
  let pStart = 0;
  const tag = /<(\/?)(sec|title|p)\b[^>]*?(\/?)>/gi;
  for (let match = tag.exec(body); match !== null; match = tag.exec(body)) {
    const closing = match[1] === "/";
    const name = (match[2] ?? "").toLowerCase();
    if (match[3] === "/") continue;
    if (name === "sec") {
      if (closing) sectionTitles.pop();
      else sectionTitles.push(null);
    } else if (name === "title" && !closing && pDepth === 0) {
      const end = body.indexOf("</title>", tag.lastIndex);
      if (end !== -1 && sectionTitles.length > 0) {
        sectionTitles[sectionTitles.length - 1] =
          stripMarkup(body.slice(tag.lastIndex, end)).text || null;
      }
    } else if (name === "p") {
      if (!closing) {
        if (pDepth === 0) pStart = tag.lastIndex;
        pDepth++;
      } else if (pDepth > 0) {
        pDepth--;
        if (pDepth === 0) {
          const { text, markupRemoved } = stripMarkup(
            body.slice(pStart, match.index),
          );
          if (text) {
            paragraphs.push({
              section:
                [...sectionTitles].reverse().find((title) => title !== null) ??
                null,
              paragraph: paragraphs.length + 1,
              text,
              markupRemoved,
            });
          }
        }
      }
    }
  }
  return paragraphs;
}

/** Paragraphs of an abstract from Europe PMC (HTML) or Crossref (JATS). */
export function abstractParagraphs(abstract: string): SourceParagraph[] {
  const cleaned = abstract.replace(/<(\/?)jats:/g, "<$1");
  const parts: { section: string | null; xml: string }[] = [];
  const heading = /<(h\d|title)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let section: string | null = null;
  let cursor = 0;
  for (
    let match = heading.exec(cleaned);
    match !== null;
    match = heading.exec(cleaned)
  ) {
    parts.push({ section, xml: cleaned.slice(cursor, match.index) });
    const title = stripMarkup(match[2] ?? "").text;
    section = /^abstract$/i.test(title) ? null : title || null;
    cursor = heading.lastIndex;
  }
  parts.push({ section, xml: cleaned.slice(cursor) });

  const paragraphs: SourceParagraph[] = [];
  for (const part of parts) {
    const pieces = /<p\b/i.test(part.xml)
      ? [...part.xml.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(
          (m) => m[1] ?? "",
        )
      : [part.xml];
    for (const piece of pieces) {
      const { text, markupRemoved } = stripMarkup(piece);
      if (text) {
        paragraphs.push({
          section: part.section,
          paragraph: paragraphs.length + 1,
          text,
          markupRemoved,
        });
      }
    }
  }
  return paragraphs;
}

const ABBREVIATIONS = new Set([
  "al",
  "fig",
  "figs",
  "eq",
  "e.g",
  "i.e",
  "vs",
  "approx",
  "ref",
  "refs",
  "no",
  "ca",
  "cf",
]);

/** Splits a paragraph into sentences without altering any characters. */
export function splitSentences(text: string): string[] {
  const sentences: string[] = [];
  let start = 0;
  const boundary = /[.!?]["'”)\]]*\s+(?=["'“(\[]?[A-Z0-9])/g;
  for (
    let match = boundary.exec(text);
    match !== null;
    match = boundary.exec(text)
  ) {
    const word = (
      /(\S+)$/.exec(text.slice(start, match.index))?.[1] ?? ""
    ).toLowerCase();
    if (ABBREVIATIONS.has(word.replace(/^[(\[]+/, "")) || /^[a-z]$/i.test(word))
      continue;
    const sentence = text.slice(start, match.index + match[0].length).trim();
    if (sentence) sentences.push(sentence);
    start = match.index + match[0].length;
  }
  const rest = text.slice(start).trim();
  if (rest) sentences.push(rest);
  return sentences;
}
