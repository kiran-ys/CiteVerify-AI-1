/**
 * Selects source sentences that share key terms with a claim. The score is
 * lexical overlap only: it can surface relevant text for a human reviewer,
 * but it cannot tell whether the source supports or contradicts the claim.
 */
import type { EvidencePassage } from "@citeverify/shared";
import { type SourceParagraph, splitSentences } from "./text.ts";

const STOPWORDS = new Set(
  "the and for are was were with that this these those from into than then there their which while where when what who whom whose have has had been being not but can could may might also more most less such other some any each both between among within without over under after before during about above below upon via per its our your they them his her she him you ours using used use based study studies result results show showed shown found find finding findings data analysis paper article here however thus therefore although whereas because since very well much many first second one two three new effect effects".split(
    " ",
  ),
);

function stem(token: string): string {
  if (token.length > 5 && token.endsWith("ies"))
    return `${token.slice(0, -3)}y`;
  if (token.length > 4 && token.endsWith("es")) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss"))
    return token.slice(0, -1);
  return token;
}

export function keyTerms(text: string): Set<string> {
  const terms = new Set<string>();
  for (const raw of text
    .toLowerCase()
    .normalize("NFKD")
    .split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || /^\d+$/.test(raw) || STOPWORDS.has(raw)) continue;
    terms.add(stem(raw));
  }
  return terms;
}

export const MIN_SHARED_TERMS = 2;
export const MIN_SCORE = 0.2;

export type PassageSource = {
  origin: "full_text" | "abstract";
  paragraphs: SourceParagraph[];
  sourceUrl: string;
};

export function rankPassages(
  claimId: string,
  claimText: string,
  sources: PassageSource[],
  limit = 2,
): EvidencePassage[] {
  const claimTerms = keyTerms(claimText);
  if (claimTerms.size === 0) return [];

  const scored: (EvidencePassage & { order: number })[] = [];
  let order = 0;
  for (const source of sources) {
    for (const paragraph of source.paragraphs) {
      splitSentences(paragraph.text).forEach((sentence, index) => {
        order++;
        const sentenceTerms = keyTerms(sentence);
        const shared = [...claimTerms].filter((term) =>
          sentenceTerms.has(term),
        );
        const score = shared.length / claimTerms.size;
        if (shared.length < MIN_SHARED_TERMS || score < MIN_SCORE) return;
        scored.push({
          claimId,
          text: sentence,
          markupRemoved: paragraph.markupRemoved,
          origin: source.origin,
          location: {
            section: paragraph.section,
            paragraph: paragraph.paragraph,
            sentence: index + 1,
          },
          sourceUrl: source.sourceUrl,
          relevance: {
            method: "term-overlap",
            sharedTerms: shared.sort(),
            score: Math.round(score * 100) / 100,
          },
          order,
        });
      });
    }
  }

  return scored
    .sort((a, b) => b.relevance.score - a.relevance.score || a.order - b.order)
    .slice(0, limit)
    .map(({ order: _order, ...passage }) => passage);
}
