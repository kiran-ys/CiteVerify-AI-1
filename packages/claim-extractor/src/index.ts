import type { ExtractedClaim } from "@citeverify/shared";
import { classifySentence } from "./rules.ts";
import { type PageText, segmentPages } from "./segment.ts";

export { type Classification, classifySentence, hasCitation } from "./rules.ts";
export {
  type PageText,
  sectionKindForHeading,
  segmentPages,
} from "./segment.ts";

export const CLAIM_EXTRACTION_METHOD = "rule-based" as const;
export const CLAIM_EXTRACTOR_VERSION = "1.0.0";
export const DEFAULT_MAX_CLAIMS = 300;

export type ClaimExtractionResult = {
  claims: ExtractedClaim[];
  /** True when more candidates were found than `maxClaims` allowed. */
  truncated: boolean;
};

/**
 * Finds candidate scientific claims in a paper's extracted page text.
 *
 * Deterministic and offline: the same input always yields the same claims,
 * and every claim's text is a slice of the input page text. Claims are
 * candidates for human review, not verified statements.
 */
export function extractClaims(
  pages: PageText[],
  options: {
    maxClaims?: number;
    /** In-text citation markers found from PDF layout (e.g. superscripts), by page. */
    citationSpans?: { page: number; start: number; end: number }[];
  } = {},
): ClaimExtractionResult {
  const maxClaims = options.maxClaims ?? DEFAULT_MAX_CLAIMS;
  const spans = options.citationSpans ?? [];
  const sentences = segmentPages(
    pages.map((page) => ({
      ...page,
      citations: [
        ...(page.citations ?? []),
        ...spans.filter((span) => span.page === page.page),
      ],
    })),
  );
  const claims: ExtractedClaim[] = [];
  let truncated = false;

  for (const [index, sentence] of sentences.entries()) {
    const result = classifySentence(
      sentence.text,
      sentence.sectionKind,
      sentence.complete,
      sentence.citationMarker,
    );
    if (!result.accepted) continue;
    if (claims.length >= maxClaims) {
      truncated = true;
      break;
    }

    const previous = sentences[index - 1];
    const next = sentences[index + 1];
    claims.push({
      id: `claim-${String(claims.length + 1).padStart(3, "0")}`,
      text: sentence.text,
      page: sentence.page,
      location: { start: sentence.start, end: sentence.end },
      section: sentence.section,
      context: {
        before: previous?.page === sentence.page ? previous.text : null,
        after: next?.page === sentence.page ? next.text : null,
      },
      type: result.type,
      extraction: {
        method: CLAIM_EXTRACTION_METHOD,
        version: CLAIM_EXTRACTOR_VERSION,
        signals: result.signals,
      },
    });
  }
  return { claims, truncated };
}
