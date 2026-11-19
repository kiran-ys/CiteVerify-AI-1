/**
 * Client for Groq's hosted, OpenAI-compatible chat API, used when the
 * operator sets GROQ_API_KEY (for example on a public server without
 * Ollama). Only the prompt is sent: the claim, its context, and retrieved
 * passages from public sources. The API key stays on the server.
 */
import type { FetchLike, Judge } from "./ollama.ts";

export type GroqConfig = {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
  /** Longest wait the client accepts when Groq asks it to retry later. */
  maxRetryWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

export const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
/** Groq's generally available models are OpenAI's open-weight GPT-OSS family
 * (Llama models are Enterprise-only since 2026). */
export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";

/** GPT-OSS models reason before answering; the reasoning counts toward the
 * output limit, so it is kept short and left out of the response. */
export function isReasoningModel(model: string): boolean {
  return model.startsWith("openai/gpt-oss");
}
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRY_WAIT_MS = 15_000;
const MAX_RETRIES = 2;

export type GroqStatus = {
  available: boolean;
  modelInstalled: boolean;
  reason: string | null;
};

const realSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Seconds to wait from a retry-after header ("7" or "7.5"), else null. */
export function retryAfterMs(response: Response): number | null {
  const header = response.headers.get("retry-after");
  const seconds = header === null ? Number.NaN : Number(header);
  return Number.isFinite(seconds) && seconds >= 0
    ? Math.ceil(seconds * 1000)
    : null;
}

async function call(
  config: GroqConfig,
  path: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const fetchImpl = config.fetch ?? ((input, options) => fetch(input, options));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(`${config.baseUrl ?? GROQ_BASE_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Checks the key and model by listing models (no tokens are used). */
export async function groqStatus(config: GroqConfig): Promise<GroqStatus> {
  if (!config.apiKey) {
    return {
      available: false,
      modelInstalled: false,
      reason: "No hosted model is configured (GROQ_API_KEY is not set).",
    };
  }
  try {
    const response = await call(config, "/models", {}, 5_000);
    if (response.status === 401 || response.status === 403) {
      return {
        available: false,
        modelInstalled: false,
        reason: "The hosted model rejected the server's API key.",
      };
    }
    if (!response.ok) {
      return {
        available: false,
        modelInstalled: false,
        reason: `The hosted model service answered HTTP ${response.status}.`,
      };
    }
    const body = (await response.json()) as { data?: { id?: string }[] };
    const listed = (body.data ?? []).some((model) => model.id === config.model);
    return {
      available: true,
      modelInstalled: listed,
      reason: listed
        ? null
        : `The hosted model "${config.model}" is not offered by Groq.`,
    };
  } catch {
    return {
      available: false,
      modelInstalled: false,
      reason: "The hosted model service could not be reached.",
    };
  }
}

export function groqJudge(config: GroqConfig): Judge {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxWait = config.maxRetryWaitMs ?? DEFAULT_MAX_RETRY_WAIT_MS;
  const sleep = config.sleep ?? realSleep;
  return async ({ system, user, schema }) => {
    const body = JSON.stringify({
      model: config.model,
      temperature: 0,
      seed: 7,
      ...(isReasoningModel(config.model)
        ? {
            reasoning_effort: "low",
            include_reasoning: false,
            max_completion_tokens: 2000,
          }
        : { max_tokens: 400 }),
      // JSON mode guarantees valid JSON; the shape is stated in the prompt
      // and checked by validateJudgement like any other model's answer.
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `${system}\n\nAnswer with one JSON object matching this JSON Schema:\n${JSON.stringify(schema)}`,
        },
        { role: "user", content: user },
      ],
    });
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await call(
          config,
          "/chat/completions",
          { method: "POST", body },
          timeoutMs,
        );
      } catch (error) {
        const aborted = error instanceof Error && error.name === "AbortError";
        return {
          ok: false,
          kind: aborted ? "timeout" : "error",
          reason: aborted
            ? `The hosted model did not answer within ${Math.round(timeoutMs / 1000)} s`
            : "The hosted model service could not be reached",
        };
      }
      if (response.status === 429 || response.status >= 500) {
        const wait = retryAfterMs(response) ?? 2_000 * (attempt + 1);
        if (attempt < MAX_RETRIES && wait <= maxWait) {
          await sleep(wait);
          continue;
        }
        return {
          ok: false,
          kind: "error",
          reason:
            response.status === 429
              ? `The hosted model's free rate limit was reached${wait ? `; try again in about ${Math.ceil(wait / 1000)} s` : ""}`
              : `The hosted model service answered HTTP ${response.status}`,
        };
      }
      if (!response.ok) {
        return {
          ok: false,
          kind: "error",
          reason:
            response.status === 401 || response.status === 403
              ? "The hosted model rejected the server's API key"
              : `The hosted model service answered HTTP ${response.status}`,
        };
      }
      const parsed = (await response.json().catch(() => null)) as {
        choices?: { message?: { content?: unknown } }[];
      } | null;
      const content = parsed?.choices?.[0]?.message?.content;
      return typeof content === "string"
        ? { ok: true, content }
        : {
            ok: false,
            kind: "error",
            reason: "The hosted model returned no message content",
          };
    }
  };
}
