/**
 * Strict validation of model output. Anything that does not meet the
 * evidence rules is rejected, and the caller reports "Unable to verify".
 */
import {
  MODEL_RELATIONS,
  MODEL_VERDICTS,
  type ModelVerdict,
} from "./prompt.ts";

export type ValidatedJudgement = {
  verdict: ModelVerdict;
  cited: Map<string, (typeof MODEL_RELATIONS)[number]>;
  explanation: string | null;
};

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
