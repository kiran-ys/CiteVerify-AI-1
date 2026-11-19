/**
 * Premium workspace views. Every number comes from the uploaded paper's API
 * results (paperQuality) or from measured benchmark runs; steps that were not
 * run say so instead of showing zero.
 */
import type {
  ClaimVerification,
  ExtractedClaim,
  VerificationEvidence,
  VerificationVerdict,
} from "@citeverify/shared";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import benchmarks from "./benchmark-summaries.json";
import type { PaperResult } from "./paper-session.ts";
import { CAUSE_LABEL, paperQuality, share } from "./quality.ts";
import type { ThemePreference } from "./theme.ts";

// ------------------------------------------------------------------ theme

export function ThemeToggle({
  preference,
  resolved,
  onChange,
}: {
  preference: ThemePreference;
  resolved: "light" | "dark";
  onChange: (p: ThemePreference) => void;
}) {
  const options: [ThemePreference, string, string][] = [
    ["light", "Light theme", "☀"],
    ["dark", "Dark theme", "☾"],
    ["system", "Follow system theme", "A"],
  ];
  return (
    <fieldset className="theme-toggle">
      <legend className="sr">Colour theme (now {resolved})</legend>
      {options.map(([value, label, glyph]) => (
        <button
          key={value}
          type="button"
          aria-pressed={preference === value}
          aria-label={label}
          title={label}
          className={preference === value ? "on" : ""}
          onClick={() => onChange(value)}
        >
          <span aria-hidden="true">{glyph}</span>
        </button>
      ))}
    </fieldset>
  );
}

// ------------------------------------------------------------------ tilt

/**
 * Gentle tilt (max ~3°) written to CSS variables on the element, so pointer
 * moves never re-render React. CSS disables it for touch and reduced motion.
 */
export function Tilt({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const move = (event: React.PointerEvent) => {
    const el = ref.current;
    if (!el || event.pointerType !== "mouse") return;
    const box = el.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width - 0.5;
    const y = (event.clientY - box.top) / box.height - 0.5;
    el.style.setProperty("--tilt-x", `${(-y * 5).toFixed(2)}deg`);
    el.style.setProperty("--tilt-y", `${(x * 5).toFixed(2)}deg`);
  };
  const reset = () => {
    ref.current?.style.setProperty("--tilt-x", "0deg");
    ref.current?.style.setProperty("--tilt-y", "0deg");
  };
  return (
    <div
      ref={ref}
      className={`tilt ${className}`}
      onPointerMove={move}
      onPointerLeave={reset}
    >
      {children}
    </div>
  );
}

// ------------------------------------------------------------------ hero

export function Hero({
  onUpload,
  onSample,
  sampleCitation,
}: {
  onUpload: () => void;
  onSample: () => void;
  sampleCitation: string;
}) {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero-copy">
        <small className="hero-eyebrow">
          <span className="eyebrow-dot" aria-hidden="true" />
          Evidence-grounded citation checking
        </small>
        <h1 id="hero-title">
          Every scientific claim <span>deserves evidence.</span>
        </h1>
        <p>
          Upload research papers, trace citations, retrieve scholarly evidence,
          and understand what the science actually supports.
        </p>
        <div className="hero-actions">
          <button
            type="button"
            className="hero-cta magnetic"
            onClick={onUpload}
          >
            Upload research paper
          </button>
          <button
            type="button"
            className="hero-secondary magnetic"
            onClick={onSample}
          >
            Try the sample paper
          </button>
        </div>
        <p className="hero-sample-note">
          The sample runs the real pipeline on an open-access paper:{" "}
          {sampleCitation}
        </p>
      </div>
      <Tilt className="hero-art spotlight">
        <svg
          viewBox="0 0 320 240"
          role="img"
          aria-label="A research paper whose citations connect to evidence sources"
        >
          <defs>
            <linearGradient id="pageFade" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" className="art-stop-a" />
              <stop offset="1" className="art-stop-b" />
            </linearGradient>
          </defs>
          <g className="art-float">
            <rect
              x="46"
              y="28"
              width="128"
              height="170"
              rx="12"
              fill="url(#pageFade)"
              className="art-page"
            />
            <rect
              x="64"
              y="50"
              width="78"
              height="8"
              rx="4"
              className="art-line strong"
            />
            <rect
              x="64"
              y="70"
              width="92"
              height="5"
              rx="2.5"
              className="art-line"
            />
            <rect
              x="64"
              y="82"
              width="80"
              height="5"
              rx="2.5"
              className="art-line"
            />
            <rect
              x="64"
              y="94"
              width="88"
              height="5"
              rx="2.5"
              className="art-line"
            />
            <rect
              x="64"
              y="114"
              width="54"
              height="6"
              rx="3"
              className="art-mark a"
            />
            <rect
              x="64"
              y="128"
              width="86"
              height="5"
              rx="2.5"
              className="art-line"
            />
            <rect
              x="64"
              y="146"
              width="44"
              height="6"
              rx="3"
              className="art-mark b"
            />
            <rect
              x="64"
              y="160"
              width="76"
              height="5"
              rx="2.5"
              className="art-line"
            />
          </g>
          <path
            d="M120 117 C 190 117, 200 62, 252 62"
            className="art-link l1"
          />
          <path
            d="M110 149 C 190 149, 200 128, 252 128"
            className="art-link l2"
          />
          <path
            d="M110 149 C 196 149, 206 192, 252 192"
            className="art-link l3"
          />
          <g className="art-node ok">
            <circle cx="262" cy="62" r="13" />
            <path d="M256 62l4 4 8-9" />
          </g>
          <g className="art-node warn">
            <circle cx="262" cy="128" r="13" />
            <path d="M262 121v8M262 133v1" />
          </g>
          <g className="art-node muted">
            <circle cx="262" cy="192" r="13" />
            <path d="M257 192h10" />
          </g>
        </svg>
      </Tilt>
    </section>
  );
}

// ------------------------------------------------------------------ metrics

export function MetricsRow({ paper }: { paper: PaperResult | undefined }) {
  if (!paper) {
    return (
      <p className="metrics-empty">
        No paper analysed in this browser tab yet. Metrics appear here after a
        real upload.
      </p>
    );
  }
  const q = paperQuality(paper);
  const v = q.verification;
  const count = (verdict: VerificationVerdict) =>
    v
      ? String(v.byVerdict.find((b) => b.verdict === verdict)?.count ?? 0)
      : "Not verified";
  const cards: [string, string, string, string][] = [
    ["Total claims", String(q.claims.total), "found by rules", "blue"],
    [
      "Cited claims",
      String(q.claims.cited),
      "citation matched to a reference",
      "violet",
    ],
    [
      "Claims with evidence",
      q.sources ? String(q.sources.claimsWithEvidence) : "Not run",
      "at least one retrieved passage",
      "teal",
    ],
    ["Supported", count("Supported"), "AI verdict", "green"],
    [
      "Partially supported",
      count("Partially supported"),
      "AI verdict",
      "amber",
    ],
    ["Contradicted", count("Contradicted"), "AI verdict", "red"],
    [
      "Unable to verify",
      count("Unable to verify"),
      "evidence could not settle it",
      "gray",
    ],
  ];
  return (
    <section className="metrics-row" aria-label="Paper metrics">
      {cards.map(([label, value, note, tone]) => (
        <Tilt key={label} className={`metric spotlight tone-edge-${tone}`}>
          <small>{label}</small>
          <strong className={value.length > 4 ? "metric-text" : ""}>
            {value}
          </strong>
          <p>{note}</p>
        </Tilt>
      ))}
    </section>
  );
}

// ------------------------------------------------------------------ pipeline

type StageState = "done" | "active" | "pending" | "failed";

export function Pipeline({
  paper,
  extracting,
  retrieving,
  verifying,
  failed,
}: {
  paper: PaperResult | undefined;
  extracting: boolean;
  retrieving: boolean;
  verifying: boolean;
  failed: { stage: "extract" | "retrieve" | "verify"; message: string } | null;
}) {
  const hasEvidence = !!paper && "evidence" in paper;
  const hasVerdicts = !!paper && "verification" in paper;
  const base = (
    done: boolean,
    active: boolean,
    key: "extract" | "retrieve" | "verify",
  ): StageState =>
    failed?.stage === key && !active
      ? "failed"
      : active
        ? "active"
        : done
          ? "done"
          : "pending";
  const stages: [string, StageState, string][] = [
    [
      "Read PDF",
      base(!!paper, extracting, "extract"),
      paper ? `${paper.document.pageCount} pages` : "",
    ],
    [
      "Extract claims",
      base(!!paper, extracting, "extract"),
      paper ? `${paper.claims.items.length} claims` : "",
    ],
    [
      "Map citations",
      base(!!paper, extracting, "extract"),
      paper ? `${paper.citations.inText.length} citations` : "",
    ],
    [
      "Retrieve evidence",
      base(hasEvidence, retrieving || verifying, "retrieve"),
      hasEvidence && paper && "evidence" in paper
        ? `${paper.evidence.sources.length} sources`
        : "",
    ],
    [
      "AI verification",
      base(hasVerdicts, verifying, "verify"),
      hasVerdicts && paper && "verification" in paper
        ? `${paper.verification.results.length} judged`
        : "",
    ],
    [
      "Generate report",
      paper ? "done" : "pending",
      paper ? "ready to download" : "",
    ],
  ];
  const explain: Record<string, string> = {
    "Read PDF":
      "The PDF is parsed in memory on the server; text is kept per page.",
    "Extract claims":
      "Sentences that make scientific claims are found by transparent rules.",
    "Map citations":
      "Citation markers are matched to the paper's own reference list (not evidence).",
    "Retrieve evidence":
      "Cited works are identified in PubMed, Crossref, and OpenAlex; abstracts or open full text are fetched.",
    "AI verification":
      "Each cited claim is compared with its retrieved passages; verdicts must cite stored source text.",
    "Generate report":
      "A PDF report is built in your browser from these results.",
  };
  return (
    <section className="pipeline panel" aria-label="Verification pipeline">
      <header className="pipeline-head">
        <h2>Verification pipeline</h2>
        <small>Real request states · no simulated progress</small>
      </header>
      <ol className="timeline">
        {stages.map(([name, state, detail]) => (
          <li
            key={name}
            className={`stage stage-${state}`}
            aria-current={state === "active" ? "step" : undefined}
          >
            <span className="stage-dot" aria-hidden="true">
              {state === "done" ? "✓" : state === "failed" ? "!" : ""}
            </span>
            <details>
              <summary>
                <b>{name}</b>
                <small>
                  {state === "active"
                    ? "In progress…"
                    : state === "failed"
                      ? "Failed"
                      : state === "done"
                        ? detail
                        : "Pending"}
                </small>
              </summary>
              <p>{explain[name]}</p>
            </details>
          </li>
        ))}
      </ol>
      {failed && (
        <p className="pipeline-error" role="alert">
          {failed.message} Use the buttons in the paper panel to try again.
        </p>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ quality dashboard

const VERDICT_COLOR: Record<VerificationVerdict, string> = {
  Supported: "var(--green)",
  "Partially supported": "var(--amber)",
  Contradicted: "var(--red)",
  Unsupported: "var(--violet)",
  "Unable to verify": "var(--text-4)",
};

function Donut({
  parts,
  total,
}: {
  parts: { verdict: VerificationVerdict; count: number }[];
  total: number;
}) {
  const r = 52;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg
      viewBox="0 0 140 140"
      className="donut"
      role="img"
      aria-label={parts.map((p) => `${p.count} ${p.verdict}`).join(", ")}
    >
      <circle cx="70" cy="70" r={r} className="donut-track" />
      {parts.map((p) => {
        const len = (p.count / total) * c;
        const el = (
          <circle
            key={p.verdict}
            cx="70"
            cy="70"
            r={r}
            stroke={VERDICT_COLOR[p.verdict]}
            strokeDasharray={`${len} ${c - len}`}
            strokeDashoffset={-offset}
            className="donut-seg"
          />
        );
        offset += len;
        return el;
      })}
      <text x="70" y="66" textAnchor="middle" className="donut-num">
        {total}
      </text>
      <text x="70" y="84" textAnchor="middle" className="donut-cap">
        claims judged
      </text>
    </svg>
  );
}

export function QualityDashboard({
  paper,
  showBenchmarks = false,
}: {
  paper: PaperResult | undefined;
  showBenchmarks?: boolean;
}) {
  return (
    <aside className="quality-dash" aria-label="Verification quality dashboard">
      {paper ? (
        <PaperQualityCard paper={paper} />
      ) : (
        <section className="panel dash-card">
          <h2>Verification quality</h2>
          <p className="quality-note">
            No uploaded paper yet. Verdicts and retrieval figures appear here
            after a real analysis.
          </p>
        </section>
      )}
      {showBenchmarks && <BenchmarkCard />}
    </aside>
  );
}

function PaperQualityCard({ paper }: { paper: PaperResult }) {
  const q = paperQuality(paper);
  const v = q.verification;
  const s = q.sources;
  const insights: string[] = [];
  if (s)
    insights.push(
      `${s.claimsWithEvidence} of ${q.claims.cited} cited claims have at least one retrieved passage.`,
    );
  else
    insights.push(
      `${q.claims.cited} cited claims are waiting for source retrieval.`,
    );
  if (v) {
    const insufficient =
      v.unableCauses.find((c) => c.cause === "insufficient_evidence")?.count ??
      0;
    if (insufficient)
      insights.push(
        `${insufficient} claims had evidence that did not settle them.`,
      );
    const noEvidence =
      v.unableCauses.find((c) => c.cause === "no_evidence")?.count ?? 0;
    if (noEvidence)
      insights.push(`${noEvidence} claims had no relevant passage to judge.`);
  } else
    insights.push(
      "AI verification has not been run, so no verdicts exist yet.",
    );
  if (s?.rateLimited)
    insights.push(
      `${s.rateLimited} sources hit a scholarly-service rate limit.`,
    );
  return (
    <section className="panel dash-card">
      <header className="dash-head">
        <h2>Verification quality</h2>
        <small>{paper.document.name}</small>
      </header>
      <h3>Verdict distribution</h3>
      {v && v.judged > 0 ? (
        <div className="donut-wrap">
          <Donut parts={v.byVerdict} total={v.judged} />
          <ul className="legend">
            {v.byVerdict.map((b) => (
              <li key={b.verdict}>
                <i style={{ background: VERDICT_COLOR[b.verdict] }} />
                {b.verdict}
                <b>{b.count}</b>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="quality-note">Not verified yet.</p>
      )}
      {v?.model && (
        <p className="quality-note">
          {v.model} via{" "}
          {v.provider === "groq" ? "Groq (hosted)" : "Ollama (local)"} ·
          verdicts need human review
        </p>
      )}
      <h3>Evidence retrieval</h3>
      <dl className="dash-stats">
        <div>
          <dt>Citations matched</dt>
          <dd>{share(q.citations.matched, q.citations.items)}</dd>
        </div>
        <div>
          <dt>Scholarly records resolved</dt>
          <dd>{s ? share(s.identified, s.lookedUp) : "Not run"}</dd>
        </div>
        <div>
          <dt>Sources with abstract or full text</dt>
          <dd>
            {s ? share(s.abstractOnly + s.fullText, s.lookedUp) : "Not run"}
          </dd>
        </div>
        <div>
          <dt>Sources unavailable or metadata only</dt>
          <dd>
            {s ? share(s.unavailable + s.metadataOnly, s.lookedUp) : "Not run"}
          </dd>
        </div>
        <div>
          <dt>Retrieval errors</dt>
          <dd>{s ? share(s.withErrors, s.lookedUp) : "Not run"}</dd>
        </div>
      </dl>
      <h3>Key facts</h3>
      <ul className="insights">
        {insights.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
      {v && v.unableCauses.length > 0 && (
        <p className="quality-note">
          Unable to verify:{" "}
          {v.unableCauses
            .map((c) => `${CAUSE_LABEL[c.cause] ?? c.cause} (${c.count})`)
            .join(", ")}
          .
        </p>
      )}
    </section>
  );
}

type Summary = (typeof benchmarks)[number];

export function BenchmarkCard() {
  const runs = benchmarks as Summary[];
  const [index, setIndex] = useState(runs.length - 1);
  const run = runs[index];
  if (!run) {
    return (
      <section className="panel dash-card">
        <h2>Benchmark</h2>
        <p className="quality-note">No complete benchmark run is available.</p>
      </section>
    );
  }
  const pct = (n: number) => `${Math.round((100 * n) / run.cases)}%`;
  const labels = run.perClass.map((c) => c.label);
  return (
    <section className="panel dash-card" aria-label="Benchmark evaluation">
      <header className="dash-head">
        <h2>Benchmark evaluation</h2>
        {runs.length > 1 && (
          <select
            aria-label="Benchmark run"
            value={index}
            onChange={(e) => setIndex(Number(e.target.value))}
          >
            {runs.map((r, i) => (
              <option key={r.run} value={i}>
                {r.model} · {r.promptVersion}
              </option>
            ))}
          </select>
        )}
      </header>
      <p className="bench-warning">
        Agreement with <b>provisional, AI-assisted labels</b> (
        {run.reviewedLabels} of {run.cases} human-reviewed). Not validated
        scientific accuracy.
        {run.provider === "ollama"
          ? " Local model run; the hosted Groq model has not been benchmarked yet."
          : " Hosted Groq run."}
      </p>
      <dl className="dash-stats">
        <div>
          <dt>Agreement</dt>
          <dd>
            {run.agreement}/{run.cases} ({pct(run.agreement)})
          </dd>
        </div>
        <div>
          <dt>Macro F1</dt>
          <dd>{run.macroF1.toFixed(2)}</dd>
        </div>
        <div>
          <dt>Abstention rate</dt>
          <dd>{pct(run.abstentions)}</dd>
        </div>
      </dl>
      <table className="bench-table">
        <caption className="sr">Per-class precision and recall</caption>
        <thead>
          <tr>
            <th>Verdict</th>
            <th>Cases</th>
            <th>Precision</th>
            <th>Recall</th>
          </tr>
        </thead>
        <tbody>
          {run.perClass.map((c) => (
            <tr key={c.label}>
              <td>{c.label}</td>
              <td>{c.support}</td>
              <td>{c.precision.toFixed(2)}</td>
              <td>{c.recall.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table className="bench-table confusion">
        <caption>Confusion matrix (rows expected, columns predicted)</caption>
        <thead>
          <tr>
            <th />{" "}
            {labels.map((l) => (
              <th key={l} title={l}>
                {l.split(" ")[0]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {run.confusion.map((row, i) => (
            <tr key={labels[i]}>
              <th title={labels[i]}>{labels[i]?.split(" ")[0]}</th>
              {row.map((n, j) => (
                <td key={labels[j]} className={i === j ? "diag" : ""}>
                  {n}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ------------------------------------------------------------------ claim–evidence workspace

type Item = {
  claim: ExtractedClaim;
  verdict?: ClaimVerification;
  markers: string[];
};

export function ClaimEvidenceWorkspace({
  paper,
  focusClaimId,
}: {
  paper: PaperResult | undefined;
  /** Claim to show first (from the command palette). */
  focusClaimId?: string;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<
    VerificationVerdict | "all" | "unverified"
  >("all");
  const [position, setPosition] = useState(0);
  const items = useMemo<Item[]>(() => {
    if (!paper) return [];
    const verdicts =
      "verification" in paper
        ? new Map(paper.verification.results.map((r) => [r.claimId, r]))
        : new Map<string, ClaimVerification>();
    const cited = new Set(
      paper.citations.inText
        .filter(
          (c) => c.claimId && c.matches.some((m) => m.status === "matched"),
        )
        .map((c) => c.claimId),
    );
    return paper.claims.items
      .filter((c) => cited.has(c.id))
      .map((claim) => ({
        claim,
        verdict: verdicts.get(claim.id),
        markers: paper.citations.inText
          .filter((c) => c.claimId === claim.id)
          .map((c) => c.marker.trim()),
      }));
  }, [paper]);
  const refs = useMemo(
    () => new Map(paper?.citations.references.map((r) => [r.id, r]) ?? []),
    [paper],
  );
  const sources = useMemo(
    () =>
      new Map(
        paper && "evidence" in paper
          ? paper.evidence.sources.map((s) => [s.referenceId, s])
          : [],
      ),
    [paper],
  );
  const q = query.trim().toLowerCase();
  const shown = items.filter((it) => {
    if (
      filter === "unverified"
        ? !!it.verdict
        : filter !== "all" && it.verdict?.verdict !== filter
    )
      return false;
    if (!q) return true;
    const haystack = [
      it.claim.text,
      ...it.markers,
      ...(it.verdict?.evidence ?? []).flatMap((e) => [
        e.text,
        e.sourceTitle ?? "",
      ]),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
  // Jump to a claim chosen elsewhere (command palette).
  useEffect(() => {
    if (!focusClaimId) return;
    const index = items.findIndex((it) => it.claim.id === focusClaimId);
    if (index >= 0) {
      setQuery("");
      setFilter("all");
      setPosition(index);
    }
  }, [focusClaimId, items]);
  const current = shown[Math.min(position, Math.max(0, shown.length - 1))];
  const at = current ? shown.indexOf(current) : -1;

  if (!paper) {
    return (
      <section
        className="panel compare-empty"
        aria-label="Claim and evidence comparison"
      >
        <h2>Claim–evidence comparison</h2>
        <div className="empty-state">
          <span className="empty-glyph" aria-hidden="true">
            ❝ ❞
          </span>
          <h3>Your next research insight starts here.</h3>
          <p>
            Upload a paper, or try the open-access sample, to compare each cited
            claim with the scholarly evidence behind it.
          </p>
        </div>
      </section>
    );
  }
  return (
    <section
      className="panel compare"
      aria-label="Claim and evidence comparison"
      onKeyDown={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest("input, select, textarea")) return;
        if (event.key === "ArrowRight")
          setPosition(Math.min(shown.length - 1, at + 1));
        if (event.key === "ArrowLeft") setPosition(Math.max(0, at - 1));
      }}
    >
      <header className="compare-head">
        <div>
          <h2>Claim–evidence comparison</h2>
          <small className="kbd-hint">
            ← and → move between claims · Ctrl/⌘ K searches everything
          </small>
        </div>
        <div className="compare-tools">
          <label>
            <span className="sr">Search claims, citations, and evidence</span>
            <input
              type="search"
              placeholder="Search claims, citations, evidence"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPosition(0);
              }}
            />
          </label>
          <label>
            <span className="sr">Filter by verdict</span>
            <select
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value as typeof filter);
                setPosition(0);
              }}
            >
              <option value="all">All cited claims ({items.length})</option>
              {"verification" in paper ? null : (
                <option value="unverified">Not verified</option>
              )}
              {(
                [
                  "Supported",
                  "Partially supported",
                  "Contradicted",
                  "Unable to verify",
                ] as const
              ).map((v) => (
                <option key={v} value={v}>
                  {v} ({items.filter((i) => i.verdict?.verdict === v).length})
                </option>
              ))}
            </select>
          </label>
          <div className="compare-nav">
            <button
              type="button"
              onClick={() => setPosition(Math.max(0, at - 1))}
              disabled={at <= 0}
              aria-label="Previous claim"
            >
              ‹
            </button>
            <span aria-live="polite">
              {shown.length ? `${at + 1} / ${shown.length}` : "0 / 0"}
            </span>
            <button
              type="button"
              onClick={() => setPosition(Math.min(shown.length - 1, at + 1))}
              disabled={at < 0 || at >= shown.length - 1}
              aria-label="Next claim"
            >
              ›
            </button>
          </div>
        </div>
      </header>
      {!current ? (
        <p className="quality-note">No claims match this search or filter.</p>
      ) : (
        <div className="compare-grid" key={current.claim.id}>
          <ClaimPanel item={current} />
          <EvidencePanel item={current} refs={refs} sources={sources} />
          <VerdictPanel item={current} />
        </div>
      )}
    </section>
  );
}

function Copy({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="copy-btn"
      onClick={() =>
        navigator.clipboard?.writeText(text).then(
          () => {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          },
          () => {},
        )
      }
    >
      {done ? "Copied" : label}
    </button>
  );
}

function ClaimPanel({ item }: { item: Item }) {
  const { claim } = item;
  return (
    <article className="compare-card">
      <header>
        <small>A · ORIGINAL CLAIM</small>
        <Copy text={claim.text} label="Copy claim" />
      </header>
      <p className="claim-text">{claim.text}</p>
      <p className="quality-note">
        Page {claim.page} · {claim.id} · citation{" "}
        {item.markers.join(", ") || "none"}
      </p>
      {(claim.context.before || claim.context.after) && (
        <details>
          <summary>Surrounding context</summary>
          <p className="quality-note">
            …{claim.context.before} <mark>[claim]</mark> {claim.context.after}…
          </p>
        </details>
      )}
    </article>
  );
}

function EvidencePanel({
  item,
  refs,
  sources,
}: {
  item: Item;
  refs: Map<string, PaperResult["citations"]["references"][number]>;
  sources: Map<
    string,
    NonNullable<
      Extract<PaperResult, { evidence: unknown }>["evidence"]
    >["sources"][number]
  >;
}) {
  const evidence: VerificationEvidence[] = item.verdict?.evidence ?? [];
  const cited = evidence.filter(
    (e) => e.relation === "supports" || e.relation === "contradicts",
  );
  const list = cited.length ? cited : evidence;
  const [open, setOpen] = useState(false);
  const visible = open ? list : list.slice(0, 2);
  return (
    <article className="compare-card">
      <header>
        <small>B · RETRIEVED SCHOLARLY EVIDENCE</small>
      </header>
      {list.length === 0 ? (
        <p className="quality-note">
          {item.verdict
            ? "No scholarly evidence could be retrieved for this claim."
            : sources.size
              ? "Your claims are ready for verification: run “Verify claims with AI” to select passages."
              : "No scholarly evidence has been retrieved yet."}
        </p>
      ) : (
        <>
          {!cited.length && (
            <p className="quality-note">
              The verdict cites no passage; these were retrieved but not relied
              on.
            </p>
          )}
          {visible.map((e) => {
            const ref = refs.get(e.referenceId);
            const src = sources.get(e.referenceId);
            const work = src?.work;
            return (
              <blockquote
                key={e.evidenceId}
                className={`evidence-quote relation-${e.relation}`}
              >
                <p>“{e.text}”</p>
                <footer>
                  <b>
                    {e.relation === "supports"
                      ? "Supports"
                      : e.relation === "contradicts"
                        ? "Contradicts"
                        : "Retrieved"}
                  </b>
                  {" · "}
                  {work?.title ??
                    e.sourceTitle ??
                    (ref?.number != null
                      ? `Reference ${ref.number}`
                      : "Source")}
                  {work?.authors[0]
                    ? ` · ${work.authors[0]}${work.authors.length > 1 ? " et al." : ""}`
                    : ""}
                  {work?.year ? ` (${work.year})` : ""}
                  {" · "}
                  {e.origin === "full_text" ? "full text" : "abstract"}
                  {e.location.section ? ` · ${e.location.section}` : ""}
                  {" · "}
                  {e.doi ? (
                    <a
                      href={`https://doi.org/${e.doi}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      doi:{e.doi}
                    </a>
                  ) : (
                    <a href={e.sourceUrl} target="_blank" rel="noreferrer">
                      source
                    </a>
                  )}
                  {work?.pmid ? (
                    <>
                      {" "}
                      ·{" "}
                      <a
                        href={`https://pubmed.ncbi.nlm.nih.gov/${work.pmid}/`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        PMID {work.pmid}
                      </a>
                    </>
                  ) : null}
                </footer>
                <Copy text={e.text} label="Copy" />
              </blockquote>
            );
          })}
          {list.length > 2 && (
            <button
              type="button"
              className="link-btn"
              onClick={() => setOpen(!open)}
              aria-expanded={open}
            >
              {open
                ? "Show fewer passages"
                : `Show all ${list.length} passages`}
            </button>
          )}
        </>
      )}
    </article>
  );
}

function VerdictPanel({ item }: { item: Item }) {
  const v = item.verdict;
  return (
    <article className="compare-card">
      <header>
        <small>C · AI VERIFICATION</small>
      </header>
      {!v ? (
        <p className="quality-note">
          Not verified yet. Your claims are ready for verification: run “Verify
          claims with AI”.
        </p>
      ) : (
        <>
          <span
            className={`verdict-pill verdict-${v.verdict.replace(/\s+/g, "-").toLowerCase()}`}
          >
            {v.verdict}
          </span>
          {v.verdict === "Unable to verify" && (
            <p className="quality-note">
              <b>Uncertain, not contradicted:</b> the available evidence could
              not settle this claim.
            </p>
          )}
          {v.verdict === "Contradicted" && (
            <p className="quality-note">
              <b>Contradiction:</b> a cited passage states a finding
              incompatible with the claim.
            </p>
          )}
          {v.explanation && (
            <p>
              <b>Explanation (generated text, not evidence):</b> {v.explanation}
            </p>
          )}
          {v.reason && <p className="quality-note">{v.reason}</p>}
          <p className="quality-note">
            {v.model
              ? `${v.model.name} via ${v.model.provider === "groq" ? "Groq (hosted)" : "Ollama (local)"} · prompt ${v.model.promptVersion}`
              : "Decided by rule, without a model"}
            {" · evidence: "}
            {v.evidenceScope.replace("_", " ")}
          </p>
        </>
      )}
    </article>
  );
}
