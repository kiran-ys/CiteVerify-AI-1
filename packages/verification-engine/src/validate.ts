/**
 * Strict validation of model output. Anything that does not meet the
 * evidence rules is rejected, and the caller reports "Unable to verify".
 */
import {
  CLAIM_PARTS,
  MODEL_RELATIONS,
  MODEL_VERDICTS,
  type ModelVerdict,
  PART_STATUSES,
} from "./prompt.ts";

export type PartAssessment = {
  part: (typeof CLAIM_PARTS)[number];
  status: (typeof PART_STATUSES)[number];
  evidence: string | null;
};

export type ValidatedJudgement = {
  verdict: ModelVerdict;
  cited: Map<string, (typeof MODEL_RELATIONS)[number]>;
  explanation: string | null;
  /** Present when the answer used the part-by-part format; the verdict is then derived from it. */
  parts?: PartAssessment[];
  /** The model's own overall label, kept for transparency when it differs. */
  modelVerdict?: ModelVerdict;
};

/**
 * The verdict implied by the parts: Supported only when every stated part is
 * supported; Partially supported when some are; Contradicted when parts are
 * contradicted and none supported; otherwise insufficient. A claim without a
 * "finding" part is treated as if its finding were not reported.
 */
export function verdictFromParts(parts: PartAssessment[]): ModelVerdict {
  const all = parts.some((item) => item.part === "finding")
    ? parts
    : [...parts, { part: "finding" as const, status: "not_reported" as const, evidence: null }];
  const supported = all.filter((item) => item.status === "supported").length;
  const contradicted = all.filter((item) => item.status === "contradicted").length;
  if (supported === all.length) return "Supported";
  if (supported > 0) return "Partially supported";
  if (contradicted > 0) return "Contradicted";
  return "Insufficient evidence";
}

/** Splits "E1, E3" or "E1 and E3" into ids. */
export function evidenceIds(text: string): string[] {
  return [...new Set(text.split(/[\s,;]+|\band\b/).map((id) => id.trim()).filter(Boolean))];
}

function validateParts(
  raw: unknown[],
  knownIds: Set<string>,
): { ok: true; parts: PartAssessment[] } | { ok: false; problem: string } {
  const parts: PartAssessment[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) return { ok: false, problem: "the model listed a claim part that was not an object" };
    const part = entry.part;
    const status = entry.status;
    if (typeof part !== "string" || !(CLAIM_PARTS as readonly string[]).includes(part)) {
      return { ok: false, problem: `the model named an unknown claim part (${String(part)})` };
    }
    if (typeof status !== "string" || !(PART_STATUSES as readonly string[]).includes(status)) {
      return { ok: false, problem: `the model gave the ${part} an unknown status` };
    }
    // The model may cite one id ("E2") or several ("E1, E3"); every one must have been provided.
    const ids = typeof entry.evidence === "string" ? evidenceIds(entry.evidence) : [];
    const unknown = ids.find((id) => !knownIds.has(id));
    if (status !== "not_reported" && unknown) {
      return { ok: false, problem: `the model cited evidence ${unknown}, which was not provided` };
    }
    // A part marked supported or contradicted without any passage is not
    // grounded, so it counts as not reported. This can only weaken a verdict.
    const grounded = status !== "not_reported" && ids.length > 0;
    parts.push({
      part: part as PartAssessment["part"],
      status: grounded ? (status as PartAssessment["status"]) : "not_reported",
      evidence: grounded ? ids.join(", ") : null,
    });
  }
  return parts.length > 0 ? { ok: true, parts } : { ok: false, problem: "the model assessed no part of the claim" };
}

export type ValidationResult =
  | { ok: true; judgement: ValidatedJudgement }
  | { ok: false; problem: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateJudgement(
  raw: string,
  knownIds: Set<string>,
): ValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, problem: "the model did not return valid JSON" };
  }
  if (!isRecord(parsed))
    return { ok: false, problem: "the model output was not a JSON object" };

  const verdict = parsed.verdict;
  if (
    typeof verdict !== "string" ||
    !(MODEL_VERDICTS as readonly string[]).includes(verdict)
  ) {
    return {
      ok: false,
      problem: `the model returned an unknown verdict (${String(verdict)})`,
    };
  }
  if (Array.isArray(parsed.parts)) {
    const checked = validateParts(parsed.parts, knownIds);
    if (!checked.ok) return checked;
    const cited = new Map<string, (typeof MODEL_RELATIONS)[number]>();
    for (const item of checked.parts) {
      if (!item.evidence) continue;
      const relation = item.status === "contradicted" ? "contradicts" : "supports";
      for (const id of evidenceIds(item.evidence)) {
        const previous = cited.get(id);
        cited.set(id, previous && previous !== relation ? "context" : relation);
      }
    }
    const explanation =
      typeof parsed.explanation === "string" && parsed.explanation.trim()
        ? parsed.explanation.trim().slice(0, 600)
        : null;
    return {
      ok: true,
      judgement: {
        verdict: verdictFromParts(checked.parts),
        cited,
        explanation,
        parts: checked.parts,
        modelVerdict: verdict as ModelVerdict,
      },
    };
  }
  if (!Array.isArray(parsed.evidence)) {
    return { ok: false, problem: "the model did not list its evidence" };
  }

  const cited = new Map<string, (typeof MODEL_RELATIONS)[number]>();
  for (const entry of parsed.evidence) {
    if (!isRecord(entry) || typeof entry.id !== "string") {
      return { ok: false, problem: "the model listed evidence without an id" };
    }
    if (!knownIds.has(entry.id)) {
      return {
        ok: false,
        problem: `the model cited evidence ${entry.id}, which was not provided`,
      };
    }
    const relation = entry.relation;
    if (
      typeof relation !== "string" ||
      !(MODEL_RELATIONS as readonly string[]).includes(relation)
    ) {
      return {
        ok: false,
        problem: `the model gave evidence ${entry.id} an unknown role`,
      };
    }
    const previous = cited.get(entry.id);
    if (previous && previous !== relation) {
      return {
        ok: false,
        problem: `the model gave evidence ${entry.id} two different roles`,
      };
    }
    cited.set(entry.id, relation as (typeof MODEL_RELATIONS)[number]);
  }

  const relations = new Set(cited.values());
  if (
    (verdict === "Supported" || verdict === "Partially supported") &&
    !relations.has("supports")
  ) {
    return {
      ok: false,
      problem: `the model said "${verdict}" without citing a supporting passage`,
    };
  }
  if (verdict === "Supported" && relations.has("contradicts")) {
    return {
      ok: false,
      problem: `the model said "Supported" while citing a contradicting passage`,
    };
  }
  if (verdict === "Contradicted" && !relations.has("contradicts")) {
    return {
      ok: false,
      problem: `the model said "Contradicted" without citing a contradicting passage`,
    };
  }

  const explanation =
    typeof parsed.explanation === "string" && parsed.explanation.trim()
      ? parsed.explanation.trim().slice(0, 600)
      : null;
  return {
    ok: true,
    judgement: { verdict: verdict as ModelVerdict, cited, explanation },
  };
}
