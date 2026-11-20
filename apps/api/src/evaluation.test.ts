import { describe, expect, test } from "bun:test";
import type { EvaluationCaseResponse } from "@citeverify/shared";
import { isInvalidClaim } from "./evaluation.ts";
import {
  app,
  configureEvidenceRetrieval,
  configureVerification,
} from "./index.ts";

/** A fake local model: answers with `answer`, recording every prompt. */
function model(answer: object | null) {
  const prompts: string[] = [];
  configureVerification({
    host: "http://ollama.test",
    model: "llama3.2",
    fetch: async (input: string, init?: RequestInit) => {
      if (!answer) throw new TypeError("fetch failed");
      if (input.endsWith("/api/tags"))
        return Response.json({ models: [{ name: "llama3.2:latest" }] });
      prompts.push(JSON.parse(String(init?.body)).messages[1].content);
      return Response.json({ message: { content: JSON.stringify(answer) } });
    },
  });
  return prompts;
}

const SUPPORTED = {
  parts: [{ part: "finding", status: "supported", evidence: "E1" }],
  topic_match: "same_question",
  verdict: "Supported",
  explanation: "The snippet states this.",
};

const baseCase = {
  caseId: "TC-001",
  claim:
    "The Transformer relies entirely on self-attention, dispensing with recurrence and convolutions.",
  inlineCitation: "(Vaswani et al., 2017)",
  referenceEntry:
    "Vaswani, A., Shazeer, N. (2017). Attention is all you need. Advances in Neural Information Processing Systems, 30.",
  doi: "10.48550/arXiv.1706.03762",
  evidenceSnippet:
    "We propose the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely.",
};

async function run(body: object): Promise<{
  status: number;
  json: EvaluationCaseResponse & { error?: { code: string } };
}> {
  const response = await app.request("http://localhost/api/evaluation/case", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    json: (await response.json()) as EvaluationCaseResponse & {
      error?: { code: string };
    },
  };
}

describe("dataset evaluation endpoint", () => {
  test("supplied mode judges only the dataset snippet and labels it as supplied, not retrieved", async () => {
    const prompts = model(SUPPORTED);
    const { status, json } = await run({ mode: "supplied", ...baseCase });
    expect(status).toBe(200);
    expect(json).toMatchObject({
      outcome: "verified",
      verdict: "Supported",
      provenance: { kind: "dataset_supplied" },
      evidence: [{ id: "E1", relation: "supports", url: "dataset:TC-001" }],
    });
    expect(json.provenance.detail).toContain("did not retrieve");
    expect(json.reason ?? "").not.toContain("abstracts");
    expect(prompts[0]).toContain("based solely on attention mechanisms");
  });

  test("invalid and garbage claims are rejected before any model call", async () => {
    for (const claim of ["", "   ###   \t\n   ", "a b c"]) {
      const prompts = model(SUPPORTED);
      const { json } = await run({ mode: "supplied", ...baseCase, claim });
      expect(json).toMatchObject({ outcome: "invalid_input", verdict: null });
      expect(prompts).toHaveLength(0);
    }
  });

  test("a claim without a citation is reported as such, not as unsupported", async () => {
    const prompts = model(SUPPORTED);
    const { json } = await run({
      mode: "supplied",
      ...baseCase,
      inlineCitation: "NONE",
      referenceEntry: "NONE",
    });
    expect(json).toMatchObject({ outcome: "no_citation", verdict: null });
    expect(prompts).toHaveLength(0);
  });

  test("a sentinel snippet such as NO_SOURCE_FOUND is no evidence, never evidence text", async () => {
    const prompts = model(SUPPORTED);
    const { json } = await run({
      mode: "supplied",
      ...baseCase,
      evidenceSnippet: "NO_SOURCE_FOUND",
    });
    expect(json).toMatchObject({
      outcome: "no_evidence",
      verdict: "Unable to verify",
      provenance: { kind: "none" },
    });
    expect(prompts).toHaveLength(0);
  });

  test("an unavailable model is a failure, not a verdict about the claim", async () => {
    model(null);
    const { json } = await run({ mode: "supplied", ...baseCase });
    expect(json).toMatchObject({
      outcome: "model_failure",
      verdict: "Unable to verify",
      unableCause: "model_unavailable",
    });
  });

  test("live mode ignores the snippet and reports a reference no service can find", async () => {
    const prompts = model(SUPPORTED);
    configureEvidenceRetrieval({
      cache: new Map(),
      sleep: async () => {},
      maxRetries: 0,
      fetch: async (input: string) =>
        /api\.crossref\.org\/works\/10\./.test(decodeURIComponent(input))
          ? new Response("not found", { status: 404 })
          : /crossref|openalex/.test(input)
            ? Response.json({ message: { items: [] }, results: [] })
            : new Response("not mocked", { status: 404 }),
    });
    const { json } = await run({ mode: "live", ...baseCase });
    expect(json).toMatchObject({
      outcome: "reference_not_found",
      verdict: "Unable to verify",
    });
    expect(json.provenance.kind).toBe("none");
    expect(prompts.join(" ")).not.toContain(
      "based solely on attention mechanisms",
    );
  });

  test("malformed requests get a stable error code", async () => {
    model(SUPPORTED);
    expect((await run({ mode: "other", ...baseCase })).json.error?.code).toBe(
      "INVALID_EVALUATION_REQUEST",
    );
    expect((await run({ mode: "supplied", caseId: "x" })).status).toBe(400);
    expect(
      (await run({ mode: "supplied", ...baseCase, claim: "x".repeat(2_001) }))
        .status,
    ).toBe(400);
  });

  test("claim validation keeps real short claims", () => {
    expect(isInvalidClaim("Aspirin reduces fever.")).toBe(false);
    expect(isInvalidClaim("$$\\alpha$$ ###")).toBe(true);
  });
});
