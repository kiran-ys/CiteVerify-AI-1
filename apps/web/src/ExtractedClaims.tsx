import type {
  ExtractCitationsResponse,
  ExtractClaimsResponse,
  ExtractedClaimType,
} from "@citeverify/shared";
import { useState } from "react";
import { CitationSummary, ClaimCitations } from "./ClaimCitations.tsx";

const typeLabel: Record<ExtractedClaimType, string> = {
  reported_finding: "Reported finding",
  cited_claim: "Cited claim",
};

type Filter = "all" | ExtractedClaimType;

/**
 * Shows candidate claims found in the uploaded paper. These are extraction
 * output only: no verdicts, scores, or demo data are shown here.
 */
export function ExtractedClaims({
  claims,
  citations,
}: {
  claims: ExtractClaimsResponse["claims"];
  citations?: ExtractCitationsResponse["citations"];
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const visible = claims.items.filter(
    (claim) => filter === "all" || claim.type === filter,
  );
  const count = (type: ExtractedClaimType) =>
    claims.items.filter((claim) => claim.type === type).length;

  return (
    <section className="extracted-claims" aria-labelledby="extracted-claims">
      <header>
        <div>
          <small>FROM YOUR UPLOADED PAPER</small>
          <h2 id="extracted-claims">Extracted claims — not yet verified</h2>
        </div>
        <span className="unverified-pill">Not verified</span>
      </header>
      <p className="claims-note">
        These sentences were selected by transparent text rules ({claims.method}{" "}
        v{claims.version}) and are shown in the paper's exact wording. They are
        candidates for review: nothing here has been checked against its
        sources, and no verdict or confidence score is assigned.
      </p>
      {citations && <CitationSummary citations={citations} />}

      {claims.items.length === 0 ? (
        <p className="claims-empty">
          No candidate claims were found. The rules only select sentences with
          explicit result wording, statistics, or citation markers, so a paper
          can contain claims that these rules miss.
        </p>
      ) : (
        <>
          <fieldset className="claims-filter">
            <legend>Show claim type</legend>
            {(
              [
                ["all", `All (${claims.items.length})`],
                [
                  "reported_finding",
                  `Reported findings (${count("reported_finding")})`,
                ],
                ["cited_claim", `Cited claims (${count("cited_claim")})`],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {label}
              </button>
            ))}
          </fieldset>
          {claims.truncated && (
            <p className="claims-truncated" role="status">
              Only the first {claims.items.length} candidate claims are shown.
            </p>
          )}
          <ol className="claims-list">
            {visible.map((claim) => (
              <li key={claim.id}>
                <div className="claim-meta">
                  <b>{claim.id}</b>
                  <span>Page {claim.page}</span>
                  {claim.section && <span>{claim.section}</span>}
                  <span className={`claim-type ${claim.type}`}>
                    {typeLabel[claim.type]}
                  </span>
                </div>
                <blockquote>{claim.text}</blockquote>
                {citations && (
                  <ClaimCitations claim={claim} citations={citations} />
                )}
                <details>
                  <summary>Context and extraction details</summary>
                  <dl>
                    <dt>Sentence before</dt>
                    <dd>{claim.context.before ?? "None on this page"}</dd>
                    <dt>Sentence after</dt>
                    <dd>{claim.context.after ?? "None on this page"}</dd>
                    <dt>Why it was selected</dt>
                    <dd>{claim.extraction.signals.join(", ")}</dd>
                    <dt>Location</dt>
                    <dd>
                      Page {claim.page}, characters {claim.location.start}–
                      {claim.location.end} of the extracted page text
                    </dd>
                  </dl>
                </details>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
