/**
 * Builds apps/web/src/benchmark-summaries.json from complete benchmark runs
 * in eval/results (the files the runner writes), so the UI shows only
 * measured numbers. Run after a benchmark:
 *
 *   bun run --cwd apps/api scripts/summarize-benchmarks.ts
 */
const root = new URL("../../../", import.meta.url).pathname;
const LABELS = [
  "Supported",
  "Partially supported",
  "Contradicted",
  "Unable to verify",
] as const;
type Row = {
  expected: string;
  predicted: string;
  reviewStatus?: string;
  kind?: string;
};

const files = (await Array.fromAsync(new Bun.Glob("benchmark-*.json").scan(`${root}eval/results`)))
  .filter((f) => !f.includes("partial"))
  .sort();
const summaries = [];
for (const file of files) {
  const data = (await Bun.file(`${root}eval/results/${file}`).json()) as {
    provider: string;
    model: string;
    promptVersion?: string;
    rows: Row[];
  };
  const rows = data.rows;
  if (rows.length < 40) continue; // only complete runs
  const perClass = LABELS.map((label) => {
    const tp = rows.filter((r) => r.expected === label && r.predicted === label).length;
    const fp = rows.filter((r) => r.expected !== label && r.predicted === label).length;
    const fn = rows.filter((r) => r.expected === label && r.predicted !== label).length;
    const precision = tp + fp ? tp / (tp + fp) : 0;
    const recall = tp + fn ? tp / (tp + fn) : 0;
    return {
      label,
      support: tp + fn,
      precision,
      recall,
      f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0,
    };
  });
  const present = perClass.filter((c) => c.support > 0);
  summaries.push({
    run: file.replace(/\.json$/, ""),
    provider: data.provider,
    model: data.model,
    promptVersion:
      data.promptVersion ?? /verify-v\d+/.exec(file)?.[0] ?? "verify-v4",
    cases: rows.length,
    reviewedLabels: rows.filter((r) => r.reviewStatus && r.reviewStatus !== "provisional").length,
    agreement: rows.filter((r) => r.expected === r.predicted).length,
    abstentions: rows.filter((r) => r.predicted === "Unable to verify").length,
    macroF1: present.reduce((s, c) => s + c.f1, 0) / (present.length || 1),
    perClass,
    confusion: LABELS.map((e) =>
      LABELS.map((p) => rows.filter((r) => r.expected === e && r.predicted === p).length),
    ),
  });
}
const out = `${root}apps/web/src/benchmark-summaries.json`;
await Bun.write(out, `${JSON.stringify(summaries, null, 2)}\n`);
console.log(`Wrote ${summaries.length} complete runs to ${out}`);
