/**
 * Citation extraction and matching for one paper's extracted text.
 *
 * Deterministic and offline. A "matched" citation means only that an in-text
 * marker points to a reference entry in the same paper; it says nothing about
 * whether the cited source supports any claim.
 */
import type {
  ExtractCitationsResponse,
  ExtractedClaim,
  InTextCitation,
  ReferenceEntry,
} from "@citeverify/shared";
import { findCitationsOnPage, type RawCitation } from "./intext.ts";
import { matchItem } from "./match.ts";
import { parseMetadata } from "./metadata.ts";
import { findReferenceList } from "./references.ts";
import type { PageText } from "./text.ts";

export { findCitationsOnPage, MAX_RANGE } from "./intext.ts";
export { matchItem } from "./match.ts";
export { parseMetadata, splitAuthors } from "./metadata.ts";
export { findReferenceList } from "./references.ts";
export type { PageText } from "./text.ts";

export const CITATION_METHOD = "rule-based" as const;
export const CITATION_ENGINE_VERSION = "1.0.0";
export const MAX_REFERENCES = 1000;
export const MAX_CITATIONS = 2000;

export type CitationResult = ExtractCitationsResponse["citations"];

function claimFor(
  citation: RawCitation,
  claims: ExtractedClaim[],
): string | null {
  const claim = claims.find(
    (candidate) =>
      candidate.page === citation.page &&
      citation.start >= candidate.location.start &&
      citation.end <= candidate.location.end,
  );
  return claim?.id ?? null;
}

/** Character spans on each page that belong to the reference list. */
function excludedSpans(
  pages: PageText[],
  span: NonNullable<ReturnType<typeof findReferenceList>["span"]> | null,
): Map<number, [number, number][]> {
  const spans = new Map<number, [number, number][]>();
  if (!span) return spans;
  for (const page of pages) {
    if (page.page < span.startPage || page.page > span.endPage) continue;
    const start = page.page === span.startPage ? span.startOffset : 0;
    const end = page.page === span.endPage ? span.endOffset : page.text.length;
    spans.set(page.page, [[start, end]]);
  }
  return spans;
}

export function extractCitations(
  pages: PageText[],
  claims: ExtractedClaim[] = [],
): CitationResult {
  const list = findReferenceList(pages);
  const references: ReferenceEntry[] = list.entries
    .slice(0, MAX_REFERENCES)
    .map((entry, index) => ({
      id: `ref-${String(index + 1).padStart(3, "0")}`,
      number: entry.number,
      text: entry.text,
      page: entry.page,
      pageEnd: entry.pageEnd,
      location: entry.location,
      metadata: parseMetadata(entry.text),
    }));

  const excluded = excludedSpans(pages, list.span);
  const raw = pages.flatMap((page) =>
    findCitationsOnPage(page, excluded.get(page.page) ?? []),
  );
  const context = { references, listFound: list.found, listStyle: list.style };

  const inText: InTextCitation[] = raw
    .slice(0, MAX_CITATIONS)
    .map((citation, index) => ({
      id: `cit-${String(index + 1).padStart(3, "0")}`,
      marker: citation.marker,
      style: citation.style,
      page: citation.page,
      location: { start: citation.start, end: citation.end },
      claimId: claimFor(citation, claims),
      matches: citation.items.map((item) => matchItem(item, context)),
    }));

  return {
    referenceList: { found: list.found, page: list.page, style: list.style },
    references,
    inText,
    method: CITATION_METHOD,
    version: CITATION_ENGINE_VERSION,
    truncated:
      list.entries.length > MAX_REFERENCES || raw.length > MAX_CITATIONS,
    evidenceStatus: "not_verified",
  };
}
