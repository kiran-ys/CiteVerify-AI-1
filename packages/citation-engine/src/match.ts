/**
 * Resolves each cited item to reference entries. Exactly one candidate is a
 * match; zero is unmatched and several is ambiguous. It never picks between
 * candidates.
 */
import type { CitationMatch, ReferenceEntry } from "@citeverify/shared";
import type { CitedItem } from "./intext.ts";
import { escapeRegExp, foldName } from "./text.ts";

export type MatchContext = {
  references: ReferenceEntry[];
  listFound: boolean;
  listStyle: "numbered" | "author-year" | null;
};

function result(
  key: string,
  candidates: ReferenceEntry[],
  noneReason: string,
  manyReason: string,
): CitationMatch {
  if (candidates.length === 1) {
    return {
      key,
      status: "matched",
      referenceIds: [candidates[0]?.id ?? ""],
      reason: null,
    };
  }
  if (candidates.length === 0) {
    return { key, status: "unmatched", referenceIds: [], reason: noneReason };
  }
  return {
    key,
    status: "ambiguous",
    referenceIds: candidates.map((reference) => reference.id),
    reason: manyReason,
  };
}

function hasWord(haystack: string, word: string): boolean {
  return new RegExp(
    `(?:^|[^a-z])${escapeRegExp(foldName(word))}(?:[^a-z]|$)`,
  ).test(foldName(haystack));
}

/** Text that names the authors: parsed names, or the entry text before its year. */
function authorText(reference: ReferenceEntry): string {
  if (reference.metadata.authors.length > 0)
    return reference.metadata.authors.join("; ");
  const yearIndex = reference.metadata.year
    ? reference.text.indexOf(reference.metadata.year)
    : -1;
  return reference.text.slice(
    0,
    yearIndex > 0 ? Math.min(yearIndex, 300) : 300,
  );
}

function firstAuthorText(reference: ReferenceEntry): string {
  return reference.metadata.authors[0] ?? reference.text.slice(0, 60);
}

function yearMatches(cited: string, reference: string | null): boolean {
  if (!reference) return false;
  if (/[a-z]$/.test(cited)) return cited === reference;
  return reference.replace(/[a-z]$/, "") === cited;
}

export function matchItem(
  item: CitedItem,
  context: MatchContext,
): CitationMatch {
  if (!context.listFound) {
    return {
      key: item.key,
      status: "unmatched",
      referenceIds: [],
      reason: "No reference list was found in the extracted text.",
    };
  }

  if (item.kind === "number") {
    if (context.listStyle !== "numbered") {
      return {
        key: item.key,
        status: "unmatched",
        referenceIds: [],
        reason:
          "The reference list is not numbered, so a numbered citation cannot be matched.",
      };
    }
    const candidates = context.references.filter(
      (reference) => reference.number === item.number,
    );
    return result(
      item.key,
      candidates,
      `No reference entry is numbered ${item.number}.`,
      `${candidates.length} reference entries are numbered ${item.number}.`,
    );
  }

  const [firstSurname, ...otherSurnames] = item.surnames;
  const candidates = context.references.filter(
    (reference) =>
      yearMatches(item.year, reference.metadata.year) &&
      firstSurname !== undefined &&
      hasWord(firstAuthorText(reference), firstSurname) &&
      otherSurnames.every((surname) => hasWord(authorText(reference), surname)),
  );
  return result(
    item.key,
    candidates,
    `No reference entry has first author ${firstSurname} and year ${item.year}.`,
    `${candidates.length} reference entries match ${item.key}; the citation does not identify which one.`,
  );
}
