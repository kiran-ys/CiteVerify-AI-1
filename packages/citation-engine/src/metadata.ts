/**
 * Reads authors, year, title, and DOI from one reference entry's own text.
 * Fields that cannot be located with confidence are returned as empty/null;
 * nothing is looked up, completed, or corrected.
 */
import type { BibliographicMetadata } from "@citeverify/shared";

const LEADING_NUMBER = /^\s*(?:\[\d{1,4}\]|\d{1,4}\.?)\s+/;
const DOI = /\b(10\.\d{4,9}\/[^\s"<>]+)/i;
const YEAR = /\b((?:19|20)\d{2}[a-z]?)\b/;
const PAREN_YEAR = /\(((?:19|20)\d{2}[a-z]?)(?:,[^)]*)?\)/;
const QUOTED_TITLE = /[“"]([^”"]{8,400}?)[,.]?[”"]/;
const INITIALS = /^(?:[A-Z]\.?\s?-?){1,4}$/;

function cleanDoi(raw: string): string {
  return raw.replace(/[.,;:)\]]+$/, "");
}

/** Splits an author segment into names, keeping each name as written. */
export function splitAuthors(segment: string): string[] {
  const trimmed = segment
    .replace(/\bet al\.?/i, "")
    .replace(/[,;\s]+$/, "")
    .trim();
  if (!trimmed) return [];

  const tokens = trimmed
    .split(/\s*;\s*|,\s*(?:&\s*|and\s+)?|\s+(?:&|and)\s+/)
    .map((token) => token.trim())
    .filter(Boolean);

  // "Smith, J. A., Lee, K." splits into surname and initials tokens: rejoin them.
  const names: string[] = [];
  for (const token of tokens) {
    if (INITIALS.test(token) && names.length > 0) {
      names[names.length - 1] = `${names[names.length - 1]}, ${token}`;
    } else {
      names.push(token);
    }
  }
  // An author name has at most a handful of words; anything longer is not one.
  if (names.some((name) => name.split(/\s+/).length > 5)) return [];
  return names.slice(0, 50);
}

function titleFrom(text: string): string | null {
  const title = text
    .replace(/^[\s.,:]+/, "")
    .replace(/[\s.,]+$/, "")
    .trim();
  return title.length >= 10 && /\s/.test(title) ? title : null;
}

/** Sentence up to the next ". ", "? ", or "! " boundary. */
function firstSentence(text: string): string {
  const match = /^(.+?[.?!])(?=\s+[A-Z0-9(]|\s*$)/.exec(text.trim());
  return match?.[1] ?? text;
}

export function parseMetadata(entry: string): BibliographicMetadata {
  const body = entry.replace(LEADING_NUMBER, "");
  const doiMatch = DOI.exec(body);
  const doi = doiMatch?.[1] ? cleanDoi(doiMatch[1]) : null;
  const withoutDoi = doiMatch ? body.replace(doiMatch[0], " ") : body;

  // IEEE style: A. Author, B. Author, "Title," Venue, 2020.
  const quoted = QUOTED_TITLE.exec(withoutDoi);
  if (quoted && quoted.index > 0) {
    return {
      authors: splitAuthors(withoutDoi.slice(0, quoted.index)),
      year:
        YEAR.exec(withoutDoi.slice(quoted.index))?.[1] ??
        YEAR.exec(withoutDoi)?.[1] ??
        null,
      title: titleFrom(quoted[1] ?? ""),
      doi,
    };
  }

  // APA / Harvard: Author, A., & Author, B. (2020). Title. Journal ...
  const paren = PAREN_YEAR.exec(withoutDoi);
  if (paren && paren.index > 0 && paren.index < 400) {
    const after = withoutDoi.slice(paren.index + paren[0].length);
    return {
      authors: splitAuthors(withoutDoi.slice(0, paren.index)),
      year: paren[1] ?? null,
      title: titleFrom(firstSentence(after.replace(/^[\s.]+/, ""))),
      doi,
    };
  }

  // Vancouver: Author AB, Author C. Title. Journal. 2009;301(19):2024-35.
  const vancouver =
    /^((?:[^.]*?\b[A-Z]{1,3}\b,\s*)*[^.]*?\b[A-Z]{1,3})\.\s+(.+)$/.exec(
      withoutDoi,
    );
  if (vancouver?.[1] && vancouver[2]) {
    return {
      authors: splitAuthors(vancouver[1]),
      year: YEAR.exec(vancouver[2])?.[1] ?? null,
      title: titleFrom(firstSentence(vancouver[2])),
      doi,
    };
  }

  return {
    authors: [],
    year: YEAR.exec(withoutDoi)?.[1] ?? null,
    title: null,
    doi,
  };
}
