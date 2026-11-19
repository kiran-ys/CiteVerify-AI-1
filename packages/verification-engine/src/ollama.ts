/**
 * Minimal client for a local Ollama server over its HTTP API. No SDK and no
 * remote service: prompts stay on the operator's machine.
 */

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export type OllamaConfig = {
  host: string;
  model: string;
  fetch?: FetchLike;
  /** Per-call limit; the first call may include loading the model into memory. */
  timeoutMs?: number;
};

export const DEFAULT_OLLAMA_HOST = "http://127.0.0.1:11434";
export const DEFAULT_OLLAMA_MODEL = "llama3.2";
/** Per-claim model call limit. */
export const DEFAULT_CLAIM_TIMEOUT_MS = 45_000;

export type JudgeRequest = { system: string; user: string; schema: object };
export type JudgeResult =
  | { ok: true; content: string }
  | { ok: false; kind: "timeout" | "error"; reason: string };
/** Anything that can answer a judging prompt; tests supply a fake. */
export type Judge = (request: JudgeRequest) => Promise<JudgeResult>;

async function withTimeout(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export type OllamaStatus = {
  available: boolean;
  modelInstalled: boolean;
  reason: string | null;
};

/** Model names as Ollama lists them: "llama3.2" is stored as "llama3.2:latest". */
function sameModel(listed: string, wanted: string): boolean {
  return listed === wanted || listed === `${wanted}:latest`;
}

export async function ollamaStatus(
  config: OllamaConfig,
): Promise<OllamaStatus> {
  const fetchImpl = config.fetch ?? ((input, init) => fetch(input, init));
  try {
    const response = await withTimeout(
      fetchImpl,
      `${config.host}/api/tags`,
      {},
      3_000,
    );
    if (!response.ok) {
      return {
        available: false,
        modelInstalled: false,
        reason: `Ollama answered HTTP ${response.status}.`,
      };
    }
    const body = (await response.json()) as { models?: { name?: string }[] };
    const installed = (body.models ?? []).some((model) =>
      sameModel(model.name ?? "", config.model),
    );
    return {
      available: true,
      modelInstalled: installed,
      reason: installed
        ? null
        : `The model "${config.model}" is not installed in Ollama. Run: ollama pull ${config.model}`,
    };
  } catch {
    return {
      available: false,
      modelInstalled: false,
      reason: `No Ollama server answered at ${config.host}. Start it with: ollama serve`,
    };
  }
}

export function ollamaJudge(config: OllamaConfig): Judge {
  const fetchImpl = config.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = config.timeoutMs ?? DEFAULT_CLAIM_TIMEOUT_MS;
  return async ({ system, user, schema }) => {
    try {
      const response = await withTimeout(
        fetchImpl,
        `${config.host}/api/chat`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: config.model,
            stream: false,
            format: schema,
            // Deterministic decoding so the same evidence gives the same verdict.
            // Short, bounded answers: output length dominates latency.
            options: {
              temperature: 0,
              seed: 7,
              num_ctx: 8192,
              num_predict: 300,
            },
            // Keep the model loaded between claims and runs.
            keep_alive: "30m",
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
          }),
        },
        timeoutMs,
      );
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 200);
        return {
          ok: false,
          kind: "error",
          reason: `Ollama answered HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
        };
      }
      const body = (await response.json()) as {
        message?: { content?: unknown };
      };
      const content = body.message?.content;
      return typeof content === "string"
        ? { ok: true, content }
        : {
            ok: false,
            kind: "error",
            reason: "Ollama returned no message content",
          };
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      return {
        ok: false,
        kind: aborted ? "timeout" : "error",
        reason: aborted
          ? `The local model did not answer within ${Math.round(timeoutMs / 1000)} s`
          : `Ollama could not be reached at ${config.host}`,
      };
    }
  };
}
