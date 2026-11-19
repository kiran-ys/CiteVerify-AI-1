/**
 * A small, polite HTTP client for free scholarly APIs: per-request timeout,
 * bounded retries on rate limits and server errors (honouring Retry-After),
 * a global concurrency cap, an overall deadline, and an in-memory cache.
 * The fetch implementation is injectable so tests never touch the network.
 */
import type { ScholarlyService, ServiceError } from "@citeverify/shared";

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export type HttpOptions = {
  fetch?: FetchLike;
  timeoutMs?: number;
  maxRetries?: number;
  /** Longest wait honoured from a Retry-After header or backoff. */
  maxBackoffMs?: number;
  concurrency?: number;
  /** Absolute time (ms since epoch) after which no new request starts. */
  deadline?: number;
  /** Optional operator contact sent to Crossref's polite pool; never the uploader's details. */
  contactEmail?: string;
  sleep?: (ms: number) => Promise<void>;
  cache?: Map<string, { expires: number; body: string }>;
  cacheTtlMs?: number;
};

export type HttpResult =
  | { ok: true; status: number; body: string }
  | { ok: false; error: ServiceError; status: number | null };

export const USER_AGENT =
  "CiteVerify/0.1 (research prototype; evidence retrieval)";

const sharedCache = new Map<string, { expires: number; body: string }>();

export class HttpClient {
  private readonly active = new Map<ScholarlyService, number>();
  private readonly waiting = new Map<ScholarlyService, (() => void)[]>();
  private readonly options: Required<
    Omit<HttpOptions, "contactEmail" | "deadline">
  > & {
    contactEmail?: string;
    deadline?: number;
  };

  constructor(options: HttpOptions = {}) {
    this.options = {
      fetch: options.fetch ?? ((input, init) => fetch(input, init)),
      // Europe PMC search can take well over 10 s at busy times.
      timeoutMs: options.timeoutMs ?? 20_000,
      maxRetries: options.maxRetries ?? 2,
      maxBackoffMs: options.maxBackoffMs ?? 5_000,
      concurrency: options.concurrency ?? 3,
      sleep:
        options.sleep ??
        ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
      cache: options.cache ?? sharedCache,
      cacheTtlMs: options.cacheTtlMs ?? 6 * 60 * 60 * 1000,
      contactEmail: options.contactEmail,
      deadline: options.deadline,
    };
  }

  /** Crossref and NCBI ask clients to identify themselves; we add an operator email only when configured. */
  withContact(url: URL, service: ScholarlyService): URL {
    if (!this.options.contactEmail) return url;
    if (service === "crossref")
      url.searchParams.set("mailto", this.options.contactEmail);
    if (service === "ncbi-pmc")
      url.searchParams.set("email", this.options.contactEmail);
    return url;
  }

  deadlinePassed(): boolean {
    return (
      this.options.deadline !== undefined && Date.now() >= this.options.deadline
    );
  }

  /**
   * Crossref's public pool allows very little parallelism; its "polite" pool
   * (requests carrying a contact email) allows more. Other services use the
   * general limit.
   */
  limitFor(service: ScholarlyService): number {
    if (service === "crossref")
      return this.options.contactEmail
        ? Math.min(3, this.options.concurrency)
        : 1;
    return this.options.concurrency;
  }

  private async acquire(service: ScholarlyService): Promise<void> {
    const active = this.active.get(service) ?? 0;
    if (active < this.limitFor(service)) {
      this.active.set(service, active + 1);
      return;
    }
    await new Promise<void>((resolve) => {
      const queue = this.waiting.get(service) ?? [];
      queue.push(resolve);
      this.waiting.set(service, queue);
    });
    this.active.set(service, (this.active.get(service) ?? 0) + 1);
  }

  private release(service: ScholarlyService): void {
    this.active.set(service, (this.active.get(service) ?? 1) - 1);
    this.waiting.get(service)?.shift()?.();
  }

  /** Per-request timeout, never extending past the overall deadline. */
  private timeoutFor(): number {
    if (this.options.deadline === undefined) return this.options.timeoutMs;
    return Math.max(
      1,
      Math.min(this.options.timeoutMs, this.options.deadline - Date.now()),
    );
  }

  private async once(
    url: string,
    accept: string,
  ): Promise<HttpResult & { retryAfterMs?: number }> {
    const controller = new AbortController();
    const timeoutMs = this.timeoutFor();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.options.fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: accept },
        signal: controller.signal,
      });
      const body = await response.text();
      if (response.ok) return { ok: true, status: response.status, body };
      const retryAfter = Number(response.headers.get("retry-after"));
      return {
        ok: false,
        status: response.status,
        retryAfterMs:
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : undefined,
        error: {
          service: "crossref",
          kind: response.status === 429 ? "rate_limited" : "http",
          message: `HTTP ${response.status}`,
        },
      };
    } catch (error) {
      const aborted = controller.signal.aborted;
      return {
        ok: false,
        status: null,
        error: {
          service: "crossref",
          kind: aborted ? "timeout" : "network",
          message: aborted
            ? `No response within ${timeoutMs} ms`
            : error instanceof Error
              ? error.message
              : "Network request failed",
        },
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async get(
    url: string,
    service: ScholarlyService,
    accept = "application/json",
  ): Promise<HttpResult> {
    const cached = this.options.cache.get(url);
    if (cached && cached.expires > Date.now())
      return { ok: true, status: 200, body: cached.body };

    let last: HttpResult = {
      ok: false,
      status: null,
      error: {
        service,
        kind: "timeout",
        message: "Time budget for this request was exhausted",
      },
    };
    for (let attempt = 0; attempt <= this.options.maxRetries; attempt++) {
      if (this.deadlinePassed()) break;
      await this.acquire(service);
      let result: HttpResult & { retryAfterMs?: number };
      try {
        // The deadline may have passed while this request waited its turn.
        if (this.deadlinePassed()) break;
        result = await this.once(url, accept);
      } finally {
        this.release(service);
      }
      if (result.ok) {
        this.options.cache.set(url, {
          expires: Date.now() + this.options.cacheTtlMs,
          body: result.body,
        });
        return result;
      }
      last = {
        ok: false,
        status: result.status,
        error: { ...result.error, service },
      };
      const retryable =
        result.error.kind === "rate_limited" ||
        result.error.kind === "timeout" ||
        result.error.kind === "network" ||
        (result.status !== null && result.status >= 500);
      if (!retryable || attempt === this.options.maxRetries) break;
      const backoff = Math.min(
        result.retryAfterMs ?? 500 * 2 ** attempt,
        this.options.maxBackoffMs,
      );
      await this.options.sleep(backoff);
    }
    return last;
  }

  async getJson(
    url: string,
    service: ScholarlyService,
  ): Promise<
    | { ok: true; data: unknown }
    | { ok: false; error: ServiceError; status: number | null }
  > {
    const result = await this.get(url, service);
    if (!result.ok) return result;
    try {
      return { ok: true, data: JSON.parse(result.body) };
    } catch {
      return {
        ok: false,
        status: result.status,
        error: {
          service,
          kind: "invalid_response",
          message: "Response was not valid JSON",
        },
      };
    }
  }
}
