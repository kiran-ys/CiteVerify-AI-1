/**
 * Decides whether a record returned by a scholarly service is the work a
 * reference entry describes. Deliberately strict: a search engine's top hit
 * is not accepted unless its title, year, and first author agree with the
 * reference text.
 */
import type { ReferenceEntry, ResolvedWork } from "@citeverify/shared";
import { TAG } from "./text.ts";

export function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(TAG, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(text: string): Set<string> {
  return new Set(
    normalize(text)
      .split(" ")
      .filter((token) => token.length > 1),
  );
}

export function titleSimilarity(a: string, b: string): number {
  const left = tokens(a);
  const right = tokens(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared++;
  return shared / (left.size + right.size - shared);
}

export function normalizeDoi(doi: string): string {
  return doi
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .toLowerCase();
}

export type IdentityCheck = { ok: true } | { ok: false; reason: string };

/** Surname is the last word of a display name such as "John P. A. Ioannidis". */
function surnameOf(name: string): string {
  const cleaned = name.includes(",") ? (name.split(",")[0] ?? name) : name;
  const parts = normalize(cleaned).split(" ").filter(Boolean);
  return name.includes(",") ? (parts.join(" ") ?? "") : (parts.at(-1) ?? "");
}

/** Volume and first page from a service record, used to tell reprints apart. */
export type Pagination = { volume: string | null; firstPage: string | null };

const compact = (text: string) => normalize(text).replace(/ /g, "");

/** Letters, replies, and notices whose titles echo the article they respond to. */
const NOTICE_PREFIX =
  /^(?:re|response|reply|in reply|correction|erratum|corrigendum|retraction|retracted|comment|comments on|letter)\b/;

function titleMatches(reference: ReferenceEntry, candidate: string): boolean {
  const parsed = reference.metadata.title;
  if (
    NOTICE_PREFIX.test(normalize(candidate)) &&
    !(parsed && NOTICE_PREFIX.test(normalize(parsed)))
  ) {
    return false;
  }
  if (parsed) {
    // The whole title must match; a shorter title inside it (often a letter) does not count.
    // Comparing without spaces tolerates PDF ligature splits such as "confl icts".
    // A cited title may omit the record's subtitle ("Title" vs "Title? Subtitle"), so the
    // cited title may be the start of the record's title, never the other way round.
    const citedWords = normalize(parsed);
    const startsRecordTitle =
      citedWords.split(" ").length >= 4 &&
      `${normalize(candidate)} `.startsWith(`${citedWords} `);
    return (
      compact(parsed) === compact(candidate) ||
      startsRecordTitle ||
      titleSimilarity(parsed, candidate) >= 0.85
    );
  }
  return ` ${normalize(reference.text)} `.includes(` ${normalize(candidate)} `);
}

/** True when the reference text gives volume/page numbers such as "322: 226" or "44(3):187". */
function hasPagination(referenceText: string): boolean {
  return /\b\d{1,4}\s*(?:\(\s*[\w-]+\s*\))?\s*:\s*[a-z]?\d+/i.test(
    referenceText,
  );
}

function mentions(referenceText: string, value: string): boolean {
  return new RegExp(
    `(?:^|[^0-9a-z])${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[^0-9a-z]|$)`,
    "i",
  ).test(referenceText);
}

/** Both the volume and the first page of the record appear in the reference text. */
export function paginationMatches(
  reference: ReferenceEntry,
  pagination: Pagination,
): boolean {
  return Boolean(
    pagination.volume &&
      pagination.firstPage &&
      mentions(reference.text, pagination.volume) &&
      mentions(reference.text, pagination.firstPage),
  );
}

export function checkIdentity(
  reference: ReferenceEntry,
  work: ResolvedWork,
  pagination: Pagination = { volume: null, firstPage: null },
): IdentityCheck {
  const referenceText = normalize(reference.text);
  if (normalize(work.title).split(" ").length < 3) {
    return {
      ok: false,
      reason: "The service record has no usable title to compare.",
    };
  }
  if (!titleMatches(reference, work.title)) {
    return {
      ok: false,
      reason: `The service title "${work.title}" does not match the reference's title.`,
    };
  }

  const referenceYear = Number(reference.metadata.year?.slice(0, 4));
  const workYear = Number(work.year?.slice(0, 4));
  if (referenceYear && workYear && Math.abs(referenceYear - workYear) > 1) {
    return {
      ok: false,
      reason: `The service record is from ${workYear}, but the reference gives ${referenceYear}.`,
    };
  }

  const firstAuthor = work.authors[0];
  if (firstAuthor) {
    const surname = surnameOf(firstAuthor);
    if (
      surname &&
      !` ${referenceText} `.includes(` ${surname} `) &&
      !compact(reference.text).includes(surname.replace(/ /g, ""))
    ) {
      return {
        ok: false,
        reason: `The service record's first author (${firstAuthor}) is not named in the reference entry.`,
      };
    }
  }

  // A reprint in another journal has the same title and authors but different pages.
  if (
    pagination.firstPage &&
    hasPagination(reference.text) &&
    !mentions(reference.text, pagination.firstPage)
  ) {
    return {
      ok: false,
      reason: `The service record starts on page ${pagination.firstPage}, which the reference does not give.`,
    };
  }
  return { ok: true };
}
