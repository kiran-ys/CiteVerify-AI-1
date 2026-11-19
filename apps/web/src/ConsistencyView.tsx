import type {
  ClaimConsistency,
  ConsistencyCheck,
  ConsistencyStatus,
  InternalConsistency,
} from "@citeverify/shared";

export const CONSISTENCY_LABEL =
  "Internal consistency — checked against this paper only, not proof the data are genuine";

const statusLabel: Record<ConsistencyStatus, string> = {
  consistent: "Consistent",
  inconsistent: "Inconsistency found",
  not_checkable: "Not checkable",
};

const kindLabel: Record<ConsistencyCheck["kind"], string> = {
  value_reported_elsewhere: "Value reported elsewhere in the paper",
  ci_p_agreement: "Confidence interval vs p-value",
  significance_wording: "Significance wording vs statistics",
};

/** One own-finding claim's checks, each with exact text from the paper. */
export function ClaimConsistencyView({ result }: { result: ClaimConsistency }) {
  return (
    <section
      className="consistency"
      aria-label={`Internal consistency of ${result.claimId}`}
    >
      <h3>Internal consistency</h3>
      <p className="consistency-head">
        <span className="consistency-label">{CONSISTENCY_LABEL}</span>
        <span className={`consistency-badge consistency-${result.status}`}>
          {statusLabel[result.status]}
        </span>
      </p>
      {result.checks.length === 0 ? (
        <p className="consistency-empty">
          This finding states no specific value, confidence interval, or p-value
          that could be compared with the rest of the paper.
        </p>
      ) : (
        <ul>
          {result.checks.map((check) => (
            <li
              key={`${check.kind}-${check.detail}`}
              className={`consistency-check consistency-${check.status}`}
            >
              <p>
                <b>{kindLabel[check.kind]}</b> · {statusLabel[check.status]}
              </p>
              <p>{check.detail}</p>
              {check.quotes.map((quote) => (
                <blockquote key={`${quote.page}-${quote.start}`}>
                  {quote.text}
                  <small> — page {quote.page}</small>
                </blockquote>
              ))}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ConsistencySummary({
  consistency,
}: {
  consistency: InternalConsistency;
}) {
  const counts: Record<ConsistencyStatus, number> = {
    consistent: 0,
    inconsistent: 0,
    not_checkable: 0,
  };
  for (const result of consistency.results) counts[result.status]++;
  return (
    <div className="consistency-summary" role="status">
      <p>
        <b>Internal consistency of the paper's own findings:</b>{" "}
        {consistency.results.length} findings checked — {counts.consistent}{" "}
        consistent, {counts.inconsistent} with an inconsistency,{" "}
        {counts.not_checkable} not checkable.
      </p>
      <p>{consistency.disclaimer}</p>
    </div>
  );
}
