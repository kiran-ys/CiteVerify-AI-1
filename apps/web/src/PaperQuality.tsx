import type {
  ClaimVerification,
  ExtractedClaim,
  VerificationVerdict,
} from "@citeverify/shared";
import type { PaperResult } from "./paper-session.ts";
import { CAUSE_LABEL, paperQuality, share } from "./quality.ts";

const verdictTone: Record<VerificationVerdict, string> = {
  Supported: "green",
  "Partially supported": "amber",
  Contradicted: "red",
  Unsupported: "slate",
  "Unable to verify": "gray",
};

/** Real figures for the uploaded paper; steps not yet run say so. */
export function QualityPanel({ paper }: { paper: PaperResult }) {
  const q = paperQuality(paper);
  const v = q.verification;
  const max = Math.max(1, ...(v?.byVerdict.map((b) => b.count) ?? [1]));
  return (
    <section
      className="panel quality-panel"
      aria-label="Verification quality for the uploaded paper"
    >
      <header className="quality-head">
        <div>
          <small>REAL RESULTS · {paper.document.name}</small>
          <h2>Verification quality</h2>
        </div>
        {v?.model && (
          <span className="quality-model">
            {v.model} via{" "}
            {v.provider === "groq" ? "Groq (hosted)" : "Ollama (local)"}
          </span>
        )}
      </header>
      <div className="quality-tiles">
        <Tile
          label="Claims found"
          value={String(q.claims.total)}
          note={`${q.claims.cited} with a citation matched to a reference`}
        />
        <Tile
          label="Sources identified"
          value={
            q.sources
              ? share(q.sources.identified, q.sources.lookedUp)
              : "Not run"
          }
          note={
            q.sources
              ? `${q.sources.abstractOnly + q.sources.fullText} with abstract or full text`
              : "Retrieve sources to measure"
          }
        />
        <Tile
          label="Evidence coverage"
          value={
            q.sources
              ? share(q.sources.claimsWithEvidence, q.claims.cited)
              : "Not run"
          }
          note="cited claims with at least one retrieved passage"
        />
        <Tile
          label="Unable to verify"
          value={v ? share(v.unable, v.judged) : "Not run"}
          note={
            v
              ? "abstentions, not false claims"
              : "Run AI verification to measure"
          }
        />
      </div>
      {v ? (
        <div
          className="verdict-chart"
          role="img"
          aria-label={`Verdicts: ${v.byVerdict.map((b) => `${b.count} ${b.verdict}`).join(", ")}`}
        >
          <h3>Verdict distribution ({v.judged} cited claims)</h3>
          {v.byVerdict.map((b) => (
            <div key={b.verdict} className="verdict-row">
              <span>{b.verdict}</span>
              <div className="verdict-track">
                <i
                  className={`tone-${verdictTone[b.verdict]}`}
                  style={{ width: `${(100 * b.count) / max}%` }}
                />
              </div>
              <b>{b.count}</b>
            </div>
          ))}
          {v.unableCauses.length > 0 && (
            <p className="quality-note">
              Unable to verify because:{" "}
              {v.unableCauses
                .map((c) => `${CAUSE_LABEL[c.cause] ?? c.cause} (${c.count})`)
                .join(", ")}
              .
            </p>
          )}
          {v.truncated && (
            <p className="quality-note">
              Some claims were not checked within the time budget.
            </p>
          )}
        </div>
      ) : (
        <p className="quality-note">
          AI verification not performed for this paper yet, so no verdicts are
          shown.
        </p>
      )}
      <p className="quality-note">
        Verdicts are AI judgements on retrieved text and need human review.
        Accuracy has not been measured against independently reviewed labels;
        the project's benchmark uses provisional labels (see docs/evaluation in
        the repository).
      </p>
    </section>
  );
}

function Tile({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <article className="quality-tile">
      <small>{label}</small>
      <strong>{value}</strong>
      <p>{note}</p>
    </article>
  );
}

/** Citation matching, source discovery, and evidence access, kept apart. */
export function CitationIntegrity({ paper }: { paper: PaperResult }) {
  const q = paperQuality(paper);
  const c = q.citations;
  const s = q.sources;
  return (
    <section className="panel integrity-panel" aria-label="Citation integrity">
      <h2>Citation integrity</h2>
      <div className="integrity-grid">
        <div>
          <h3>1. Citation matching</h3>
          <p>
            {c.referenceListFound
              ? `${c.references} reference entries found.`
              : "No reference list found."}{" "}
            {c.matched} of {c.items} cited items matched one entry
            {c.unmatched ? `, ${c.unmatched} unmatched` : ""}
            {c.ambiguous ? `, ${c.ambiguous} ambiguous` : ""}.
          </p>
          {c.unmatchedMarkers.length > 0 && (
            <p className="quality-note">
              Not matched: {c.unmatchedMarkers.slice(0, 12).join(", ")}
              {c.unmatchedMarkers.length > 12 ? "…" : ""}
            </p>
          )}
          <p className="quality-note">
            A match only links a claim to the paper's own reference list; it is
            not evidence.
          </p>
        </div>
        <div>
          <h3>2. Source discovery</h3>
          {s ? (
            <p>
              {s.identified} of {s.lookedUp} cited works identified in PubMed,
              Crossref, or OpenAlex
              {s.lookedUp - s.identified
                ? `; ${s.lookedUp - s.identified} not identified`
                : ""}
              .
            </p>
          ) : (
            <p>Not run yet.</p>
          )}
        </div>
        <div>
          <h3>3. Evidence access</h3>
          {s ? (
            <p>
              Full text {s.fullText} · abstract only {s.abstractOnly} · metadata
              only {s.metadataOnly} · unavailable {s.unavailable}
              {s.withErrors
                ? ` · ${s.withErrors} with service errors${s.rateLimited ? ` (${s.rateLimited} rate-limited)` : ""}`
                : ""}
              .
            </p>
          ) : (
            <p>Not run yet.</p>
          )}
        </div>
      </div>
    </section>
  );
}

type StepState = "done" | "running" | "todo";

/** Real pipeline steps; no percentages, because the server answers once at the end. */
export function StepTracker({
  paper,
  retrieving,
  verifying,
}: {
  paper: PaperResult | undefined;
  retrieving: boolean;
  verifying: boolean;
}) {
  const hasEvidence = !!paper && "evidence" in paper;
  const hasVerdicts = !!paper && "verification" in paper;
  const steps: [string, StepState, string][] = [
    [
      "Extract text",
      paper ? "done" : "todo",
      paper ? `${paper.document.pageCount} pages` : "",
    ],
    [
      "Find claims",
      paper ? "done" : "todo",
      paper ? `${paper.claims.items.length} claims` : "",
    ],
    [
      "Match citations",
      paper ? "done" : "todo",
      paper ? `${paper.citations.inText.length} citations` : "",
    ],
    [
      "Retrieve sources",
      retrieving || verifying ? "running" : hasEvidence ? "done" : "todo",
      hasEvidence && paper && "evidence" in paper
        ? `${paper.evidence.sources.length} looked up`
        : "",
    ],
    [
      "AI verification",
      verifying ? "running" : hasVerdicts ? "done" : "todo",
      hasVerdicts && paper && "verification" in paper
        ? `${paper.verification.results.length} claims judged`
        : "",
    ],
  ];
  return (
    <ol className="step-tracker" aria-label="Analysis progress">
      {steps.map(([name, state, detail]) => (
        <li
          key={name}
          className={`step-${state}`}
          aria-current={state === "running" ? "step" : undefined}
        >
          <span aria-hidden="true">
            {state === "done" ? "✓" : state === "running" ? "…" : "○"}
          </span>
          <b>{name}</b>
          <small>
            {state === "running"
              ? "in progress"
              : state === "done"
                ? detail
                : "not run"}
          </small>
        </li>
      ))}
    </ol>
  );
}

/** The claim beside the exact passages its verdict rests on. */
export function ClaimComparison({
  claim,
  verdict,
}: {
  claim: ExtractedClaim;
  verdict: ClaimVerification;
}) {
  const cited = verdict.evidence.filter(
    (e) => e.relation === "supports" || e.relation === "contradicts",
  );
  return (
    <section
      className="claim-comparison"
      aria-label={`Claim and evidence for ${claim.id}`}
    >
      <div>
        <small>CLAIM · page {claim.page}</small>
        <p>{claim.text}</p>
      </div>
      <div>
        <small>EVIDENCE THE VERDICT CITES</small>
        {cited.length === 0 ? (
          <p className="quality-note">
            {verdict.verdict === "Unable to verify"
              ? "Insufficient evidence: no retrieved passage settles this claim."
              : "No passage cited."}
          </p>
        ) : (
          cited.map((e) => (
            <blockquote key={e.evidenceId} className={`relation-${e.relation}`}>
              <p>“{e.text}”</p>
              <footer>
                {e.relation === "supports" ? "Supports" : "Contradicts"} ·{" "}
                {e.sourceTitle ?? "Source"} ·{" "}
                {e.origin === "full_text" ? "full text" : "abstract"}
                {e.doi ? (
                  <>
                    {" · "}
                    <a
                      href={`https://doi.org/${e.doi}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      doi:{e.doi}
                    </a>
                  </>
                ) : (
                  <>
                    {" · "}
                    <a href={e.sourceUrl} target="_blank" rel="noreferrer">
                      source
                    </a>
                  </>
                )}
              </footer>
            </blockquote>
          ))
        )}
      </div>
    </section>
  );
}
