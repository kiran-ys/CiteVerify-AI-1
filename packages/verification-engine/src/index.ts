/**
 * Evidence-grounded claim verification.
 *
 * Every verdict other than "Unable to verify" comes from a local model that
 * may only cite passages retrieved from the claim's own cited sources, and
 * its answer is validated before use. Without usable evidence the result is
 * "Unable to verify" with a reason, decided without the model. No
 * confidence scores are produced: model output is not calibrated.
 */
import type {
  ClaimVerification,
  ExtractedClaim,
  InTextCitation,
  ReferenceEntry,
  RetrievedSource,
  VerificationEvidence,
  VerificationModel,
  VerifyClaimsResponse,
} from "@citeverify/shared";
import type { Judge } from "./ollama.ts";
import {
  buildUserPrompt,
  OUTPUT_SCHEMA,
  PROMPT_VERSION,
  SYSTEM_PROMPT,
} from "./prompt.ts";
import { validateJudgement } from "./validate.ts";

export {
  DEFAULT_OLLAMA_HOST,
  DEFAULT_OLLAMA_MODEL,
  type Judge,
  type JudgeRequest,
  type JudgeResult,
  type OllamaConfig,
  ollamaJudge,
  ollamaStatus,
} from "./ollama.ts";
export {
  buildUserPrompt,
  OUTPUT_SCHEMA,
  PROMPT_VERSION,
  SYSTEM_PROMPT,
} from "./prompt.ts";
export { validateJudgement } from "./validate.ts";

export const VERIFICATION_METHOD = "evidence-grounded-llm" as const;
export const VERIFICATION_VERSION = "1.0.0";
export const MAX_PASSAGES_PER_CLAIM = 6;
export const DEFAULT_VERIFICATION_BUDGET_MS = 150_000;

export type VerificationInput = {
  claims: ExtractedClaim[];
  citations: InTextCitation[];
  references: ReferenceEntry[];
  sources: RetrievedSource[];
};

export type VerificationOptions = {
  /** Null when no model is available; every claim is then "Unable to verify". */
  judge: Judge | null;
  modelName: string | null;
  /** Why the model is unavailable, shown on every affected claim. */
  unavailableReason?: string | null;
  timeBudgetMs?: number;
  now?: () => Date;
};

export type VerificationResult = VerifyClaimsResponse["verification"];

function unable(
  claimId: string,
  reason: string,
  evidence: VerificationEvidence[] = [],
): ClaimVerification {
  return {
    claimId,
    verdict: "Unable to verify",
    decidedBy: "rule",
    reason,
    evidence,
    evidenceScope: scopeOf(evidence),
    explanation: null,
    model: null,
  };
}

function scopeOf(
  evidence: VerificationEvidence[],
): ClaimVerification["evidenceScope"] {
  const origins = new Set(evidence.map((item) => item.origin));
  if (origins.size === 0) return "none";
  if (origins.size === 2) return "mixed";
  return origins.has("full_text") ? "full_text" : "abstract_only";
}

function label(reference: ReferenceEntry | undefined, id: string): string {
  return reference?.number !== null && reference?.number !== undefined
    ? `Reference ${reference.number}`
    : `Reference ${id}`;
}

/** Explains, per cited reference, why no passage reached the model. */
function noEvidenceReason(
  claim: ExtractedClaim,
  claimCitations: InTextCitation[],
  referenceIds: string[],
  references: Map<string, ReferenceEntry>,
  sources: Map<string, RetrievedSource>,
): string {
  if (claimCitations.length === 0) {
    return claim.type === "reported_finding"
      ? "This claim reports the paper's own result and cites no source, so there is no cited evidence to check it against."
      : "No citation marker in this claim could be read, so no source was retrieved.";
  }
  if (referenceIds.length === 0) {
    return "None of this claim's citations matched exactly one entry in the paper's reference list, so no source was retrieved.";
  }
  const parts = referenceIds.map((id) => {
    const name = label(references.get(id), id);
    const source = sources.get(id);
    if (!source) return `${name}: not looked up.`;
    switch (source.resolution.status) {
      case "skipped":
        return `${name}: not looked up because of the per-request source limit.`;
      case "ambiguous":
        return `${name}: several scholarly records matched, so the source could not be identified.`;
      case "unresolved":
        return `${name}: no matching scholarly record was found.`;
      case "error":
        return `${name}: scholarly services could not be reached.`;
      default:
        break;
    }
    if (source.access === "metadata_only") {
      return `${name}: only bibliographic metadata was accessible, with no abstract or full text.`;
    }
    return `${name}: the accessible ${source.access === "full_text" ? "full text" : "abstract"} had no passage sharing enough key terms with this claim.`;
  });
  return `No relevant evidence passage was retrieved. ${parts.join(" ")}`;
}

/** Passages for one claim across its matched sources, best overlap first. */
function evidenceFor(
  claimId: string,
  referenceIds: string[],
  sources: Map<string, RetrievedSource>,
): VerificationEvidence[] {
  const collected: Omit<VerificationEvidence, "evidenceId">[] = [];
  for (const referenceId of referenceIds) {
    const source = sources.get(referenceId);
    if (!source) continue;
    for (const passage of source.passages) {
      if (passage.claimId !== claimId) continue;
      collected.push({
        ...passage,
        referenceId,
        relation: "not_cited",
        sourceTitle: source.work?.title ?? null,
        doi: source.work?.doi ?? null,
      });
    }
  }
  return collected
    .sort((a, b) => b.relevance.score - a.relevance.score)
    .slice(0, MAX_PASSAGES_PER_CLAIM)
    .map((passage, index) => ({ ...passage, evidenceId: `E${index + 1}` }));
}

export async function verifyClaims(
  input: VerificationInput,
  options: VerificationOptions,
): Promise<VerificationResult> {
  const now = options.now ?? (() => new Date());
  const deadline =
    Date.now() + (options.timeBudgetMs ?? DEFAULT_VERIFICATION_BUDGET_MS);
  const references = new Map(
    input.references.map((reference) => [reference.id, reference]),
  );
  const sources = new Map(
    input.sources.map((source) => [source.referenceId, source]),
  );
  const model: VerificationModel | null =
    options.judge && options.modelName
      ? {
          provider: "ollama",
          name: options.modelName,
          promptVersion: PROMPT_VERSION,
        }
      : null;

  const results: ClaimVerification[] = [];
  let truncated = false;
  // Claims are checked one at a time: a local model serves one request well.
  for (const claim of input.claims) {
    const claimCitations = input.citations.filter(
      (citation) => citation.claimId === claim.id,
    );
    const referenceIds = [
      ...new Set(
        claimCitations.flatMap((citation) =>
          citation.matches.flatMap((match) =>
            match.status === "matched" ? match.referenceIds : [],
          ),
        ),
      ),
    ];
    const evidence = evidenceFor(claim.id, referenceIds, sources);

    if (evidence.length === 0) {
      results.push(
        unable(
          claim.id,
          noEvidenceReason(
            claim,
            claimCitations,
            referenceIds,
            references,
            sources,
          ),
        ),
      );
      continue;
    }
    if (!options.judge || !model) {
      results.push(
        unable(
          claim.id,
          `Evidence was retrieved, but no local model was available to compare it with the claim. ${options.unavailableReason ?? ""}`.trim(),
          evidence,
        ),
      );
      continue;
    }
    if (Date.now() >= deadline) {
      truncated = true;
      results.push(
        unable(
          claim.id,
          "The verification time budget ran out before this claim was checked.",
          evidence,
        ),
      );
      continue;
    }

    const answer = await options.judge({
      system: SYSTEM_PROMPT,
      user: buildUserPrompt(
        claim.text,
        evidence.map((item) => ({
          id: item.evidenceId,
          source: item.sourceTitle ?? item.sourceUrl,
          text: item.text,
        })),
      ),
      schema: OUTPUT_SCHEMA,
    });
    if (!answer.ok) {
      results.push(
        unable(
          claim.id,
          `The local model could not be used: ${answer.reason}.`,
          evidence,
        ),
      );
      continue;
    }
    const validated = validateJudgement(
      answer.content,
      new Set(evidence.map((item) => item.evidenceId)),
    );
    if (!validated.ok) {
      results.push(
        unable(
          claim.id,
          `The model's answer was rejected because ${validated.problem}.`,
          evidence,
        ),
      );
      continue;
    }

    const { verdict, cited, explanation } = validated.judgement;
    const used = evidence.map((item) => ({
      ...item,
      relation: cited.get(item.evidenceId) ?? item.relation,
    }));
    const scope = scopeOf(used);
    results.push({
      claimId: claim.id,
      verdict,
      decidedBy: "model",
      reason:
        scope === "abstract_only"
          ? "Judged from abstracts only; the full texts were not accessible."
          : scope === "mixed"
            ? "Judged partly from abstracts; some full texts were not accessible."
            : null,
      evidence: used,
      evidenceScope: scope,
      explanation,
      model,
    });
  }

  return {
    results,
    model,
    modelAvailable: options.judge !== null,
    method: VERIFICATION_METHOD,
    version: VERIFICATION_VERSION,
    verifiedAt: now().toISOString(),
    truncated,
    reviewStatus: "requires_human_review",
  };
}
