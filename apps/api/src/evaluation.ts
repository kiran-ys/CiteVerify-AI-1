/**
 * Dataset evaluation: runs one externally supplied test case through the
 * same verifier the app uses. "supplied" mode judges only the dataset's own
 * evidence snippet (labelled as dataset-supplied, never as retrieved);
 * "live" mode ignores the snippet and retrieves evidence with the normal
 * scholarly pipeline. No PDF is involved and nothing is stored.
 */
import { parseMetadata } from "@citeverify/citation-engine";
import {
  normalizeDoi,
  type RetrievalOptions,
  retrieveEvidence,
  splitSentences,
} from "@citeverify/evidence-retrieval";
import type {
  EvaluationCaseRequest,
  EvaluationCaseResponse,
  ExtractedClaim,
  InTextCitation,
  ReferenceEntry,
  RetrievedSource,
  VerificationProvider,
} from "@citeverify/shared";
import { type Judge, verifyClaims } from "@citeverify/verification-engine";

export const EVALUATION_LIMITS = {
  claim: 2_000,
  field: 2_000,
  snippet: 6_000,
  caseId: 64,
};

/** Placeholder values datasets use for "nothing here". */
const SENTINEL =
  /^(?:n\/?a|none|null|nil|-+|no_source_found|no source found)$/i;
const isBlank = (value: string) => !value.trim() || SENTINEL.test(value.trim());

/** Claims with too little language to verify (empty, whitespace, symbols). */
export function isInvalidClaim(claim: string): boolean {
  const letters = claim.match(/\p{L}/gu)?.length ?? 0;
  const words = claim.split(/\s+/).filter((w) => /\p{L}{2,}/u.test(w)).length;
  return letters < 8 || words < 3;
}

export function parseEvaluationRequest(
  body: unknown,
): { ok: true; value: EvaluationCaseRequest } | { ok: false; message: string } {
  if (typeof body !== "object" || body === null)
    return { ok: false, message: "Send a JSON object." };
  const b = body as Record<string, unknown>;
  if (b.mode !== "supplied" && b.mode !== "live")
    return { ok: false, message: 'mode must be "supplied" or "live".' };
  const text = (key: string, max: number, required = true) => {
    const value = b[key];
    if (value === undefined || value === null) return required ? null : "";
    if (typeof value !== "string" || value.length > max) return null;
    return value;
  };
  const fields = {
    caseId: text("caseId", EVALUATION_LIMITS.caseId),
    claim: text("claim", EVALUATION_LIMITS.claim),
    inlineCitation: text("inlineCitation", EVALUATION_LIMITS.field),
    referenceEntry: text("referenceEntry", EVALUATION_LIMITS.field),
    doi: text("doi", EVALUATION_LIMITS.field),
    evidenceSnippet: text("evidenceSnippet", EVALUATION_LIMITS.snippet, false),
  };
  for (const [key, value] of Object.entries(fields))
    if (value === null)
      return {
        ok: false,
        message: `${key} must be a string within the size limit.`,
      };
  return {
    ok: true,
    value: { mode: b.mode, ...(fields as Omit<EvaluationCaseRequest, "mode">) },
  };
}

export type EvaluationDeps = {
  judge: Judge | null;
  modelName: string | null;
  provider: VerificationProvider;
  unavailableReason: string | null;
  retrieval: RetrievalOptions;
  timeBudgetMs?: number;
};

const ABSTRACT_NOTE = /\s*Judged (?:partly )?from abstracts[^.]*\./g;

export async function evaluateCase(
  req: EvaluationCaseRequest,
  deps: EvaluationDeps,
): Promise<EvaluationCaseResponse> {
  const started = Date.now();
  const base: Pick<
    EvaluationCaseResponse,
    | "caseId"
    | "mode"
    | "verdict"
    | "unableCause"
    | "explanation"
    | "evidence"
    | "model"
  > = {
    caseId: req.caseId,
    mode: req.mode,
    verdict: null,
    unableCause: null,
    explanation: null,
    evidence: [],
    model: null,
  };
  const none = {
    kind: "none" as const,
    resolver: null,
    access: null,
    workTitle: null,
    workDoi: null,
  };

  if (isInvalidClaim(req.claim)) {
    return {
      ...base,
      outcome: "invalid_input",
      reason:
        "The claim is empty or has too little text to verify; no model was called.",
      provenance: {
        ...none,
        detail: "Input rejected before retrieval or AI verification.",
      },
      latencyMs: Date.now() - started,
    };
  }
  if (isBlank(req.inlineCitation) || isBlank(req.referenceEntry)) {
    return {
      ...base,
      outcome: "no_citation",
      reason:
        "The claim has no citation or reference, so there is no source to check it against. CiteVerify does not judge whether a sentence needs a citation.",
      provenance: { ...none, detail: "No citation supplied." },
      latencyMs: Date.now() - started,
    };
  }

  const metadata = parseMetadata(req.referenceEntry);
  const datasetDoi = /^10\.\d{4,9}\/\S+$/.test(req.doi.trim())
    ? normalizeDoi(req.doi.trim())
    : null;
  const claim: ExtractedClaim = {
    id: "claim-1",
    text: req.claim.trim(),
    page: 1,
    location: { start: 0, end: req.claim.trim().length },
    section: null,
    context: { before: null, after: null },
    type: "cited_claim",
    extraction: { method: "rule-based", version: "evaluation", signals: [] },
  };
  const reference: ReferenceEntry = {
    id: "ref-1",
    number: null,
    text: req.referenceEntry,
    page: 1,
    pageEnd: 1,
    location: null,
    metadata: { ...metadata, doi: metadata.doi ?? datasetDoi },
  };
  const citation: InTextCitation = {
    id: "cit-1",
    marker: req.inlineCitation,
    style: "author-year",
    page: 1,
    location: { start: 0, end: 1 },
    claimId: claim.id,
    matches: [
      {
        key: "1",
        status: "matched",
        referenceIds: [reference.id],
        reason: null,
      },
    ],
  };

  let sources: RetrievedSource[];
  let provenance: EvaluationCaseResponse["provenance"];
  if (req.mode === "supplied") {
    const snippet = req.evidenceSnippet ?? "";
    const sentences = isBlank(snippet)
      ? []
      : splitSentences(snippet).slice(0, 12);
    sources = [
      {
        referenceId: reference.id,
        claimIds: [claim.id],
        resolution: {
          status: "resolved",
          reason: null,
          matchedBy: null,
          resolver: null,
          candidates: [],
        },
        work: null,
        access: sentences.length ? "abstract_only" : "unavailable",
        accessReason:
          "Evidence supplied by the dataset, not retrieved by CiteVerify.",
        license: null,
        urls: { doi: null, landingPage: null, fullText: null },
        passages: sentences.map((text, i) => ({
          claimId: claim.id,
          text,
          markupRemoved: false,
          origin: "abstract" as const,
          location: { section: null, paragraph: 0, sentence: i },
          sourceUrl: `dataset:${req.caseId}`,
          relevance: {
            method: "term-overlap" as const,
            sharedTerms: [],
            score: 100 - i,
          },
        })),
        errors: [],
      },
    ];
    provenance = {
      kind: sentences.length ? "dataset_supplied" : "none",
      detail: sentences.length
        ? "Evidence snippet supplied by the dataset; CiteVerify did not retrieve or check this text against the source."
        : "The dataset supplied no usable evidence snippet.",
      resolver: null,
      access: null,
      workTitle: null,
      workDoi: null,
    };
  } else {
    const evidence = await retrieveEvidence(
      { references: [reference], claims: [claim], citations: [citation] },
      deps.retrieval,
    );
    sources = evidence.sources;
    const s = sources[0];
    provenance = {
      kind: s?.passages.length ? "retrieved" : "none",
      detail: !s
        ? "The reference was not looked up."
        : s.resolution.status !== "resolved"
          ? (s.resolution.reason ??
            "No scholarly record matched this reference.")
          : s.passages.length
            ? `Retrieved by CiteVerify from ${s.resolution.resolver ?? "a scholarly service"} (${s.access.replace("_", " ")}).`
            : (s.accessReason ??
              "The record was found but no relevant passage was available."),
      resolver: s?.resolution.resolver ?? null,
      access: s?.access ?? null,
      workTitle: s?.work?.title ?? null,
      workDoi: s?.work?.doi ?? null,
    };
  }

  const result = (
    await verifyClaims(
      {
        claims: [claim],
        citations: [citation],
        references: [reference],
        sources,
      },
      {
        judge: deps.judge,
        modelName: deps.modelName,
        provider: deps.provider,
        unavailableReason: deps.unavailableReason,
        timeBudgetMs: deps.timeBudgetMs ?? 60_000,
      },
    )
  ).results[0];

  const cause = result?.unableCause ?? null;
  const resolved = sources[0]?.resolution.status === "resolved";
  const outcome: EvaluationCaseResponse["outcome"] =
    cause &&
    [
      "model_unavailable",
      "model_error",
      "model_timeout",
      "invalid_output",
      "time_budget",
    ].includes(cause)
      ? "model_failure"
      : req.mode === "live" && !resolved
        ? "reference_not_found"
        : cause === "no_evidence"
          ? "no_evidence"
          : "verified";
  const reason = result?.reason ?? null;
  return {
    ...base,
    outcome,
    verdict: result?.verdict ?? null,
    unableCause: cause,
    reason:
      req.mode === "supplied" && reason
        ? reason.replace(ABSTRACT_NOTE, "").trim() || null
        : reason,
    explanation: result?.explanation ?? null,
    provenance,
    evidence: (result?.evidence ?? []).map((e) => ({
      id: e.evidenceId,
      relation: e.relation,
      text: e.text,
      url: e.sourceUrl,
    })),
    model: result?.model ?? null,
    latencyMs: Date.now() - started,
  };
}
