import type {
  ExtractEvidenceResponse,
  RetrievedSource,
  SourceAccess,
} from "@citeverify/shared";

type Evidence = ExtractEvidenceResponse["evidence"];

export const RETRIEVED_LABEL = "Source retrieved — claim not yet verified";

const accessLabel: Record<SourceAccess, string> = {
  full_text: "Full text",
  abstract_only: "Abstract only",
  metadata_only: "Metadata only",
  unavailable: "Unavailable",
};

const resolverName = {
  pubmed: "PubMed",
  crossref: "Crossref",
  openalex: "OpenAlex",
} as const;

function authorsLine(authors: string[]): string {
  if (authors.length === 0) return "Authors not listed";
  return authors.length > 3
    ? `${authors.slice(0, 3).join(", ")}, et al.`
    : authors.join(", ");
}

function ExternalLink({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

/** Retrieval result for one cited reference, as it relates to one claim. */
export function RetrievedSourceView({
  source,
  claimId,
}: {
  source: RetrievedSource;
  claimId: string;
}) {
  const { resolution, work } = source;
  const passages = source.passages.filter(
    (passage) => passage.claimId === claimId,
  );
  const hasText =
    source.access === "full_text" || source.access === "abstract_only";

  return (
    <div className={`retrieved-source ${source.access}`}>
      <p className="retrieved-head">
        {resolution.status === "resolved" && (
          <span className="retrieved-label">{RETRIEVED_LABEL}</span>
        )}
        <span className={`access-badge ${source.access}`}>
          {accessLabel[source.access]}
        </span>
      </p>

      {work && (
        <div className="retrieved-work">
          <p>
            <b>{work.title}</b>
            {work.year ? ` (${work.year})` : ""}
            {work.journal ? ` · ${work.journal}` : ""}
          </p>
          <p>{authorsLine(work.authors)}</p>
          <p className="retrieved-provenance">
            Identified{" "}
            {resolution.matchedBy === "pmid"
              ? "from the reference's PubMed ID"
              : resolution.matchedBy === "doi"
                ? "from the reference's DOI"
                : "by bibliographic search"}
            {resolution.resolver
              ? ` via ${resolverName[resolution.resolver]}`
              : ""}
            {source.license ? ` · licence: ${source.license}` : ""}
          </p>
          <p className="retrieved-links">
            {source.urls.doi && (
              <ExternalLink
                href={source.urls.doi}
              >{`DOI ${work.doi}`}</ExternalLink>
            )}
            {source.urls.fullText && (
              <ExternalLink href={source.urls.fullText}>
                Open-access full text
              </ExternalLink>
            )}
          </p>
        </div>
      )}

      {(source.accessReason || resolution.reason) && (
        <p className="retrieved-reason">
          {source.accessReason ?? resolution.reason}
        </p>
      )}

      {resolution.status === "ambiguous" && (
        <ul className="retrieved-candidates">
          {resolution.candidates.map((candidate) => (
            <li key={`${candidate.doi}-${candidate.title}`}>
              {candidate.title}
              {candidate.year ? ` (${candidate.year})` : ""}
              {candidate.doi ? ` · DOI ${candidate.doi}` : ""}
            </li>
          ))}
        </ul>
      )}

      {passages.length > 0 && (
        <div className="retrieved-passages">
          <p className="retrieved-passages-title">
            Retrieved text considered for this claim (abstract sentences in
            order; full-text sentences ranked by shared terms)
          </p>
          {passages.map((passage) => (
            <figure
              key={`${passage.origin}-${passage.location.paragraph}-${passage.location.sentence}`}
            >
              <blockquote cite={passage.sourceUrl}>{passage.text}</blockquote>
              <figcaption>
                {passage.origin === "full_text" ? "Full text" : "Abstract"}
                {passage.location.section
                  ? ` · ${passage.location.section}`
                  : ""}{" "}
                · paragraph {passage.location.paragraph}, sentence{" "}
                {passage.location.sentence} · shared terms:{" "}
                {passage.relevance.sharedTerms.join(", ")} ·{" "}
                <ExternalLink href={passage.sourceUrl}>source</ExternalLink>
                {passage.markupRemoved && (
                  <span className="markup-note">
                    {" "}
                    · formatting such as superscripts was flattened
                  </span>
                )}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
      {hasText && passages.length === 0 && (
        <p className="retrieved-reason">
          No sentence in the accessible text shared enough key terms with this
          claim.
        </p>
      )}

      {source.errors.length > 0 && (
        <ul className="retrieved-errors">
          {source.errors.map((error) => (
            <li key={`${error.service}-${error.kind}-${error.message}`}>
              {error.service}: {error.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Opt-in control and overview for source retrieval. */
export function SourceRetrievalBar({
  evidence,
  retrieving,
  error,
  onRetrieve,
}: {
  evidence?: Evidence;
  retrieving: boolean;
  error: string;
  onRetrieve: () => void;
}) {
  const counts: Record<SourceAccess, number> = {
    full_text: 0,
    abstract_only: 0,
    metadata_only: 0,
    unavailable: 0,
  };
  for (const source of evidence?.sources ?? []) counts[source.access]++;

  return (
    <div className="source-retrieval">
      {evidence ? (
        <p>
          Looked up {evidence.sources.length} cited references at{" "}
          {new Date(evidence.retrievedAt).toLocaleTimeString()}:{" "}
          {counts.full_text} full text, {counts.abstract_only} abstract only,{" "}
          {counts.metadata_only} metadata only, {counts.unavailable}{" "}
          unavailable.
          {evidence.truncated
            ? " Some references were skipped because of the per-request limit."
            : ""}
        </p>
      ) : (
        <p>
          Retrieve the cited sources from Crossref, OpenAlex, Europe PMC and
          PubMed Central. Only the cited references' details are sent, never
          your PDF. This can take up to a minute.
        </p>
      )}
      <p className="source-retrieval-note">
        Retrieved passages are chosen by shared words. They are material for
        your review, not a judgement that the source supports or contradicts a
        claim.
      </p>
      {error && (
        <p className="source-retrieval-error" role="alert">
          {error}
        </p>
      )}
      <button type="button" onClick={onRetrieve} disabled={retrieving}>
        {retrieving
          ? "Retrieving sources…"
          : evidence
            ? "Retrieve sources again"
            : "Retrieve cited sources"}
      </button>
    </div>
  );
}
