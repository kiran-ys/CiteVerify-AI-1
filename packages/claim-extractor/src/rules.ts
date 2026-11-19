/**
 * Transparent, deterministic rules for deciding whether one sentence is a
 * candidate scientific claim. Every accepted sentence reports the rules that
 * matched, and every rejected sentence reports why it was rejected.
 */
import type { ExtractedClaimType } from "@citeverify/shared";
import type { SectionKind } from "./segment.ts";

export type RejectionReason =
  | "excluded_section"
  | "incomplete_sentence"
  | "too_short"
  | "too_long"
  | "question"
  | "not_prose"
  | "names_or_title"
  | "contact_or_affiliation"
  | "publication_metadata"
  | "figure_or_table_caption"
  | "reference_entry"
  | "aim_or_outline"
  | "background_without_citation"
  | "no_claim_signal";

export type Classification =
  | { accepted: true; type: ExtractedClaimType; signals: string[] }
  | { accepted: false; reason: RejectionReason };

type Rule = { signal: string; pattern: RegExp };

const RESULT_VERBS =
  "found|find|finds|show|showed|shown|shows|demonstrate|demonstrated|demonstrates|observe|observed|report|reported|identify|identified|reveal|revealed|reveals|confirm|confirmed|confirms|detect|detected|establish|established|indicate|indicated|indicates|suggest|suggested|suggests|estimated|achieved|provide evidence|support|supported|supports|highlight|highlighted|highlights";

const FIRST_PERSON_RESULT: Rule = {
  signal: "first-person result statement",
  pattern: new RegExp(
    `\\b(?:we|our (?:results?|findings?|data|analys[ie]s|study|experiments?|model|observations?|measurements?))\\s+(?:(?:also|further|consistently|clearly|thus|therefore|here|now|additionally|then|first|next|finally|have|had)\\s+)*(?:${RESULT_VERBS})\\b`,
    "i",
  ),
};

const RESULTS_STATEMENT: Rule = {
  signal: "results statement",
  pattern: new RegExp(
    `\\b(?:(?:these|the|this|our|present) (?:results?|findings?|data|analys[ie]s|observations?)|this (?:study|work|analysis|trial))\\s+(?:(?:also|further|clearly|thus|therefore)\\s+)?(?:${RESULT_VERBS})\\b`,
    "i",
  ),
};

const STATISTIC: Rule = {
  signal: "statistical result",
  pattern:
    /\bp\s*[<>=≤≥]\s*0?\.\d+|\b(?:95|99)\s?%\s*(?:CI|confidence interval)|\b(?:odds ratio|hazard ratio|relative risk|risk ratio|OR|HR|RR|AUC|R2|R²)\s*[=:]\s*-?\d|\b[rtρβ]\s*=\s*-?0?\.\d+/i,
};

const SIGNIFICANCE: Rule = {
  signal: "significance statement",
  // "significantly <word>" is almost always statistical; the adjective
  // "significant" counts only before a result noun ("a significant problem" does not).
  pattern:
    /\bsignificantly\s+[a-z]+|\b(?:statistically|no|non-?)\s+significant\b|\bsignificant\s+(?:increase|decrease|reduction|improvement|difference|association|correlation|effect|interaction|rise|decline|change|predictor|risk)s?\b/i,
};

const QUANTITY =
  /\b\d+(?:\.\d+)?\s?(?:%|percent|-?fold|times|mg|kg|g|ml|mL|mm|cm|nm|µm|μm|ms|s|h|hours?|days?|weeks?|months?|years?|°C|K|mmol|mM|µM|μM|nM|Hz|kHz|MHz|dB|participants|patients|subjects|samples|cases|individuals)(?![A-Za-z])/;

const COMPARISON =
  /\b(?:increas\w*|decreas\w*|reduc\w*|improv\w*|higher|lower|greater|fewer|more than|less than|outperform\w*|exceed\w*|rose|fell|declin\w*|doubl\w*|tripl\w*|associated|correlat\w*|predict\w*)\b/i;

const CITATION_RULES: RegExp[] = [
  // Numeric: [12], [3-5], [1, 4, 7]
  /\[\s*\d{1,3}(?:\s*[-–,]\s*\d{1,3})*\s*\]/,
  // Parenthetical author-year: (Smith et al., 2020), (Lee and Park 2019; Ng, 2021)
  /\([^()]*\b[A-Z][A-Za-z'’-]+[^()]*\b(?:19|20)\d{2}[a-z]?\s*\)/,
  // Narrative author-year: Smith et al. (2020)
  /\b[A-Z][A-Za-z'’-]+(?:\s+et al\.?|\s+and\s+[A-Z][A-Za-z'’-]+)?\s+\((?:19|20)\d{2}[a-z]?\)/,
];

/** Sentences that only point the reader to other work, e.g. "For a review, see [3-5]." */
const CITATION_POINTER =
  /^(?:see\b|for (?:[a-z]+ ){0,3}(?:reviews?|details?|overviews?|discussions?|examples?|information)\b)|\b(?:reviewed|summari[sz]ed|described|discussed) (?:elsewhere|previously|in detail)\b/i;

const HEDGE =
  /\b(?:may|might|could|possibly|potentially|likely|appears? to|appeared to|seems? to|seemed to)\b/i;

const AIM_OR_OUTLINE =
  /\b(?:this (?:paper|article|review|study|work) (?:is organi[sz]ed|presents|describes|proposes|introduces|aims|reviews)|the (?:aims?|purposes?|objectives?|goals?) of (?:this|the present|our)|we (?:aim|aimed|seek|sought|propose|present|introduce|describe|hypothesi[sz]e|hypothesi[sz]ed|investigate whether|investigated whether|examine whether|examined whether|asked whether)|in (?:this|the present) (?:paper|article|section)|(?:is|are) (?:organi[sz]ed|structured) as follows|future (?:work|research|studies) (?:should|will|could|may)|further (?:research|studies|work) (?:is|are) (?:needed|required|warranted))\b/i;

const CONTACT =
  /@|\borcid\b|\bcorresponding author\b|\be-?mail\b|\btel\.|\bfax\b/i;

const AFFILIATION =
  /\b(?:University|Department|Institute|Faculty|School|College|Hospital|Laboratory|Centre|Center|Division)\s+(?:of|for)\b/;

const PUBLICATION_METADATA =
  /\bdoi:|\bdoi\.org\b|https?:\/\/|\bwww\.|©|\bcopyright\b|\ball rights reserved\b|\bcreative commons\b|\blicen[cs]ed under\b|\barxiv\b|\bissn\b|\b(?:received|accepted|published|revised)\b:?\s+\d{1,2}\s+[A-Z][a-z]+\s+\d{4}/i;

const CAPTION =
  /^(?:fig(?:ure)?s?|table|tab|supplementary (?:fig(?:ure)?|table)|scheme|box)\.?\s*S?\d+/i;

const REFERENCE_ENTRY: RegExp[] = [
  // "12. Smith J, ..." or "[12] Smith, J. ..."
  /^\[?\d{1,3}[\].]\s+[A-Z][A-Za-z'’-]+,?\s+[A-Z]{1,3}\b/,
  // "Smith, J. A., ..."
  /^[A-Z][A-Za-z'’-]+,\s+[A-Z]\.(?:\s?[A-Z]\.)*,/,
  // Journal volume(issue): pages, e.g. "12(3): 45-67" or "2019;12:45"
  /\b\d{1,4}\s*\(\d{1,4}\)\s*[:,]\s*\d+\s*[-–]\s*\d+/,
  /\b(?:19|20)\d{2}\s*;\s*\d+(?:\(\d+\))?\s*:\s*\d+/,
];

function words(text: string): string[] {
  return text.split(/\s+/).filter((word) => /[A-Za-z]/.test(word));
}

function matches(text: string, rules: Rule[]): string[] {
  return rules.filter((rule) => rule.pattern.test(text)).map((r) => r.signal);
}

export function hasCitation(text: string): boolean {
  return CITATION_RULES.some((pattern) => pattern.test(text));
}

/** Rejects structural non-claims before any claim signal is considered. */
function structuralRejection(text: string): RejectionReason | null {
  const allWords = words(text);
  if (allWords.length < 5) return "too_short";
  if (allWords.length > 90 || text.length > 700) return "too_long";
  if (/\?["'”’)\]]*$/.test(text)) return "question";

  const letters = text.replace(/[^A-Za-z]/g, "").length;
  if (letters / text.replace(/\s/g, "").length < 0.5) return "not_prose";

  if (CAPTION.test(text)) return "figure_or_table_caption";
  if (REFERENCE_ENTRY.some((pattern) => pattern.test(text)))
    return "reference_entry";
  if (CONTACT.test(text)) return "contact_or_affiliation";
  if (AFFILIATION.test(text) && (text.match(/,/g)?.length ?? 0) >= 2)
    return "contact_or_affiliation";
  if (PUBLICATION_METADATA.test(text)) return "publication_metadata";

  // Titles, headings, and author lists are mostly capitalised words.
  const lowercaseWords = allWords.filter((word) => /^[a-z]/.test(word));
  if (lowercaseWords.length / allWords.length < 0.3) return "names_or_title";
  return null;
}

export function classifySentence(
  text: string,
  sectionKind: SectionKind,
  complete = true,
): Classification {
  if (
    sectionKind === "methods" ||
    sectionKind === "references" ||
    sectionKind === "excluded"
  ) {
    return { accepted: false, reason: "excluded_section" };
  }
  if (!complete) return { accepted: false, reason: "incomplete_sentence" };

  const structural = structuralRejection(text);
  if (structural) return { accepted: false, reason: structural };

  const firstPerson = matches(text, [FIRST_PERSON_RESULT, RESULTS_STATEMENT]);
  const statistics = matches(text, [STATISTIC, SIGNIFICANCE]);
  const quantified =
    QUANTITY.test(text) && COMPARISON.test(text)
      ? ["quantified comparison"]
      : [];
  const cited = hasCitation(text) && !CITATION_POINTER.test(text);
  const hedged = HEDGE.test(text) ? ["hedged language"] : [];

  if (
    AIM_OR_OUTLINE.test(text) &&
    firstPerson.length === 0 &&
    statistics.length === 0
  ) {
    return { accepted: false, reason: "aim_or_outline" };
  }

  if (sectionKind === "introduction") {
    // Introductions are mostly background: keep only attributed statements
    // and explicit previews of this paper's own results.
    if (firstPerson.length > 0) {
      return {
        accepted: true,
        type: "reported_finding",
        signals: [...firstPerson, ...statistics, ...quantified, ...hedged],
      };
    }
    if (cited) {
      return {
        accepted: true,
        type: "cited_claim",
        signals: ["citation marker", ...statistics, ...quantified, ...hedged],
      };
    }
    return { accepted: false, reason: "background_without_citation" };
  }

  // A cited sentence without first-person wording reports someone else's work.
  if (cited && firstPerson.length === 0) {
    return {
      accepted: true,
      type: "cited_claim",
      signals: ["citation marker", ...statistics, ...quantified, ...hedged],
    };
  }

  const findingSignals = [...firstPerson, ...statistics, ...quantified];
  if (findingSignals.length > 0) {
    return {
      accepted: true,
      type: "reported_finding",
      signals: [
        ...findingSignals,
        ...(cited ? ["citation marker"] : []),
        ...hedged,
      ],
    };
  }
  return { accepted: false, reason: "no_claim_signal" };
}
