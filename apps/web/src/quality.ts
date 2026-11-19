/**
 * Quality figures for the uploaded paper, computed only from the API results
 * the browser holds. Steps that were not run are reported as such (null),
 * never as zero or as an estimate.
 */
import type { VerificationVerdict } from "@citeverify/shared";
import type { PaperResult } from "./paper-session.ts";

export const VERDICT_ORDER: VerificationVerdict[] = [
  "Supported",
  "Partially supported",
  "Contradicted",
  "Unsupported",
  "Unable to verify",
];

export type PaperQuality = {
  /** cited: claims with a citation matched to a reference entry. */
  claims: { total: number; cited: number; ownFindings: number };
  citations: {
    markers: number;
    items: number;
    matched: number;
    unmatched: number;
    ambiguous: number;
    referenceListFound: boolean;
    references: number;
    unmatchedMarkers: string[];
  };
  /** Null when source retrieval has not been run. */
  sources: null | {
    lookedUp: number;
    identified: number;
    fullText: number;
    abstractOnly: number;
    metadataOnly: number;
    unavailable: number;
    withErrors: number;
    rateLimited: number;
    /** Claims with a matched citation and at least one retrieved passage. */
    claimsWithEvidence: number;
  };
  /** Null when AI verification has not been run. */
  verification: null | {
    judged: number;
    byVerdict: { verdict: VerificationVerdict; count: number }[];
    unable: number;
    unableCauses: { cause: string; count: number }[];
    provider: string | null;
    model: string | null;
    truncated: boolean;
  };
};

const tally = <T extends string>(values: T[]) => {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
};

export function paperQuality(result: PaperResult): PaperQuality {
  const claims = result.claims.items;
  const { inText, references, referenceList } = result.citations;
  const statuses = inText.flatMap((c) => c.matches.map((m) => m.status));
  // Claims with at least one citation matched to a reference: the ones sent for verification.
  const citedIds = new Set(
    inText
      .filter((c) => c.claimId && c.matches.some((m) => m.status === "matched"))
      .map((c) => c.claimId as string),
  );
  const evidence = "evidence" in result ? result.evidence : undefined;
  const verification =
    "verification" in result ? result.verification : undefined;

  let sources: PaperQuality["sources"] = null;
  if (evidence) {
    const list = evidence.sources;
    const count = (pred: (s: (typeof list)[number]) => boolean) =>
      list.filter(pred).length;
    const claimIds = new Set(
      list.flatMap((s) => s.passages.map((p) => p.claimId)),
    );
    sources = {
      lookedUp: list.length,
      identified: count((s) => s.resolution.status === "resolved"),
      fullText: count((s) => s.access === "full_text"),
      abstractOnly: count((s) => s.access === "abstract_only"),
      metadataOnly: count((s) => s.access === "metadata_only"),
      unavailable: count((s) => s.access === "unavailable"),
      withErrors: count((s) => s.errors.length > 0),
      rateLimited: count((s) =>
        s.errors.some((e) => e.kind === "rate_limited"),
      ),
      claimsWithEvidence: [...citedIds].filter((id) => claimIds.has(id)).length,
    };
  }

  let verified: PaperQuality["verification"] = null;
  if (verification) {
    const verdicts = tally(verification.results.map((r) => r.verdict));
    const causes = tally(
      verification.results.flatMap((r) =>
        r.unableCause ? [r.unableCause] : [],
      ),
    );
    verified = {
      judged: verification.results.length,
      byVerdict: VERDICT_ORDER.map((verdict) => ({
        verdict,
        count: verdicts.get(verdict) ?? 0,
      })).filter((v) => v.count > 0),
      unable: verdicts.get("Unable to verify") ?? 0,
      unableCauses: [...causes].map(([cause, count]) => ({ cause, count })),
      provider: verification.model?.provider ?? null,
      model: verification.model?.name ?? null,
      truncated: verification.truncated,
    };
  }

  return {
    claims: {
      total: claims.length,
      cited: citedIds.size,
      ownFindings: claims.filter((c) => c.type === "reported_finding").length,
    },
    citations: {
      markers: inText.length,
      items: statuses.length,
      matched: statuses.filter((s) => s === "matched").length,
      unmatched: statuses.filter((s) => s === "unmatched").length,
      ambiguous: statuses.filter((s) => s === "ambiguous").length,
      referenceListFound: referenceList.found,
      references: references.length,
      unmatchedMarkers: inText
        .filter((c) => c.matches.some((m) => m.status !== "matched"))
        .map((c) => c.marker.trim()),
    },
    sources,
    verification: verified,
  };
}

/** "3 of 21 (14%)", or "none" for an empty denominator. */
export function share(part: number, whole: number): string {
  return whole > 0
    ? `${part} of ${whole} (${Math.round((100 * part) / whole)}%)`
    : "none";
}

/** Plain-language names for Unable to verify causes. */
export const CAUSE_LABEL: Record<string, string> = {
  no_evidence: "no relevant passage retrieved",
  insufficient_evidence: "evidence did not settle the claim",
  model_unavailable: "AI model unavailable",
  model_error: "AI service error or rate limit",
  model_timeout: "AI model timed out",
  time_budget: "time budget ran out",
  invalid_output: "AI answer failed validation",
};
