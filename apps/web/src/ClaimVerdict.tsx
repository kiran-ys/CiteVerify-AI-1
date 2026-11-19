import type {
  ClaimVerification,
  EvidenceRelation,
  VerificationEvidence,
  VerificationStatusResponse,
  VerificationVerdict,
  VerifyClaimsResponse,
} from "@citeverify/shared";

type Verification = VerifyClaimsResponse["verification"];

export const VERDICT_LABEL =
  "Evidence-grounded verdict — model judgement, needs your review";
export const RULE_LABEL =
  "Not verified — decided by rule, without a model judgement";

const verdictClass: Record<VerificationVerdict, string> = {
  Supported: "verdict-supported",
  "Partially supported": "verdict-partial",
  Contradicted: "verdict-contradicted",
  "Insufficient evidence": "verdict-insufficient",
  "Unable to verify": "verdict-unable",
};

const relationLabel: Record<EvidenceRelation, string> = {
  supports: "Supporting passage",
  contradicts: "Contradicting passage",
  context: "Context passage",
  not_cited: "Retrieved passage, not relied on",
};

const scopeLabel: Record<ClaimVerification["evidenceScope"], string> = {
  full_text: "full text",
  abstract_only: "abstracts only",
  mixed: "full text and abstracts",
  none: "no evidence",
};

function Passage({ item }: { item: VerificationEvidence }) {
  const where = [
    item.origin === "full_text" ? "Full text" : "Abstract",
    item.location.section,
    `paragraph ${item.location.paragraph}, sentence ${item.location.sentence}`,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <figure className={`verdict-passage relation-${item.relation}`}>
      <p className="verdict-passage-role">
        {item.evidenceId} · {relationLabel[item.relation]}
      </p>
      <blockquote cite={item.sourceUrl}>{item.text}</blockquote>
      <figcaption>
        {item.sourceTitle ? `${item.sourceTitle} · ` : ""}
        {where} ·{" "}
        <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">
          source
        </a>
        {item.doi && (
          <>
            {" · "}
            <a
              href={`https://doi.org/${item.doi}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              DOI {item.doi}
            </a>
          </>
        )}
        {item.markupRemoved
          ? " · formatting such as superscripts was flattened"
          : ""}
      </figcaption>
    </figure>
  );
}

/** One claim's verdict with the exact passages it rests on. */
export function ClaimVerdict({ result }: { result: ClaimVerification }) {
  const used = result.evidence.filter((item) => item.relation !== "not_cited");
  const other = result.evidence.filter((item) => item.relation === "not_cited");
  return (
    <section
      className="claim-verdict"
      aria-label={`Verification of ${result.claimId}`}
    >
      <p className="claim-verdict-head">
        <span className="claim-verdict-label">
          {result.decidedBy === "model" ? VERDICT_LABEL : RULE_LABEL}
        </span>
        <span className={`verdict-badge ${verdictClass[result.verdict]}`}>
          {result.verdict}
        </span>
      </p>
      {result.reason && <p className="claim-verdict-reason">{result.reason}</p>}
      {used.map((item) => (
        <Passage key={item.evidenceId} item={item} />
      ))}
      {other.length > 0 && (
        <details className="claim-verdict-other">
          <summary>
            {used.length > 0
              ? "Other retrieved passages considered"
              : "Retrieved passages"}{" "}
            ({other.length})
          </summary>
          {other.map((item) => (
            <Passage key={item.evidenceId} item={item} />
          ))}
        </details>
      )}
      {result.explanation && (
        <p className="claim-verdict-explanation">
          <b>Model explanation (generated text, not evidence):</b>{" "}
          {result.explanation}
        </p>
      )}
      <p className="claim-verdict-meta">
        {result.model
          ? `${result.model.name} via Ollama · prompt ${result.model.promptVersion} · evidence: ${scopeLabel[result.evidenceScope]}`
          : "Decided by rule, without a model"}
      </p>
    </section>
  );
}

/** Opt-in control for local-model verification, with model status. */
export function VerificationBar({
  status,
  verification,
  verifying,
  error,
  onVerify,
}: {
  status?: VerificationStatusResponse;
  verification?: Verification;
  verifying: boolean;
  error: string;
  onVerify: () => void;
}) {
  const counts = new Map<VerificationVerdict, number>();
  for (const result of verification?.results ?? []) {
    counts.set(result.verdict, (counts.get(result.verdict) ?? 0) + 1);
  }
  return (
    <div className="verification-bar">
      {verification ? (
        <p>
          Checked {verification.results.length} claims
          {verification.model
            ? ` with ${verification.model.name}`
            : " without a model"}
          :{" "}
          {[...counts.entries()]
            .map(([verdict, count]) => `${count} ${verdict}`)
            .join(", ")}
          .
          {verification.truncated
            ? " Some claims were not checked within the time budget."
            : ""}
        </p>
      ) : (
        <p>
          Compare each claim with its retrieved passages using a local model in
          Ollama
          {status?.model ? ` (${status.model})` : ""}. This also retrieves the
          cited sources, and can take a few minutes.
        </p>
      )}
      {status && !status.available && (
        <p className="verification-bar-warning">
          Local model not ready: {status.reason} Claims with evidence will show
          "Unable to verify".
        </p>
      )}
      <p className="verification-bar-note">
        Verdicts are a model's reading of the retrieved text. They are not
        measured to be accurate and must be checked against the quoted passages.
      </p>
      {error && (
        <p className="verification-bar-error" role="alert">
          {error}
        </p>
      )}
      <button type="button" onClick={onVerify} disabled={verifying}>
        {verifying
          ? "Verifying claims…"
          : verification
            ? "Verify again"
            : "Verify claims with local model"}
      </button>
    </div>
  );
}
