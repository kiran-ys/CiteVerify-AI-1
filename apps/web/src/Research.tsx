/**
 * Research views over the uploaded paper: review queue, citation graph,
 * source explorer, saved-analysis history, and exports. All content comes
 * from the paper's API results; human review is stored separately and never
 * changes an AI verdict.
 */
import { useMemo, useState } from "react";
import type { PaperResult } from "./paper-session.ts";
import { firstLine } from "./report.ts";
import {
  citationGraph,
  downloadText,
  exportJson,
  exportMarkdown,
  type GraphRow,
  type HistoryEntry,
  REASON_LABEL,
  type ReviewReason,
  type ReviewState,
  type ReviewStatus,
  reviewQueue,
  type SourceFilter,
  filterSources,
} from "./research.ts";

function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty-state">
      <span className="empty-glyph" aria-hidden="true">
        ◇
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

const fileBase = (name: string) =>
  name.replace(/\.pdf$/i, "").replace(/[^\w.-]+/g, "-") || "paper";

// ------------------------------------------------------------------ exports

export function ExportButtons({
  paper,
  reviews,
}: {
  paper: PaperResult;
  reviews: ReviewState;
}) {
  return (
    <div className="export-row">
      <button
        type="button"
        className="secondary"
        onClick={() =>
          downloadText(
            `${fileBase(paper.document.name)}-citeverify.json`,
            `${JSON.stringify(exportJson(paper, reviews, new Date()), null, 2)}\n`,
            "application/json",
          )
        }
      >
        Download JSON
      </button>
      <button
        type="button"
        className="secondary"
        onClick={() =>
          downloadText(
            `${fileBase(paper.document.name)}-citeverify.md`,
            exportMarkdown(paper, reviews, new Date()),
            "text/markdown",
          )
        }
      >
        Download Markdown
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ review queue

export function ReviewQueue({
  paper,
  reviews,
  onChange,
}: {
  paper: PaperResult | undefined;
  reviews: ReviewState;
  onChange: (state: ReviewState) => void;
}) {
  const [reason, setReason] = useState<ReviewReason | "all">("all");
  const [status, setStatus] = useState<ReviewStatus | "all">("all");
  const [open, setOpen] = useState<string>();
  const queue = useMemo(() => (paper ? reviewQueue(paper) : []), [paper]);
  if (!paper)
    return (
      <section className="panel research-panel">
        <Empty
          title="Nothing to review yet."
          text="Upload a paper or try the sample; claims that need a human look will appear here."
        />
      </section>
    );
  const statusOf = (id: string): ReviewStatus =>
    reviews[id]?.status ?? "unreviewed";
  const shown = queue.filter(
    (q) =>
      (reason === "all" || q.reason === reason) &&
      (status === "all" || statusOf(q.claimId) === status),
  );
  const verdicts = new Map(
    "verification" in paper
      ? paper.verification.results.map((r) => [r.claimId, r])
      : [],
  );
  const set = (
    id: string,
    patch: Partial<{ status: ReviewStatus; note: string }>,
  ) =>
    onChange({
      ...reviews,
      [id]: { status: statusOf(id), note: reviews[id]?.note ?? "", ...patch },
    });
  const counts = {
    reviewed: queue.filter((q) => statusOf(q.claimId) === "reviewed").length,
    follow: queue.filter((q) => statusOf(q.claimId) === "follow_up").length,
  };
  return (
    <section className="panel research-panel" aria-label="Human review queue">
      <header className="research-head">
        <div>
          <h2>Review queue</h2>
          <p className="quality-note">
            {queue.length} claims need attention · {counts.reviewed} reviewed ·{" "}
            {counts.follow} need follow-up. Your review status and notes are
            kept in this browser and never change the AI verdict.
          </p>
        </div>
        <div className="research-tools">
          <label>
            <span className="sr">Filter by reason</span>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value as typeof reason)}
            >
              <option value="all">All reasons</option>
              {(Object.keys(REASON_LABEL) as ReviewReason[]).map((r) => (
                <option key={r} value={r}>
                  {REASON_LABEL[r]} (
                  {queue.filter((q) => q.reason === r).length})
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr">Filter by review status</span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
            >
              <option value="all">Any review status</option>
              <option value="unreviewed">Unreviewed</option>
              <option value="reviewed">Reviewed</option>
              <option value="follow_up">Needs follow-up</option>
            </select>
          </label>
        </div>
      </header>
      {queue.length === 0 ? (
        <Empty
          title="No claims need review."
          text="Every cited claim was verified as Supported with clean citations."
        />
      ) : shown.length === 0 ? (
        <p className="quality-note">No claims match these filters.</p>
      ) : (
        <ol className="queue">
          {shown.map((q) => {
            const v = verdicts.get(q.claimId);
            const expanded = open === q.claimId;
            const cited =
              v?.evidence.filter(
                (e) =>
                  e.relation === "supports" || e.relation === "contradicts",
              ) ?? [];
            return (
              <li key={q.claimId} className={`queue-item reason-${q.reason}`}>
                <button
                  type="button"
                  className="queue-summary"
                  aria-expanded={expanded}
                  onClick={() => setOpen(expanded ? undefined : q.claimId)}
                >
                  <span className="queue-reason">{REASON_LABEL[q.reason]}</span>
                  <span className="queue-text">{q.text}</span>
                  <small>
                    {q.claimId} · page {q.page} · AI:{" "}
                    {q.verdict ?? "not verified"} · you:{" "}
                    {statusOf(q.claimId).replace("_", " ")}
                  </small>
                </button>
                {expanded && (
                  <div className="queue-detail">
                    {v?.reason && <p className="quality-note">{v.reason}</p>}
                    {v?.explanation && (
                      <p>
                        <b>AI explanation (generated text, not evidence):</b>{" "}
                        {v.explanation}
                      </p>
                    )}
                    {cited.length > 0 ? (
                      cited.map((e) => (
                        <blockquote
                          key={e.evidenceId}
                          className={`evidence-quote relation-${e.relation}`}
                        >
                          <p>“{e.text}”</p>
                          <footer>
                            {e.relation} · {e.sourceTitle ?? "Source"} ·{" "}
                            {e.origin === "full_text"
                              ? "full text"
                              : "abstract"}{" "}
                            ·{" "}
                            <a
                              href={
                                e.doi ? `https://doi.org/${e.doi}` : e.sourceUrl
                              }
                              target="_blank"
                              rel="noreferrer"
                            >
                              {e.doi ? `doi:${e.doi}` : "source"}
                            </a>
                          </footer>
                        </blockquote>
                      ))
                    ) : (
                      <p className="quality-note">
                        No passage supports or contradicts this claim.
                      </p>
                    )}
                    <fieldset className="review-controls">
                      <legend>
                        Your review (does not change the AI verdict)
                      </legend>
                      {(
                        [
                          "unreviewed",
                          "reviewed",
                          "follow_up",
                        ] as ReviewStatus[]
                      ).map((s) => (
                        <label key={s}>
                          <input
                            type="radio"
                            name={`review-${q.claimId}`}
                            checked={statusOf(q.claimId) === s}
                            onChange={() => set(q.claimId, { status: s })}
                          />
                          {s === "follow_up"
                            ? "Needs follow-up"
                            : s[0]?.toUpperCase() + s.slice(1)}
                        </label>
                      ))}
                      <label className="review-note">
                        <span>Note</span>
                        <textarea
                          rows={2}
                          value={reviews[q.claimId]?.note ?? ""}
                          placeholder="Optional note, saved in this browser"
                          onChange={(e) =>
                            set(q.claimId, { note: e.target.value })
                          }
                        />
                      </label>
                    </fieldset>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ citation graph

type Selection = {
  kind: "claim" | "reference" | "evidence" | "verdict";
  row: GraphRow;
  referenceId?: string;
};

export function CitationGraph({ paper }: { paper: PaperResult | undefined }) {
  const rows = useMemo(() => (paper ? citationGraph(paper) : []), [paper]);
  const [selected, setSelected] = useState<Selection>();
  const [query, setQuery] = useState("");
  if (!paper)
    return (
      <section className="panel research-panel">
        <Empty
          title="No citation relationships yet."
          text="Upload a paper to see how each claim connects to its references, retrieved records, evidence, and verdict."
        />
      </section>
    );
  const q = query.trim().toLowerCase();
  const shown = rows.filter(
    (r) =>
      !q ||
      r.text.toLowerCase().includes(q) ||
      r.markers.join(" ").toLowerCase().includes(q),
  );
  const refs = new Map(paper.citations.references.map((r) => [r.id, r]));
  const sources = new Map(
    "evidence" in paper
      ? paper.evidence.sources.map((s) => [s.referenceId, s])
      : [],
  );
  return (
    <section className="panel research-panel" aria-label="Citation graph">
      <header className="research-head">
        <div>
          <h2>Citation graph</h2>
          <p className="quality-note">
            Claim → cited reference → scholarly record → evidence passages → AI
            verdict. A matched citation only links to the reference list; it is
            not evidence.
          </p>
        </div>
        <label className="research-tools">
          <span className="sr">Filter claims</span>
          <input
            type="search"
            placeholder="Filter claims or markers"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </header>
      <div className="graph-legend" aria-hidden="true">
        <span className="g-ok">resolved / supported</span>
        <span className="g-warn">partial or abstract only</span>
        <span className="g-bad">unmatched / contradicted</span>
        <span className="g-off">unavailable / not run</span>
      </div>
      <div className="graph-layout">
        <ol className="graph" aria-label="Claims and their citation chains">
          {shown.map((row) => {
            const tone =
              (row.verdict?.verdict ?? "").replace(/\s+/g, "-").toLowerCase() ||
              "none";
            return (
              <li key={row.claimId} className="graph-row">
                <button
                  type="button"
                  className="g-node g-claim"
                  onClick={() => setSelected({ kind: "claim", row })}
                >
                  <small>
                    {row.claimId} · p.{row.page}
                  </small>
                  <span>
                    {row.text.slice(0, 90)}
                    {row.text.length > 90 ? "…" : ""}
                  </span>
                </button>
                <span className="g-edge" aria-hidden="true" />
                <div className="g-refs">
                  {row.references.map((r) => (
                    <button
                      key={r.referenceId}
                      type="button"
                      className={`g-node g-ref ${r.record === "resolved" ? (r.access === "full_text" || r.access === "abstract_only" ? "g-ok" : "g-warn") : r.record === "not identified" ? "g-bad" : "g-off"}`}
                      onClick={() =>
                        setSelected({
                          kind: "reference",
                          row,
                          referenceId: r.referenceId,
                        })
                      }
                    >
                      [{r.number ?? "?"}] {r.record}
                      <small>
                        {String(r.access).replace("_", " ")} · {r.passages}{" "}
                        passages
                      </small>
                    </button>
                  ))}
                  {row.unmatchedMarkers.map((m) => (
                    <span key={m} className="g-node g-ref g-bad">
                      citation {m}
                    </span>
                  ))}
                </div>
                <span className="g-edge" aria-hidden="true" />
                <button
                  type="button"
                  className={`g-node g-verdict tone-${tone}`}
                  onClick={() => setSelected({ kind: "verdict", row })}
                >
                  {row.verdict?.verdict ?? "Not verified"}
                  <small>
                    {row.citedEvidence} cited passage
                    {row.citedEvidence === 1 ? "" : "s"}
                  </small>
                </button>
              </li>
            );
          })}
        </ol>
        <aside className="graph-detail" aria-live="polite">
          {!selected ? (
            <p className="quality-note">
              Select a claim, reference, or verdict to see its details.
            </p>
          ) : selected.kind === "claim" ? (
            <>
              <h3>
                {selected.row.claimId} · page {selected.row.page}
              </h3>
              <p>{selected.row.text}</p>
              <p className="quality-note">
                Citation markers: {selected.row.markers.join(", ")}
              </p>
              {(() => {
                const claim = paper.claims.items.find(
                  (c) => c.id === selected.row.claimId,
                );
                return claim?.context.before || claim?.context.after ? (
                  <p className="quality-note">
                    Context: …{claim.context.before} [claim]{" "}
                    {claim.context.after}…
                  </p>
                ) : null;
              })()}
            </>
          ) : selected.kind === "reference" && selected.referenceId ? (
            (() => {
              const ref = refs.get(selected.referenceId);
              const s = sources.get(selected.referenceId);
              const passages =
                s?.passages.filter((p) => p.claimId === selected.row.claimId) ??
                [];
              return (
                <>
                  <h3>Reference {ref?.number ?? ""}</h3>
                  <p className="quality-note">{ref?.text}</p>
                  {s?.work ? (
                    <p>
                      <b>{s.work.title}</b>
                      {s.work.authors.length
                        ? ` · ${s.work.authors.slice(0, 3).join(", ")}${s.work.authors.length > 3 ? " et al." : ""}`
                        : ""}
                      {s.work.year ? ` · ${s.work.year}` : ""}
                      {s.urls.doi && (
                        <>
                          {" · "}
                          <a href={s.urls.doi} target="_blank" rel="noreferrer">
                            {s.work.doi}
                          </a>
                        </>
                      )}
                    </p>
                  ) : (
                    <p className="quality-note">
                      {s
                        ? (s.resolution.reason ?? "Not identified.")
                        : "Sources have not been retrieved yet."}
                    </p>
                  )}
                  {passages.map((p) => (
                    <blockquote
                      key={`${p.location.paragraph}-${p.location.sentence}`}
                      className="evidence-quote"
                    >
                      <p>“{p.text}”</p>
                      <footer>
                        {p.origin === "full_text" ? "full text" : "abstract"}
                        {p.location.section ? ` · ${p.location.section}` : ""} ·{" "}
                        <a href={p.sourceUrl} target="_blank" rel="noreferrer">
                          source
                        </a>
                      </footer>
                    </blockquote>
                  ))}
                </>
              );
            })()
          ) : (
            <>
              <h3>{selected.row.verdict?.verdict ?? "Not verified"}</h3>
              {selected.row.verdict?.reason && (
                <p className="quality-note">{selected.row.verdict.reason}</p>
              )}
              {selected.row.verdict?.explanation && (
                <p>
                  <b>AI explanation (not evidence):</b>{" "}
                  {selected.row.verdict.explanation}
                </p>
              )}
              {selected.row.verdict?.evidence
                .filter(
                  (e) =>
                    e.relation === "supports" || e.relation === "contradicts",
                )
                .map((e) => (
                  <blockquote
                    key={e.evidenceId}
                    className={`evidence-quote relation-${e.relation}`}
                  >
                    <p>“{e.text}”</p>
                    <footer>
                      {e.relation} · {e.sourceTitle ?? "Source"}
                    </footer>
                  </blockquote>
                ))}
            </>
          )}
        </aside>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ source explorer

export function SourceExplorer({ paper }: { paper: PaperResult | undefined }) {
  const [filter, setFilter] = useState<SourceFilter>({
    query: "",
    resolution: "all",
    access: "all",
  });
  if (!paper || !("evidence" in paper))
    return (
      <section className="panel research-panel">
        <Empty
          title="No scholarly evidence has been retrieved yet."
          text="Run “Retrieve cited sources” or “Verify claims with AI” in the Workspace to look up the paper's cited works in PubMed, Crossref, OpenAlex, and Europe PMC."
        />
      </section>
    );
  const list = filterSources(paper, filter);
  return (
    <section
      className="panel research-panel"
      aria-label="Scholarly source explorer"
    >
      <header className="research-head">
        <div>
          <h2>Scholarly sources</h2>
          <p className="quality-note">
            {paper.evidence.sources.length} cited works looked up via{" "}
            {paper.evidence.services.join(", ")} on{" "}
            {paper.evidence.retrievedAt.slice(0, 10)}. Records and passages are
            exactly as retrieved.
          </p>
        </div>
        <div className="research-tools">
          <label>
            <span className="sr">Search sources</span>
            <input
              type="search"
              placeholder="Title, author, DOI, or ref 12"
              value={filter.query}
              onChange={(e) => setFilter({ ...filter, query: e.target.value })}
            />
          </label>
          <label>
            <span className="sr">Resolution</span>
            <select
              value={filter.resolution}
              onChange={(e) =>
                setFilter({
                  ...filter,
                  resolution: e.target.value as SourceFilter["resolution"],
                })
              }
            >
              <option value="all">Resolved and unresolved</option>
              <option value="resolved">Resolved</option>
              <option value="unresolved">Not identified</option>
            </select>
          </label>
          <label>
            <span className="sr">Access</span>
            <select
              value={filter.access}
              onChange={(e) =>
                setFilter({
                  ...filter,
                  access: e.target.value as SourceFilter["access"],
                })
              }
            >
              <option value="all">Any access</option>
              <option value="full_text">Full text</option>
              <option value="abstract_only">Abstract only</option>
              <option value="metadata_only">Metadata only</option>
              <option value="unavailable">Unavailable</option>
            </select>
          </label>
        </div>
      </header>
      {list.length === 0 ? (
        <p className="quality-note">No sources match these filters.</p>
      ) : (
        <ul className="source-list">
          {list.map(({ source: s, number, reference }) => (
            <li
              key={s.referenceId}
              className={`source-card access-${s.access}`}
            >
              <header>
                <b>
                  [{number ?? "?"}] {s.work?.title ?? "Not identified"}
                </b>
                <span className={`access-pill access-${s.access}`}>
                  {s.access.replace("_", " ")}
                </span>
              </header>
              {s.work ? (
                <p className="quality-note">
                  {s.work.authors.slice(0, 4).join(", ")}
                  {s.work.authors.length > 4 ? " et al." : ""}
                  {s.work.year ? ` · ${s.work.year}` : ""}
                  {s.work.journal ? ` · ${s.work.journal}` : ""}
                  {s.resolution.matchedBy
                    ? ` · matched by ${s.resolution.matchedBy} via ${s.resolution.resolver}`
                    : ""}
                </p>
              ) : (
                <p className="quality-note">
                  {s.resolution.reason ?? "No record matched this reference."}
                </p>
              )}
              <p className="source-ref">{reference}</p>
              <p className="source-links">
                {s.urls.doi && (
                  <a href={s.urls.doi} target="_blank" rel="noreferrer">
                    DOI
                  </a>
                )}
                {s.work?.pmid && (
                  <a
                    href={`https://pubmed.ncbi.nlm.nih.gov/${s.work.pmid}/`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    PubMed
                  </a>
                )}
                {s.urls.fullText && (
                  <a href={s.urls.fullText} target="_blank" rel="noreferrer">
                    Full text
                  </a>
                )}
              </p>
              {s.accessReason && (
                <p className="quality-note">{s.accessReason}</p>
              )}
              {s.errors.length > 0 && (
                <p className="source-errors">
                  Retrieval problems:{" "}
                  {s.errors
                    .map((e) => `${e.service} ${e.kind.replace("_", " ")}`)
                    .join(", ")}
                </p>
              )}
              {s.passages.length > 0 && (
                <details>
                  <summary>
                    {s.passages.length} retrieved passage
                    {s.passages.length === 1 ? "" : "s"}
                  </summary>
                  {s.passages.map((p) => (
                    <blockquote
                      key={`${p.claimId}-${p.location.paragraph}-${p.location.sentence}`}
                      className="evidence-quote"
                    >
                      <p>“{p.text}”</p>
                      <footer>
                        for {p.claimId} ·{" "}
                        {p.origin === "full_text" ? "full text" : "abstract"}
                      </footer>
                    </blockquote>
                  ))}
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ history

export function HistoryPanel({
  entries,
  currentKey,
  onOpen,
  onDelete,
  compact = false,
}: {
  entries: HistoryEntry[];
  currentKey?: string;
  onOpen: (key: string) => void;
  onDelete: (key: string) => void;
  compact?: boolean;
}) {
  return (
    <section className="panel dash-card history" aria-label="Saved analyses">
      <h2>{compact ? "Recent analyses" : "Saved analyses"}</h2>
      <p className="quality-note">
        Saved in this browser only (up to 8). Results are kept; the PDF itself
        is not, so a reopened analysis can be read and exported, but retrieval
        or verification needs the PDF again.
      </p>
      {entries.length === 0 ? (
        <p className="quality-note">Complete an analysis to save it here.</p>
      ) : (
        <ul className="history-list">
          {entries.slice(0, compact ? 4 : undefined).map((e) => (
            <li key={e.key} className={e.key === currentKey ? "current" : ""}>
              <div>
                <b title={e.name}>{e.title ?? e.name}</b>
                <small>
                  {e.name} · {new Date(e.savedAt).toLocaleString()} · {e.status}{" "}
                  · {e.claims} claims · {e.verified} verified
                </small>
              </div>
              <div className="history-actions">
                {e.key === currentKey ? (
                  <span className="quality-note">Open</span>
                ) : (
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => onOpen(e.key)}
                  >
                    Reopen
                  </button>
                )}
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => onDelete(e.key)}
                  aria-label={`Delete saved analysis ${e.name}`}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export const titleFor = (paper: PaperResult) => firstLine(paper);
