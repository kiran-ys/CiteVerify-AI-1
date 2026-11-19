/**
 * Reasoning benchmark: runs each case in eval/benchmark/cases.json through
 * the real verifier (same prompt, validation, and verdict rules as the app)
 * with its fixed evidence from evidence-snapshot.json, then writes metrics.
 *
 *   bun run --cwd apps/api scripts/run-benchmark.ts --provider groq [--limit 5]
 *   bun run --cwd apps/api scripts/run-benchmark.ts --provider ollama
 *
 * Groq needs GROQ_API_KEY in the environment. Labels are provisional unless a
 * case says otherwise; the report states this.
 */
import type {
  EvidencePassage,
  ExtractedClaim,
  InTextCitation,
  ReferenceEntry,
  RetrievedSource,
  VerificationVerdict,
} from "@citeverify/shared";
import {
  DEFAULT_GROQ_MODEL,
  DEFAULT_OLLAMA_HOST,
  DEFAULT_OLLAMA_MODEL,
  groqJudge,
  groqStatus,
  type Judge,
  ollamaJudge,
  ollamaStatus,
  PROMPT_VERSION,
  verifyClaims,
} from "@citeverify/verification-engine";

type Passage = {
  id: string;
  referenceNumber: number | null;
  source: string | null;
  doi: string | null;
  url: string;
  origin: "full_text" | "abstract";
  text: string;
};
type Snapshot = { paper: string; claimId: string; passages: Passage[] };
type Case = {
  id: string;
  kind: "real" | "altered";
  category: string;
  claim: string;
  evidenceOf: string;
  expected: VerificationVerdict;
  certainty: "clear" | "borderline";
  reviewStatus: string;
};

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const provider = arg("--provider") === "groq" ? "groq" : "ollama";
const limit = Number(arg("--limit") ?? 0) || Infinity;
const delayMs = Number(arg("--delay-ms") ?? (provider === "groq" ? 2500 : 0));
const root = new URL("../../../", import.meta.url).pathname;
const snapshot = (await Bun.file(
  `${root}eval/benchmark/evidence-snapshot.json`,
).json()) as {
  capturedAt: string;
  cases: Snapshot[];
};
const allCases = (
  (await Bun.file(`${root}eval/benchmark/cases.json`).json()) as {
    cases: Case[];
  }
).cases;
const cases = allCases.slice(0, limit);
const evidenceOf = new Map(
  snapshot.cases.map((s) => [`${s.paper}/${s.claimId}`, s.passages]),
);

const groq = {
  // From the environment, or from tmp/groq-api-key (git-ignored) so the key
  // never has to appear on a command line. It is never printed.
  apiKey:
    process.env.GROQ_API_KEY ||
    ((await Bun.file(`${root}tmp/groq-api-key`).exists())
      ? (await Bun.file(`${root}tmp/groq-api-key`).text()).trim()
      : ""),
  model: process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL,
};
const ollama = {
  host: process.env.OLLAMA_HOST || DEFAULT_OLLAMA_HOST,
  model: process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL,
};
const model = provider === "groq" ? groq.model : ollama.model;
const status =
  provider === "groq" ? await groqStatus(groq) : await ollamaStatus(ollama);
if (!status.available || !status.modelInstalled) {
  console.error(`Model not usable: ${status.reason}`);
  process.exit(1);
}
const base: Judge = provider === "groq" ? groqJudge(groq) : ollamaJudge(ollama);
let calls = 0;
const judge: Judge = async (request) => {
  if (calls++ > 0 && delayMs) await Bun.sleep(delayMs);
  return base(request);
};

/** One claim citing one source per reference number, holding the fixed passages. */
function inputFor(c: Case, passages: Passage[]) {
  const claim: ExtractedClaim = {
    id: "claim-1",
    text: c.claim,
    page: 1,
    location: { start: 0, end: c.claim.length },
    section: null,
    context: { before: null, after: null },
    type: "cited_claim",
    extraction: { method: "rule-based", version: "benchmark", signals: [] },
  };
  const groups = new Map<string, Passage[]>();
  for (const p of passages) {
    const key = String(p.referenceNumber ?? p.source ?? "source");
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  const references: ReferenceEntry[] = [];
  const sources: RetrievedSource[] = [];
  for (const [key, items] of groups) {
    const id = `ref-${key}`;
    references.push({
      id,
      number: Number(key) || null,
      text: items[0]?.source ?? key,
      page: 1,
      pageEnd: 1,
      location: null,
      metadata: {
        authors: [],
        year: null,
        title: items[0]?.source ?? null,
        doi: items[0]?.doi ?? null,
      },
    });
    sources.push({
      referenceId: id,
      claimIds: [claim.id],
      resolution: {
        status: "resolved",
        reason: null,
        matchedBy: "doi",
        resolver: "crossref",
        candidates: [],
      },
      work: items[0]?.source
        ? {
            title: items[0].source,
            authors: [],
            year: null,
            doi: items[0].doi,
            journal: null,
            pmid: null,
            pmcid: null,
            openAlexId: null,
          }
        : null,
      access: items.some((p) => p.origin === "full_text")
        ? "full_text"
        : "abstract_only",
      accessReason: null,
      license: null,
      urls: {
        doi: items[0]?.doi ? `https://doi.org/${items[0].doi}` : null,
        landingPage: null,
        fullText: null,
      },
      // Scores keep the snapshot's order when the verifier re-selects passages.
      passages: items.map(
        (p, i): EvidencePassage => ({
          claimId: claim.id,
          text: p.text,
          markupRemoved: false,
          origin: p.origin,
          location: { section: null, paragraph: 0, sentence: i },
          sourceUrl: p.url,
          relevance: {
            method: "term-overlap",
            sharedTerms: [],
            score: 100 - i,
          },
        }),
      ),
      errors: [],
    });
  }
  const citation: InTextCitation = {
    id: "cit-1",
    marker: "[x]",
    style: "numeric",
    page: 1,
    location: { start: 0, end: 1 },
    claimId: claim.id,
    matches: references.map((r) => ({
      key: r.id,
      status: "matched" as const,
      referenceIds: [r.id],
      reason: null,
    })),
  };
  return { claims: [claim], citations: [citation], references, sources };
}

// Progress is saved after every case, so an interrupted run resumes where it
// stopped (use --fresh to start over). Failed calls are retried on resume.
const progressFile = `${root}eval/results/progress-${provider}-${model.replace(/[^\w.-]+/g, "_")}-${PROMPT_VERSION}.json`;
const saved: Record<string, unknown>[] =
  !process.argv.includes("--fresh") && (await Bun.file(progressFile).exists())
    ? (
        (await Bun.file(progressFile).json()) as {
          rows: Record<string, unknown>[];
        }
      ).rows
    : [];
const rows: Record<string, unknown>[] = saved.filter(
  (r) => r.failure !== "model_error" && r.failure !== "model_timeout",
);
const done = new Set(rows.map((r) => r.id));
if (done.size)
  console.log(
    `Resuming: ${done.size} of ${cases.length} cases already done (${progressFile}).`,
  );
await Bun.$`mkdir -p ${root}eval/results`;
let consecutiveRateLimits = 0;
let index = 0;
for (const c of cases) {
  index++;
  if (done.has(c.id)) continue;
  const passages = evidenceOf.get(c.evidenceOf) ?? [];
  const started = Date.now();
  const result = (
    await verifyClaims(inputFor(c, passages), {
      judge,
      modelName: model,
      provider,
      timeBudgetMs: 120_000,
    })
  ).results[0];
  const ms = Date.now() - started;
  const predicted = result?.verdict ?? "Unable to verify";
  const cited = (result?.evidence ?? []).filter(
    (e) => e.relation === "supports" || e.relation === "contradicts",
  );
  // Traceability: every cited passage must be one of the case's stored source sentences.
  const traceable = cited.every((e) => passages.some((p) => p.text === e.text));
  const failure =
    result?.unableCause &&
    !["insufficient_evidence", "no_evidence"].includes(result.unableCause)
      ? result.unableCause
      : null;
  rows.push({
    id: c.id,
    availability:
      passages.length === 0
        ? "none"
        : passages.some((p) => p.origin === "full_text")
          ? "full_text"
          : "abstract_only",
    kind: c.kind,
    category: c.category,
    certainty: c.certainty,
    reviewStatus: c.reviewStatus,
    expected: c.expected,
    predicted,
    correct: predicted === c.expected,
    failure,
    rateLimited: /rate limit/i.test(result?.reason ?? ""),
    calledModel: result?.decidedBy === "model" || failure !== null,
    citedEvidence: cited.map((e) => e.evidenceId),
    traceable,
    ms,
    reason: result?.reason ?? null,
    explanation: result?.explanation ?? null,
  });
  await Bun.write(
    progressFile,
    `${JSON.stringify({ provider, model, promptVersion: PROMPT_VERSION, rows }, null, 2)}\n`,
  );
  const limited = /rate limit/i.test(result?.reason ?? "");
  consecutiveRateLimits = limited ? consecutiveRateLimits + 1 : 0;
  console.log(
    `[${index}/${cases.length}] ${predicted === c.expected ? "ok  " : "MISS"} ${c.id}: expected ${c.expected}, got ${predicted}${failure ? ` (${failure})` : ""} ${(ms / 1000).toFixed(1)} s`,
  );
  if (consecutiveRateLimits >= 3) {
    console.log(
      `Stopped after 3 rate-limited calls in a row; progress is saved. Run the same command later to resume.`,
    );
    process.exit(2);
  }
}

// ------------------------------------------------------------------ metrics
const LABELS: VerificationVerdict[] = [
  "Supported",
  "Partially supported",
  "Contradicted",
  "Unsupported",
  "Unable to verify",
];
type Row = (typeof rows)[number] & {
  expected: string;
  predicted: string;
  correct: boolean;
};
const all = rows as Row[];
const pct = (n: number, d: number) =>
  d ? `${((100 * n) / d).toFixed(1)}%` : "n/a";
const perLabel = LABELS.map((label) => {
  const tp = all.filter(
    (r) => r.expected === label && r.predicted === label,
  ).length;
  const fp = all.filter(
    (r) => r.expected !== label && r.predicted === label,
  ).length;
  const fn = all.filter(
    (r) => r.expected === label && r.predicted !== label,
  ).length;
  const p = tp + fp ? tp / (tp + fp) : 0;
  const rc = tp + fn ? tp / (tp + fn) : 0;
  return {
    label,
    support: tp + fn,
    precision: p,
    recall: rc,
    f1: p + rc ? (2 * p * rc) / (p + rc) : 0,
  };
});
const present = perLabel.filter((l) => l.support > 0);
const macro = (k: "precision" | "recall" | "f1") =>
  present.reduce((s, l) => s + l[k], 0) / (present.length || 1);
const subset = (pred: (r: Row) => boolean) => {
  const s = all.filter(pred);
  return `${s.filter((r) => r.correct).length}/${s.length} (${pct(s.filter((r) => r.correct).length, s.length)})`;
};
const weighted = (k: "f1") =>
  perLabel.reduce((s, l) => s + l[k] * l.support, 0) / (all.length || 1);
const latencies = all
  .filter((r) => r.calledModel)
  .map((r) => r.ms as number)
  .sort((a, b) => a - b);
const percentile = (q: number) =>
  latencies.length
    ? (latencies[
        Math.min(latencies.length - 1, Math.floor(q * latencies.length))
      ] ?? 0)
    : 0;
const answered = all.filter((r) => r.predicted !== "Unable to verify");
const modelRows = all.filter((r) => r.calledModel);
const positive = all.filter((r) =>
  ["Supported", "Partially supported", "Contradicted"].includes(r.predicted),
);
const avgMs =
  modelRows.reduce((s, r) => s + (r.ms as number), 0) / (modelRows.length || 1);
const commit = (
  await Bun.$`git -C ${root} rev-parse --short HEAD`.text()
).trim();
const date = new Date().toISOString().slice(0, 10);

const md = [
  `# CiteVerify reasoning benchmark — ${date}`,
  "",
  `- Commit: \`${commit}\` (plus uncommitted changes if any) · Provider: ${provider} · Model: \`${model}\``,
  `- Cases: ${all.length} (${all.filter((r) => r.kind === "real").length} real claims, ${all.filter((r) => r.kind === "altered").length} deliberately altered). Evidence snapshot captured ${snapshot.capturedAt.slice(0, 10)}.`,
  `- **Label status: ${all.filter((r) => r.reviewStatus !== "provisional").length} human-reviewed, ${all.filter((r) => r.reviewStatus === "provisional").length} provisional (AI-assisted).** These numbers measure agreement with provisional labels, not scientific accuracy.`,
  "",
  "## Summary",
  "",
  "| Metric | Value |",
  "| --- | --- |",
  `| Overall accuracy | ${subset(() => true)} |`,
  `| Accuracy, clear cases | ${subset((r) => r.certainty === "clear")} |`,
  `| Accuracy, borderline cases | ${subset((r) => r.certainty === "borderline")} |`,
  `| Accuracy, real claims | ${subset((r) => r.kind === "real")} |`,
  `| Accuracy, altered claims | ${subset((r) => r.kind === "altered")} |`,
  `| Agreement, human-reviewed labels | ${subset((r) => r.reviewStatus !== "provisional")} |`,
  `| Agreement, evidence: abstract only / full text / none | ${subset((r) => r.availability === "abstract_only")} / ${subset((r) => r.availability === "full_text")} / ${subset((r) => r.availability === "none")} |`,
  `| Macro precision / recall / F1 | ${macro("precision").toFixed(2)} / ${macro("recall").toFixed(2)} / ${macro("f1").toFixed(2)} |`,
  `| Weighted F1 (by expected-class size) | ${weighted("f1").toFixed(2)} |`,
  `| Abstention rate (predicted Unable to verify) | ${pct(all.length - answered.length, all.length)} |`,
  `| Agreement when the model did not abstain | ${subset((r) => r.predicted !== "Unable to verify")} |`,
  `| Evidence retrieval success (cases with at least one stored passage) | ${pct(all.filter((r) => r.availability !== "none").length, all.length)} |`,
  `| Invalid model output rate | ${pct(all.filter((r) => r.failure === "invalid_output").length, modelRows.length)} of model calls |`,
  `| API failures / timeouts / rate limits | ${all.filter((r) => r.failure === "model_error").length} / ${all.filter((r) => r.failure === "model_timeout").length} / ${all.filter((r) => r.rateLimited).length} |`,
  `| Evidence citation validity (positive verdicts citing only stored source text) | ${pct(positive.filter((r) => r.traceable).length, positive.length)} of ${positive.length} |`,
  `| Latency per model-judged claim: mean / p50 / p90 | ${(avgMs / 1000).toFixed(1)} / ${(percentile(0.5) / 1000).toFixed(1)} / ${(percentile(0.9) / 1000).toFixed(1)} s |`,
  "",
  "Abstentions count as misses unless the expected label is Unable to verify, so a cautious model scores lower on agreement but makes fewer unsupported calls; read the non-abstained agreement alongside the overall figure.",
  "",
  "## Per verdict",
  "",
  "| Verdict | Cases | Precision | Recall | F1 |",
  "| --- | --- | --- | --- | --- |",
  ...perLabel.map(
    (l) =>
      `| ${l.label} | ${l.support} | ${l.precision.toFixed(2)} | ${l.recall.toFixed(2)} | ${l.f1.toFixed(2)} |`,
  ),
  "",
  "## Confusion matrix (rows: expected, columns: predicted)",
  "",
  `| | ${LABELS.join(" | ")} |`,
  `| --- | ${LABELS.map(() => "---").join(" | ")} |`,
  ...LABELS.map(
    (e) =>
      `| **${e}** | ${LABELS.map((p) => all.filter((r) => r.expected === e && r.predicted === p).length).join(" | ")} |`,
  ),
  "",
  "## Misses",
  "",
  ...all
    .filter((r) => !r.correct)
    .map(
      (r) =>
        `- \`${r.id}\` (${r.category}, ${r.certainty}): expected **${r.expected}**, got **${r.predicted}**${r.failure ? ` — failure: ${r.failure}` : ""}. ${String(r.explanation ?? r.reason ?? "").slice(0, 260)}`,
    ),
  "",
].join("\n");

// Only a complete run is published in docs/evaluation; partial runs (--limit)
// stay in eval/results, which is not committed. Names include the prompt
// version so runs never overwrite each other's reports.
const complete = all.length === allCases.length;
const name = `benchmark-${date}-${provider}-${PROMPT_VERSION}${complete ? "" : `-partial-${all.length}`}`;
const reportPath = complete
  ? `${root}docs/evaluation/${name}.md`
  : `${root}eval/results/${name}.md`;
await Bun.$`mkdir -p ${root}docs/evaluation ${root}eval/results`;
await Bun.write(reportPath, md);
await Bun.write(
  `${root}eval/results/${name}.json`,
  `${JSON.stringify({ commit, provider, model, promptVersion: PROMPT_VERSION, rows }, null, 2)}\n`,
);
console.log(
  `\n${md.split("## Per verdict")[0]}\nSaved ${reportPath.replace(root, "")}`,
);
