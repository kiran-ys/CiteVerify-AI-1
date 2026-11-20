/**
 * Dataset Evaluation page: load a JSON/CSV test dataset, run each case
 * through the server's real verifier (supplied-evidence or live-retrieval
 * mode), and compare with the dataset's own labels.
 */
import type { EvaluationCaseResponse } from "@citeverify/shared";
import { useMemo, useRef, useState } from "react";
import { EvaluationRequestError, evaluateDatasetCase } from "./api.ts";
import {
  type CaseResult,
  computeMetrics,
  DATASET_LABELS,
  type DatasetCase,
  MAPPING_RULES,
  type Mode,
  mapOutcome,
  parseDataset,
  producibleLabels,
  resultsCsv,
} from "./dataset.ts";
import { type ReportLine, renderPdf } from "./report.ts";
import { downloadText } from "./research.ts";

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });
const pct = (v: number | null) =>
  v === null ? "n/a" : `${Math.round(v * 100)}%`;
const num = (v: number | null) => (v === null ? "n/a" : v.toFixed(2));
const DISCLAIMER =
  "Expected verdicts are labels supplied by the dataset, not independently validated ground truth. Agreement with them is not scientific accuracy.";

type Agreement =
  | "agree"
  | "mismatch"
  | "non-comparable"
  | "failure"
  | "error"
  | "not run";

export function DatasetEvaluation({ active }: { active: boolean }) {
  const [fileName, setFileName] = useState("");
  const [cases, setCases] = useState<DatasetCase[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [mode, setMode] = useState<Mode>("supplied");
  const [batchSize, setBatchSize] = useState(1);
  const [pauseMs, setPauseMs] = useState(2000);
  const [results, setResults] = useState<Map<string, CaseResult>>(new Map());
  const [running, setRunning] = useState(false);
  const [startedAt, setStartedAt] = useState<number>();
  const [query, setQuery] = useState("");
  const [labelFilter, setLabelFilter] = useState("all");
  const [agreeFilter, setAgreeFilter] = useState<Agreement | "all">("all");
  const [open, setOpen] = useState<string>();
  const abort = useRef<AbortController | null>(null);

  const load = async (file: File | undefined) => {
    if (!file) return;
    const parsed = parseDataset(file.name, await file.text());
    setFileName(file.name);
    setResults(new Map());
    if (parsed.ok) {
      setCases(parsed.cases);
      setErrors([]);
    } else {
      setCases([]);
      setErrors(parsed.errors);
    }
  };

  const agreementOf = (c: DatasetCase): Agreement => {
    const r = results.get(c.id);
    if (!r || (!r.response && !r.error)) return "not run";
    if (!r.response) return "error";
    const p = mapOutcome(r.response);
    if (p.failed) return "failure";
    if (!producibleLabels(mode).includes(c.expected)) return "non-comparable";
    return p.label === c.expected ? "agree" : "mismatch";
  };

  const runOne = async (
    c: DatasetCase,
    signal: AbortSignal,
  ): Promise<CaseResult> => {
    let attempts = 0;
    for (;;) {
      attempts++;
      try {
        const response = await evaluateDatasetCase(
          {
            mode,
            caseId: c.id,
            claim: c.claim,
            inlineCitation: c.inlineCitation,
            referenceEntry: c.referenceEntry,
            doi: c.doi,
            ...(mode === "supplied"
              ? { evidenceSnippet: c.evidenceSnippet }
              : {}),
          },
          signal,
        );
        return { id: c.id, expected: c.expected, response, attempts };
      } catch (error) {
        if (signal.aborted) throw error;
        const transient =
          error instanceof EvaluationRequestError && error.transient;
        if (transient && attempts < 3) {
          await sleep(attempts * 3000, signal);
          continue;
        }
        return {
          id: c.id,
          expected: c.expected,
          error: error instanceof Error ? error.message : "Request failed.",
          attempts,
        };
      }
    }
  };

  const run = async (onlyFailed = false) => {
    const controller = new AbortController();
    abort.current = controller;
    setRunning(true);
    setStartedAt(Date.now());
    const todo = cases.filter((c) => {
      if (!onlyFailed) return true;
      const r = results.get(c.id);
      return (
        !r || !!r.error || (r.response ? mapOutcome(r.response).failed : true)
      );
    });
    if (!onlyFailed) setResults(new Map());
    for (
      let i = 0;
      i < todo.length && !controller.signal.aborted;
      i += batchSize
    ) {
      const batch = todo.slice(i, i + batchSize);
      try {
        const done = await Promise.all(
          batch.map((c) => runOne(c, controller.signal)),
        );
        setResults((prev) => {
          const next = new Map(prev);
          for (const r of done) next.set(r.id, r);
          return next;
        });
      } catch {
        break; // cancelled
      }
      if (i + batchSize < todo.length) await sleep(pauseMs, controller.signal);
    }
    setRunning(false);
    abort.current = null;
  };

  const metrics = useMemo(
    () =>
      computeMetrics(
        cases.map(
          (c) =>
            results.get(c.id) ?? {
              id: c.id,
              expected: c.expected,
              attempts: 0,
            },
        ),
        mode,
      ),
    [cases, results, mode],
  );
  const done = cases.filter((c) => results.has(c.id)).length;
  const q = query.trim().toLowerCase();
  const shown = cases.filter(
    (c) =>
      (labelFilter === "all" || c.expected === labelFilter) &&
      (agreeFilter === "all" || agreementOf(c) === agreeFilter) &&
      (!q ||
        `${c.id} ${c.category} ${c.claim} ${c.inlineCitation} ${c.referenceEntry}`
          .toLowerCase()
          .includes(q)),
  );

  const exportJson = () =>
    downloadText(
      `citeverify-evaluation-${mode}.json`,
      `${JSON.stringify(
        {
          dataset: fileName,
          mode,
          exportedAt: new Date().toISOString(),
          disclaimer: DISCLAIMER,
          evidenceProvenance:
            mode === "supplied"
              ? "Evidence snippets were supplied by the dataset and were not retrieved or checked by CiteVerify."
              : "Evidence was retrieved by CiteVerify from scholarly services; dataset snippets were not used.",
          mapping: MAPPING_RULES,
          metrics,
          results: cases.map((c) => ({
            case: c,
            result: results.get(c.id) ?? null,
            agreement: agreementOf(c),
          })),
        },
        null,
        2,
      )}\n`,
      "application/json",
    );
  const exportPdf = () => {
    const lines: ReportLine[] = [
      { style: "title", text: "CiteVerify AI - Dataset evaluation" },
      {
        style: "muted",
        text: `${fileName} · ${cases.length} cases · mode: ${mode === "supplied" ? "supplied evidence (dataset snippets, not retrieved)" : "live retrieval (CiteVerify-retrieved evidence)"} · ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
      },
      { style: "body", text: DISCLAIMER },
      { style: "heading", text: "Summary" },
      {
        style: "body",
        text: `Run: ${metrics.attempted} of ${metrics.total} cases. Scored (comparable labels, no failures, excluding Invalid Input): ${metrics.scored}. Agreement: ${metrics.correct}/${metrics.scored} (${pct(metrics.accuracy)}). Macro F1: ${num(metrics.macroF1)}.`,
      },
      {
        style: "body",
        text: `Input validation: ${metrics.inputValidation.correct}/${metrics.inputValidation.cases} invalid inputs detected. Non-comparable labels: ${metrics.nonComparable.length}. Model failures: ${metrics.modelFailures}. Request errors: ${metrics.requestErrors}. Coverage: ${pct(metrics.coverage)}. Failure rate: ${pct(metrics.failureRate)}.`,
      },
      ...(metrics.latency
        ? [
            {
              style: "body" as const,
              text: `Latency per case: mean ${(metrics.latency.mean / 1000).toFixed(1)} s, p50 ${(metrics.latency.p50 / 1000).toFixed(1)} s, p90 ${(metrics.latency.p90 / 1000).toFixed(1)} s.`,
            },
          ]
        : []),
      { style: "heading", text: "Per label (scored cases)" },
      ...metrics.perClass.map((c) => ({
        style: "muted" as const,
        text: `${c.label}: ${c.support} cases · precision ${num(c.precision)} · recall ${num(c.recall)} · F1 ${num(c.f1)}`,
      })),
      { style: "heading", text: "Verdict mapping" },
      ...MAPPING_RULES.map((m) => ({
        style: "muted" as const,
        text: `${m.from} → ${m.to}`,
      })),
      { style: "heading", text: "Cases" },
      ...cases.flatMap((c) => {
        const r = results.get(c.id);
        const p = r?.response ? mapOutcome(r.response) : null;
        return [
          {
            style: "body" as const,
            text: `${c.id} · expected ${c.expected} · predicted ${p?.label ?? (r?.error ? "error" : p?.failed ? "failure" : "—")} · ${agreementOf(c)}`,
          },
          { style: "quote" as const, text: c.claim.trim() || "(empty claim)" },
          ...(r?.response?.explanation
            ? [
                {
                  style: "muted" as const,
                  text: `AI explanation (not evidence): ${r.response.explanation}`,
                },
              ]
            : []),
          ...(r?.response
            ? [
                {
                  style: "muted" as const,
                  text: `Evidence: ${r.response.provenance.detail}`,
                },
              ]
            : []),
          ...(r?.error
            ? [{ style: "muted" as const, text: `Error: ${r.error}` }]
            : []),
        ];
      }),
    ];
    const url = URL.createObjectURL(
      new Blob([renderPdf(lines).buffer as ArrayBuffer], {
        type: "application/pdf",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `citeverify-evaluation-${mode}.pdf`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div
      className="dataset-page"
      style={active ? undefined : { display: "none" }}
    >
      <section className="panel research-panel" aria-label="Load dataset">
        <header className="research-head">
          <div>
            <h2>Dataset evaluation</h2>
            <p className="quality-note">{DISCLAIMER}</p>
          </div>
          <label className="dataset-file">
            <span>Load dataset (.json or .csv)</span>
            <input
              type="file"
              accept=".json,.csv,application/json,text/csv"
              disabled={running}
              onChange={(e) => load(e.target.files?.[0])}
            />
          </label>
        </header>
        {errors.length > 0 && (
          <div className="error" role="alert">
            <div>
              <b>{fileName} could not be used:</b>
              <ul>
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
        {cases.length > 0 && (
          <>
            <p className="quality-note">
              Loaded <b>{fileName}</b>: {cases.length} cases ·{" "}
              {DATASET_LABELS.map(
                (l) =>
                  [l, cases.filter((c) => c.expected === l).length] as const,
              )
                .filter(([, n]) => n)
                .map(([l, n]) => `${n} ${l}`)
                .join(" · ")}
            </p>
            <fieldset className="mode-switch" disabled={running}>
              <legend>Evaluation mode</legend>
              <label className={mode === "supplied" ? "on" : ""}>
                <input
                  type="radio"
                  name="eval-mode"
                  checked={mode === "supplied"}
                  onChange={() => {
                    setMode("supplied");
                    setResults(new Map());
                  }}
                />
                <b>Supplied evidence</b>
                <small>
                  Judges each claim only against the dataset's own snippet. The
                  snippet is not retrieved or checked by CiteVerify.
                </small>
              </label>
              <label className={mode === "live" ? "on" : ""}>
                <input
                  type="radio"
                  name="eval-mode"
                  checked={mode === "live"}
                  onChange={() => {
                    setMode("live");
                    setResults(new Map());
                  }}
                />
                <b>Live retrieval</b>
                <small>
                  Ignores the snippet; finds the cited work in PubMed, Crossref,
                  OpenAlex and Europe PMC, then verifies. Slower (rate-limited
                  services).
                </small>
              </label>
            </fieldset>
            <div className="run-controls">
              <label>
                Batch size
                <select
                  value={batchSize}
                  disabled={running}
                  onChange={(e) => setBatchSize(Number(e.target.value))}
                >
                  {[1, 2, 3, 5].map((n) => (
                    <option key={n} value={n}>
                      {n} at a time
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Pause between batches
                <select
                  value={pauseMs}
                  disabled={running}
                  onChange={(e) => setPauseMs(Number(e.target.value))}
                >
                  {[0, 1000, 2000, 5000, 10000].map((n) => (
                    <option key={n} value={n}>
                      {n / 1000} s
                    </option>
                  ))}
                </select>
              </label>
              {running ? (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => abort.current?.abort()}
                >
                  Cancel
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="hero-cta"
                    onClick={() => run(false)}
                  >
                    Run evaluation
                  </button>
                  {results.size > 0 &&
                    metrics.requestErrors + metrics.modelFailures > 0 && (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => run(true)}
                      >
                        Retry failed cases
                      </button>
                    )}
                </>
              )}
              <span className="run-progress" role="status" aria-live="polite">
                {running
                  ? `Running… ${done} of ${cases.length} done${startedAt ? ` · ${Math.round((Date.now() - startedAt) / 1000)} s` : ""}`
                  : results.size
                    ? `${done} of ${cases.length} cases run`
                    : "Not run yet"}
              </span>
            </div>
            {cases.length > 0 && (
              <progress
                max={cases.length}
                value={done}
                aria-label="Evaluation progress"
                className="run-bar"
              />
            )}
          </>
        )}
      </section>

      {cases.length > 0 && results.size > 0 && (
        <section
          className="panel research-panel"
          aria-label="Evaluation metrics"
        >
          <header className="research-head">
            <div>
              <h2>
                Metrics (
                {mode === "supplied" ? "supplied evidence" : "live retrieval"})
              </h2>
              <p className="quality-note">
                Scored = cases whose dataset label CiteVerify can produce in
                this mode, excluding Invalid Input and failed calls. Other cases
                are reported separately below.
              </p>
            </div>
            <div className="export-row">
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  downloadText(
                    `citeverify-evaluation-${mode}.csv`,
                    resultsCsv(cases, results, mode),
                    "text/csv",
                  )
                }
              >
                CSV
              </button>
              <button type="button" className="secondary" onClick={exportJson}>
                JSON
              </button>
              <button type="button" className="secondary" onClick={exportPdf}>
                PDF summary
              </button>
            </div>
          </header>
          <div className="quality-tiles">
            <article className="quality-tile">
              <small>Agreement with dataset labels</small>
              <strong>
                {metrics.scored
                  ? `${metrics.correct}/${metrics.scored}`
                  : "n/a"}
              </strong>
              <p>{pct(metrics.accuracy)} of scored cases</p>
            </article>
            <article className="quality-tile">
              <small>Macro F1</small>
              <strong>{num(metrics.macroF1)}</strong>
              <p>over labels with cases</p>
            </article>
            <article className="quality-tile">
              <small>Input validation</small>
              <strong>
                {metrics.inputValidation.correct}/
                {metrics.inputValidation.cases}
              </strong>
              <p>Invalid Input cases detected</p>
            </article>
            <article className="quality-tile">
              <small>Coverage · failure rate</small>
              <strong>
                {pct(metrics.coverage)} · {pct(metrics.failureRate)}
              </strong>
              <p>
                {metrics.modelFailures} model failures · {metrics.requestErrors}{" "}
                request errors of {metrics.attempted} run
              </p>
            </article>
            <article className="quality-tile">
              <small>Latency (mean · p50 · p90)</small>
              <strong>
                {metrics.latency
                  ? `${(metrics.latency.mean / 1000).toFixed(1)} s`
                  : "n/a"}
              </strong>
              <p>
                {metrics.latency
                  ? `${(metrics.latency.p50 / 1000).toFixed(1)} s · ${(metrics.latency.p90 / 1000).toFixed(1)} s`
                  : ""}
              </p>
            </article>
          </div>
          <div className="bench-scroll">
            <table className="bench-table">
              <caption>Per label (scored cases)</caption>
              <thead>
                <tr>
                  <th>Dataset label</th>
                  <th>Cases</th>
                  <th>Precision</th>
                  <th>Recall</th>
                  <th>F1</th>
                </tr>
              </thead>
              <tbody>
                {metrics.perClass.map((c) => (
                  <tr key={c.label}>
                    <td>{c.label}</td>
                    <td>{c.support}</td>
                    <td>{num(c.precision)}</td>
                    <td>{num(c.recall)}</td>
                    <td>{num(c.f1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table className="bench-table confusion">
              <caption>
                Confusion matrix (rows: dataset label, columns: CiteVerify
                prediction)
              </caption>
              <thead>
                <tr>
                  <th />{" "}
                  {[...metrics.labels, "(none)"].map((l) => (
                    <th key={l}>{l}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {metrics.labels.map((e) => (
                  <tr key={e}>
                    <th>{e}</th>
                    {[...metrics.labels, "(none)"].map((p) => (
                      <td key={p} className={e === p ? "diag" : ""}>
                        {metrics.confusion[e]?.[p] ?? 0}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {metrics.nonComparable.length > 0 && (
            <p className="quality-note">
              Not scored (CiteVerify cannot produce these labels in this mode):{" "}
              {metrics.nonComparable
                .map(
                  (n) =>
                    `${n.id} (${n.expected} → ${n.predicted ?? "no label"})`,
                )
                .join(", ")}
              .
            </p>
          )}
          <details className="mapping">
            <summary>How CiteVerify outcomes map to dataset labels</summary>
            <table className="bench-table">
              <tbody>
                {MAPPING_RULES.map((m) => (
                  <tr key={m.from}>
                    <td>{m.from}</td>
                    <td>→ {m.to}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </section>
      )}

      {cases.length > 0 && (
        <section className="panel research-panel" aria-label="Test cases">
          <header className="research-head">
            <h2>
              Test cases ({shown.length} of {cases.length})
            </h2>
            <div className="research-tools">
              <label>
                <span className="sr">Search cases</span>
                <input
                  type="search"
                  placeholder="Search id, category, claim, citation"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <label>
                <span className="sr">Expected label</span>
                <select
                  value={labelFilter}
                  onChange={(e) => setLabelFilter(e.target.value)}
                >
                  <option value="all">Any dataset label</option>
                  {DATASET_LABELS.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="sr">Result</span>
                <select
                  value={agreeFilter}
                  onChange={(e) =>
                    setAgreeFilter(e.target.value as Agreement | "all")
                  }
                >
                  <option value="all">Any result</option>
                  {(
                    [
                      "agree",
                      "mismatch",
                      "non-comparable",
                      "failure",
                      "error",
                      "not run",
                    ] as Agreement[]
                  ).map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </header>
          <div className="dataset-table-wrap">
            <table className="dataset-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Category</th>
                  <th>Claim</th>
                  <th>Dataset label</th>
                  <th>CiteVerify</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => {
                  const r = results.get(c.id);
                  const p = r?.response ? mapOutcome(r.response) : null;
                  const agreement = agreementOf(c);
                  const expanded = open === c.id;
                  return (
                    <CaseRows
                      key={c.id}
                      c={c}
                      r={r}
                      predicted={p?.label ?? null}
                      rule={p?.rule ?? null}
                      agreement={agreement}
                      expanded={expanded}
                      toggle={() => setOpen(expanded ? undefined : c.id)}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function CaseRows({
  c,
  r,
  predicted,
  rule,
  agreement,
  expanded,
  toggle,
}: {
  c: DatasetCase;
  r: CaseResult | undefined;
  predicted: string | null;
  rule: string | null;
  agreement: Agreement;
  expanded: boolean;
  toggle: () => void;
}) {
  const res: EvaluationCaseResponse | undefined = r?.response;
  return (
    <>
      <tr className={`case-row agree-${agreement.replace(/\s/g, "-")}`}>
        <td>
          <button
            type="button"
            className="link-btn"
            onClick={toggle}
            aria-expanded={expanded}
          >
            {c.id}
          </button>
        </td>
        <td>{c.category}</td>
        <td className="claim-cell">{c.claim.trim() || <i>(empty)</i>}</td>
        <td>{c.expected}</td>
        <td>
          {r?.error
            ? "error"
            : res
              ? (predicted ?? (mapOutcome(res).failed ? "failure" : "no label"))
              : "—"}
        </td>
        <td>
          <span className={`agree-pill agree-${agreement.replace(/\s/g, "-")}`}>
            {agreement}
          </span>
        </td>
      </tr>
      {expanded && (
        <tr className="case-detail">
          <td colSpan={6}>
            <dl>
              <div>
                <dt>Citation</dt>
                <dd>
                  {c.inlineCitation} · {c.referenceEntry} · DOI {c.doi}
                </dd>
              </div>
              <div>
                <dt>Dataset label & reason</dt>
                <dd>
                  {c.expected}: {c.expectedReason} (needs human review:{" "}
                  {c.needsHumanReview ? "yes" : "no"})
                </dd>
              </div>
              {res && (
                <div>
                  <dt>CiteVerify</dt>
                  <dd>
                    {res.outcome}
                    {res.verdict ? ` · ${res.verdict}` : ""}
                    {rule ? ` · mapped by: ${rule}` : ""} ·{" "}
                    {(res.latencyMs / 1000).toFixed(1)} s
                    {res.model
                      ? ` · ${res.model.name} (${res.model.provider})`
                      : ""}
                  </dd>
                </div>
              )}
              {res && (
                <div>
                  <dt>Evidence provenance</dt>
                  <dd>
                    <b>
                      {res.provenance.kind === "dataset_supplied"
                        ? "Dataset-supplied (not retrieved)"
                        : res.provenance.kind === "retrieved"
                          ? "Retrieved by CiteVerify"
                          : "No evidence"}
                    </b>{" "}
                    — {res.provenance.detail}
                    {res.provenance.workTitle
                      ? ` · ${res.provenance.workTitle}`
                      : ""}
                  </dd>
                </div>
              )}
              {res?.explanation && (
                <div>
                  <dt>AI explanation (not evidence)</dt>
                  <dd>{res.explanation}</dd>
                </div>
              )}
              {res?.reason && (
                <div>
                  <dt>Reason</dt>
                  <dd>{res.reason}</dd>
                </div>
              )}
              {res?.evidence
                .filter(
                  (e) =>
                    e.relation === "supports" || e.relation === "contradicts",
                )
                .map((e) => (
                  <div key={e.id}>
                    <dt>
                      {e.id} ({e.relation})
                    </dt>
                    <dd>“{e.text}”</dd>
                  </div>
                ))}
              {r?.error && (
                <div>
                  <dt>Error</dt>
                  <dd>
                    {r.error} (after {r.attempts} attempt
                    {r.attempts === 1 ? "" : "s"})
                  </dd>
                </div>
              )}
            </dl>
          </td>
        </tr>
      )}
    </>
  );
}
