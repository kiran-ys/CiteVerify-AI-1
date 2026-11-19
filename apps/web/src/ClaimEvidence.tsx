import type {
  ClaimVerification,
  ExtractCitationsResponse,
  ExtractedClaim,
  RetrievedSource,
} from "@citeverify/shared";
import { ClaimVerdict } from "./ClaimVerdict.tsx";
import { ClaimComparison } from "./PaperQuality.tsx";
import { RetrievedSourceView } from "./RetrievedSource.tsx";

type Citations = ExtractCitationsResponse["citations"];

/**
 * External evidence for one claim: retrieved records for its matched
 * references and, if run, the evidence-grounded verdict. Shown apart from
 * citation matching and from internal consistency.
 */
export function ClaimEvidence({
  claim,
  citations,
  sources,
  verdict,
}: {
  claim: ExtractedClaim;
  citations: Citations;
  sources?: Map<string, RetrievedSource>;
  verdict?: ClaimVerification;
}) {
  const referenceIds = [
    ...new Set(
      citations.inText
        .filter((citation) => citation.claimId === claim.id)
        .flatMap((citation) =>
          citation.matches.flatMap((match) =>
            match.status === "matched" ? match.referenceIds : [],
          ),
        ),
    ),
  ];
  const references = new Map(
    citations.references.map((reference) => [reference.id, reference]),
  );

  return (
    <section
      className="claim-evidence"
      aria-label={`External evidence for ${claim.id}`}
    >
      <h3>External evidence verification</h3>
      {referenceIds.length === 0 ? (
        <p className="claim-evidence-note">
          {claim.type === "reported_finding"
            ? "Not applicable: this is the paper's own finding and it cites no matched reference. See internal consistency below."
            : "No external source could be identified: none of this claim's citations matched exactly one reference entry."}
        </p>
      ) : (
        <>
          {verdict && <ClaimComparison claim={claim} verdict={verdict} />}
          {verdict && <ClaimVerdict result={verdict} />}
          {!sources && (
            <p className="claim-evidence-note">
              Cited sources have not been retrieved yet. Use "Retrieve cited
              sources" or "Verify claims with AI" above.
            </p>
          )}
          {sources &&
            referenceIds.map((id) => {
              const source = sources.get(id);
              const reference = references.get(id);
              const name =
                reference?.number !== null && reference?.number !== undefined
                  ? `Reference ${reference.number}`
                  : id;
              return (
                <div key={id} className="claim-evidence-source">
                  <p className="claim-evidence-ref">{name}</p>
                  {source ? (
                    <RetrievedSourceView source={source} claimId={claim.id} />
                  ) : (
                    <p className="claim-evidence-note">Not looked up.</p>
                  )}
                </div>
              );
            })}
        </>
      )}
    </section>
  );
}
