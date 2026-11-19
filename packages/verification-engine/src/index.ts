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
export {
  DEFAULT_GROQ_MODEL,
  type GroqConfig,
  groqJudge,
  groqStatus,
} from "./groq.ts";
export {
  CONSISTENCY_DISCLAIMER,
  CONSISTENCY_VERSION,
  checkInternalConsistency,
  confidenceIntervals,
  pValues,
  significanceWording,
  specificValues,
} from "./consistency.ts";

export const VERIFICATION_METHOD = "evidence-grounded-llm" as const;
export const VERIFICATION_VERSION = "1.0.0";
/** Evidence passages per claim, across all its cited sources. Output and prompt length drive latency. */
export const MAX_PASSAGES_PER_CLAIM = 10;
/** Passages per cited source, so one long source cannot crowd out the others. */
export const MAX_PASSAGES_PER_SOURCE = 4;
export const DEFAULT_VERIFICATION_BUDGET_MS = 120_000;

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
  /** Where the model runs; defaults to the local Ollama server. */
  provider?: VerificationModel["provider"];
  /** Why the model is unavailable, shown on every affected claim. */
  unavailableReason?: string | null;
  timeBudgetMs?: number;
  now?: () => Date;
};

export type VerificationResult = VerifyClaimsResponse["verification"];

function unable(
  claimId: string,
  cause: NonNullable<ClaimVerification["unableCause"]>,
  reason: string,
  evidence: VerificationEvidence[] = [],
): ClaimVerification {
  return {
    claimId,
    verdict: "Unable to verify",
    decidedBy: "rule",
    unableCause: cause,
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
/**
 * The most informative passages from one source: the best term overlaps plus
 * the abstract's last sentence (usually its conclusion), in reading order.
 */
function pickPassages(
  passages: RetrievedSource["passages"],
): RetrievedSource["passages"] {
  if (passages.length <= MAX_PASSAGES_PER_SOURCE) return passages;
  const abstract = passages.filter((passage) => passage.origin === "abstract");
  const conclusion = abstract.at(-1);
  const ranked = [...passages]
    .filter((passage) => passage !== conclusion)
    .sort((a, b) => b.relevance.score - a.relevance.score)
    .slice(0, MAX_PASSAGES_PER_SOURCE - (conclusion ? 1 : 0));
  const keep = new Set([...ranked, ...(conclusion ? [conclusion] : [])]);
  return passages.filter((passage) => keep.has(passage));
}

function evidenceFor(
  claimId: string,
  referenceIds: string[],
  sources: Map<string, RetrievedSource>,
): VerificationEvidence[] {
  const collected: Omit<VerificationEvidence, "evidenceId">[] = [];
  // Grouped by cited source, in citation order; within a source, retrieval
  // order is kept (ranked full-text passages, then the abstract in order).
  for (const referenceId of referenceIds) {
    const source = sources.get(referenceId);
    if (!source) continue;
    for (const passage of pickPassages(
      source.passages.filter((item) => item.claimId === claimId),
    )) {
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
          provider: options.provider ?? "ollama",
          name: options.modelName,
          promptVersion: PROMPT_VERSION,
        }
      : null;

  const results: ClaimVerification[] = [];
  let truncated = false;
  // Claims are checked one at a time: a local model serves one request well.
  let ownFindingsExcluded = 0;
  for (const claim of input.claims) {
    const claimCitations = input.citations.filter(
      (citation) => citation.claimId === claim.id,
    );
    // The paper's own findings are not checked against external sources;
    // internal consistency covers them.
    if (claimCitations.length === 0 && claim.type !== "cited_claim") {
      ownFindingsExcluded++;
      continue;
    }
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
          "no_evidence",
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
          "model_unavailable",
          `Evidence was retrieved, but no AI model was available to compare it with the claim. ${options.unavailableReason ?? ""}`.trim(),
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
          "time_budget",
          "The verification time budget ran out before this claim was checked.",
          evidence,
        ),
      );
      continue;
    }

    const request = {
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
    };
    const answer = await options.judge(request);
    if (!answer.ok) {
      results.push(
        unable(
          claim.id,
          answer.kind === "timeout" ? "model_timeout" : "model_error",
          `The AI model could not be used: ${answer.reason}.`,
          evidence,
        ),
      );
      continue;
    }
    const knownIds = new Set(evidence.map((item) => item.evidenceId));
    let validated = validateJudgement(answer.content, knownIds);
    // One retry for a malformed answer, if time allows; never more.
    if (!validated.ok && Date.now() < deadline) {
      const second = await options.judge(request);
      if (second.ok) {
        const retried = validateJudgement(second.content, knownIds);
        validated = retried.ok
          ? retried
          : {
              ok: false,
              problem: `${validated.problem} (and again on one retry: ${retried.problem})`,
            };
      }
    }
    if (!validated.ok) {
      results.push(
        unable(
          claim.id,
          "invalid_output",
          `The model's answer was rejected because ${validated.problem}.`,
          evidence,
        ),
      );
      continue;
    }

    const { verdict, cited, explanation, parts, modelVerdict } =
      validated.judgement;
    // Part-by-part assessment, shown so a reviewer can see why the verdict follows.
    const partsNote = parts
      ? `Claim parts: ${parts
          .map(
            (item) =>
              `${item.part} ${item.status.replace("_", " ")}${item.evidence ? ` (${item.evidence})` : ""}`,
          )
          .join("; ")}.${
          modelVerdict && modelVerdict !== verdict
            ? ` The model's own overall label was "${modelVerdict}"; the verdict follows its part-by-part assessment.`
            : ""
        }`
      : null;
    const used = evidence.map((item) => ({
      ...item,
      relation: cited.get(item.evidenceId) ?? item.relation,
    }));
    const scope = scopeOf(used);
    const scopeNote =
      scope === "abstract_only"
        ? "Judged from abstracts only; the full texts were not accessible."
        : scope === "mixed"
          ? "Judged partly from abstracts; some full texts were not accessible."
          : null;
    // "Insufficient evidence" is reported as Unable to verify, with the reason.
    const insufficient = verdict === "Insufficient evidence";
    const mismatchNote =
      insufficient && validated.judgement.topicMismatch
        ? "The model also judged that the retrieved text appears to address a different question than the claim; check the full source before concluding anything about the citation."
        : null;
    results.push({
      claimId: claim.id,
      verdict: insufficient ? "Unable to verify" : verdict,
      decidedBy: "model",
      unableCause: insufficient ? "insufficient_evidence" : null,
      reason:
        [
          insufficient
            ? "The model found no part of the claim directly supported by the retrieved passages, so they are not sufficient to establish or refute it."
            : null,
          mismatchNote,
          partsNote,
          scopeNote,
        ]
          .filter(Boolean)
          .join(" ") || null,
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
    ownFindingsExcluded,
    reviewStatus: "requires_human_review",
  };
}
