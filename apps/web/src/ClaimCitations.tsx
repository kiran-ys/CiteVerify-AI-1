import type {
  CitationMatch,
  ExtractCitationsResponse,
  ExtractedClaim,
  ReferenceEntry,
  RetrievedSource,
} from "@citeverify/shared";
import { RetrievedSourceView } from "./RetrievedSource.tsx";

type Citations = ExtractCitationsResponse["citations"];

export const MATCHED_LABEL = "Citation matched — evidence not yet verified";

const statusLabel: Record<CitationMatch["status"], string> = {
  matched: MATCHED_LABEL,
  unmatched: "No matching reference found",
  ambiguous: "Ambiguous — more than one possible reference",
};

function ReferenceDetails({ reference }: { reference: ReferenceEntry }) {
  const { metadata } = reference;
  const pages =
    reference.pageEnd === reference.page
      ? `page ${reference.page}`
      : `pages ${reference.page}–${reference.pageEnd}`;
  return (
    <div className="reference-entry">
      <p className="reference-source">
        Reference list entry
        {reference.number !== null ? ` ${reference.number}` : ""} · {pages}
      </p>
      <blockquote>{reference.text}</blockquote>
      <dl>
        {metadata.authors.length > 0 && (
          <>
            <dt>Authors</dt>
            <dd>{metadata.authors.join("; ")}</dd>
          </>
        )}
        {metadata.year && (
          <>
            <dt>Year</dt>
            <dd>{metadata.year}</dd>
          </>
        )}
        {metadata.title && (
          <>
            <dt>Title</dt>
            <dd>{metadata.title}</dd>
          </>
        )}
        {metadata.doi && (
          <>
            <dt>DOI</dt>
            <dd>{metadata.doi}</dd>
          </>
        )}
      </dl>
      <p className="reference-note">
        Fields are read from this entry's text only and have not been checked
        against any external record.
      </p>
    </div>
  );
}

function MatchResult({
  match,
  references,
  claimId,
  sources,
}: {
  match: CitationMatch;
  references: Map<string, ReferenceEntry>;
  claimId: string;
  sources?: Map<string, RetrievedSource>;
}) {
  const candidates = match.referenceIds
    .map((id) => references.get(id))
    .filter(
      (reference): reference is ReferenceEntry => reference !== undefined,
    );
  return (
    <li className={`citation-match ${match.status}`}>
      <p className="match-head">
        <span className="match-key">{match.key}</span>
        <span className={`match-status ${match.status}`}>
          {statusLabel[match.status]}
        </span>
      </p>
      {match.reason && <p className="match-reason">{match.reason}</p>}
      {candidates.map((reference) => {
        const source =
          match.status === "matched" ? sources?.get(reference.id) : undefined;
        return (
          <div key={reference.id}>
            <ReferenceDetails reference={reference} />
            {source && (
              <RetrievedSourceView source={source} claimId={claimId} />
            )}
          </div>
        );
      })}
    </li>
  );
}

/** Citations found inside one claim, each resolved against the paper's own reference list. */
export function ClaimCitations({
  claim,
  citations,
  sources,
}: {
  claim: ExtractedClaim;
  citations: Citations;
  sources?: Map<string, RetrievedSource>;
}) {
  const inClaim = citations.inText.filter(
    (citation) => citation.claimId === claim.id,
  );
  if (inClaim.length === 0) {
    return claim.type === "cited_claim" ? (
      <p className="claim-citations-empty">
        No citation marker in this claim could be read for matching.
      </p>
    ) : null;
  }

  const references = new Map(
    citations.references.map((reference) => [reference.id, reference]),
  );
  return (
    <section
      className="claim-citations"
      aria-label={`Citations in ${claim.id}`}
    >
      <h3>Citations in this claim</h3>
      {inClaim.map((citation) => (
        <div key={citation.id} className="claim-citation">
          <p className="citation-marker">
            Marker <code>{citation.marker}</code> · page {citation.page}
          </p>
          <ul>
            {/* Cited items are unique within a marker, so the key is stable. */}
            {citation.matches.map((match) => (
              <MatchResult
                key={match.key}
                match={match}
                references={references}
                claimId={claim.id}
                sources={sources}
              />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

/** One-line overview of the reference list and citation outcomes. */
export function CitationSummary({ citations }: { citations: Citations }) {
  const counts = { matched: 0, unmatched: 0, ambiguous: 0 };
  for (const citation of citations.inText) {
    for (const match of citation.matches) counts[match.status]++;
  }
  const { referenceList } = citations;
  return (
    <div className="citation-summary" role="status">
      <p>
        {referenceList.found
          ? `Reference list found on page ${referenceList.page} with ${citations.references.length} ${
              referenceList.style === "numbered" ? "numbered" : "author-year"
            } entries.`
          : "No reference list was found, so citations cannot be matched."}{" "}
        Cited items in the paper: {counts.matched} matched, {counts.unmatched}{" "}
        unmatched, {counts.ambiguous} ambiguous.
      </p>
      <p>
        A match only links an in-text marker to an entry in this paper's own
        reference list. Whether that source supports the claim has not been
        checked.
      </p>
      {citations.truncated && (
        <p className="claims-truncated">
          Some references or citations were not shown because of response
          limits.
        </p>
      )}
    </div>
  );
}
