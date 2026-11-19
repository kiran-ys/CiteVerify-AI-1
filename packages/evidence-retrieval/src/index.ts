/**
 * Retrieves genuine scholarly records and legally accessible text for the
 * references that an uploaded paper's claims cite.
 *
 * What it does NOT do: decide whether a source supports a claim. A resolved
 * source and a high-overlap passage are material for a human reviewer only.
 */
import type {
  ExtractEvidenceResponse,
  ExtractedClaim,
  InTextCitation,
  ReferenceEntry,
  RetrievedSource,
  ServiceError,
  SourceCandidate,
} from "@citeverify/shared";
import { HttpClient, type HttpOptions } from "./http.ts";
import { checkIdentity, normalizeDoi, paginationMatches } from "./identity.ts";
import { type PassageSource, selectPassages } from "./passages.ts";
import {
  crossrefByDoi,
  crossrefSearch,
  type EuropePmcRecord,
  europePmcFullText,
  europePmcLookup,
  openAlexSearch,
  pmcFullText,
  pmidFromReference,
  pubmedAbstract,
  pubmedRecord,
  type ServiceRecord,
} from "./services.ts";
import { abstractParagraphs, jatsBodyParagraphs } from "./text.ts";

export { HttpClient, USER_AGENT } from "./http.ts";
export { parsePubmedRecord, pmidFromReference } from "./services.ts";
export {
  checkIdentity,
  normalizeDoi,
  paginationMatches,
  titleSimilarity,
} from "./identity.ts";
export {
  keyTerms,
  MAX_ABSTRACT_SENTENCES,
  MAX_FULL_TEXT_PASSAGES,
  rankPassages,
  selectPassages,
} from "./passages.ts";
export {
  abstractParagraphs,
  jatsBodyParagraphs,
  splitSentences,
} from "./text.ts";

export const EVIDENCE_METHOD = "metadata-resolution+term-overlap" as const;
export const EVIDENCE_VERSION = "1.0.0";
export const DEFAULT_MAX_SOURCES = 40;
export const DEFAULT_TIME_BUDGET_MS = 90_000;

export type EvidenceInput = {
  references: ReferenceEntry[];
  claims: ExtractedClaim[];
  citations: InTextCitation[];
};

export type RetrievalOptions = HttpOptions & {
  maxSources?: number;
  timeBudgetMs?: number;
  now?: () => Date;
};

export type EvidenceResult = ExtractEvidenceResponse["evidence"];

type Resolution = RetrievedSource["resolution"];

function emptySource(
  reference: ReferenceEntry,
  claimIds: string[],
): RetrievedSource {
  return {
    referenceId: reference.id,
    claimIds,
    resolution: {
      status: "unresolved",
      reason: null,
      matchedBy: null,
      resolver: null,
      candidates: [],
    },
    work: null,
    access: "unavailable",
    accessReason: null,
    license: null,
    urls: { doi: null, landingPage: null, fullText: null },
    passages: [],
    errors: [],
  };
}

function candidate(record: ServiceRecord): SourceCandidate {
  return {
    title: record.work.title,
    doi: record.work.doi,
    year: record.work.year,
  };
}

/** Records that pass the identity check, one per DOI (or title when no DOI). */
function verified(
  reference: ReferenceEntry,
  records: ServiceRecord[],
): ServiceRecord[] {
  const seen = new Set<string>();
  return records.filter((record) => {
    if (!checkIdentity(reference, record.work, record).ok) return false;
    const key = record.work.doi ?? record.work.title.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function resolve(
  http: HttpClient,
  reference: ReferenceEntry,
  errors: ServiceError[],
): Promise<{ resolution: Resolution; record: ServiceRecord | null }> {
  const notes: string[] = [];

  // A PubMed ID printed in the reference is the most reliable identifier;
  // its record must still match the reference's title, year, and authors.
  const pmid = pmidFromReference(reference.text);
  if (pmid) {
    const byPmid = await pubmedRecord(http, pmid);
    if (byPmid.ok) {
      const identity = checkIdentity(
        reference,
        byPmid.value.work,
        byPmid.value,
      );
      if (identity.ok) {
        return {
          record: byPmid.value,
          resolution: {
            status: "resolved",
            reason: null,
            matchedBy: "pmid",
            resolver: "pubmed",
            candidates: [],
          },
        };
      }
      notes.push(
        `The PubMed ID ${pmid} in the reference belongs to a different work: ${identity.reason}`,
      );
    } else if (byPmid.notFound) {
      notes.push(
        `The PubMed ID ${pmid} in the reference was not found in PubMed.`,
      );
    } else {
      errors.push(byPmid.error);
    }
  }
  const doi = reference.metadata.doi
    ? normalizeDoi(reference.metadata.doi)
    : null;

  if (doi) {
    const byDoi = await crossrefByDoi(http, doi);
    if (byDoi.ok) {
      const identity = checkIdentity(reference, byDoi.value.work, byDoi.value);
      if (identity.ok) {
        return {
          record: byDoi.value,
          resolution: {
            status: "resolved",
            reason: null,
            matchedBy: "doi",
            resolver: "crossref",
            candidates: [],
          },
        };
      }
      notes.push(
        `The DOI ${doi} in the reference belongs to a different work: ${identity.reason}`,
      );
    } else if (byDoi.notFound) {
      notes.push(
        `The DOI ${doi} in the reference is not registered with Crossref.`,
      );
    } else {
      errors.push(byDoi.error);
    }
  }

  const query = reference.text.replace(/^\s*(?:\[\d{1,4}\]|\d{1,4}\.?)\s+/, "");
  let anySearchSucceeded = false;
  for (const [resolver, search] of [
    ["crossref", () => crossrefSearch(http, query)],
    ["openalex", () => openAlexSearch(http, reference.metadata.title ?? query)],
  ] as const) {
    if (http.deadlinePassed()) break;
    const found = await search();
    if (!found.ok) {
      if (!found.notFound) errors.push(found.error);
      continue;
    }
    anySearchSucceeded = true;
    let matches = verified(reference, found.value);
    let disambiguated = false;
    if (matches.length > 1) {
      // Same title, authors, and year (e.g. a statement published in two journals):
      // keep the one whose volume and first page are both given in the reference.
      const byPages = matches.filter((record) =>
        paginationMatches(reference, record),
      );
      if (byPages.length === 1) {
        matches = byPages;
        disambiguated = true;
      }
    }
    if (matches.length === 1 && matches[0]) {
      return {
        record: matches[0],
        resolution: {
          status: "resolved",
          reason:
            [
              ...notes,
              ...(notes.length > 0
                ? ["Resolved by bibliographic search instead."]
                : []),
              ...(disambiguated
                ? [
                    "Several records share this title, authors, and year; the volume and first page in the reference identify this one.",
                  ]
                : []),
            ].join(" ") || null,
          matchedBy: "bibliographic-search",
          resolver,
          candidates: [],
        },
      };
    }
    if (matches.length > 1) {
      return {
        record: null,
        resolution: {
          status: "ambiguous",
          reason: `${matches.length} ${resolver === "crossref" ? "Crossref" : "OpenAlex"} records match this reference's title, year, and first author; none was chosen.`,
          matchedBy: null,
          resolver,
          candidates: matches.map(candidate),
        },
      };
    }
  }

  if (!anySearchSucceeded && errors.length > 0) {
    return {
      record: null,
      resolution: {
        status: "error",
        reason: "Scholarly services could not be reached; see errors.",
        matchedBy: null,
        resolver: null,
        candidates: [],
      },
    };
  }
  return {
    record: null,
    resolution: {
      status: "unresolved",
      reason: [
        ...notes,
        http.deadlinePassed()
          ? "The time budget ran out before a match was confirmed."
          : "No Crossref or OpenAlex record matched this reference's title, year, and first author.",
      ].join(" "),
      matchedBy: null,
      resolver: null,
      candidates: [],
    },
  };
}

async function retrieveOne(
  http: HttpClient,
  reference: ReferenceEntry,
  claims: ExtractedClaim[],
): Promise<RetrievedSource> {
  const source = emptySource(
    reference,
    claims.map((claim) => claim.id),
  );
  const { resolution, record } = await resolve(http, reference, source.errors);
  source.resolution = resolution;
  if (!record) {
    source.accessReason = resolution.reason;
    return source;
  }

  const work = { ...record.work };
  source.work = work;
  source.license = record.license;
  source.urls = {
    doi: work.doi ? `https://doi.org/${work.doi}` : null,
    landingPage: record.landingPage,
    fullText: null,
  };

  let epmc: EuropePmcRecord | null = null;
  let epmcFailed = false;
  // PubMed (fast, exact abstracts) runs alongside Europe PMC, which is needed
  // for open-access status but is often slow; neither waits on the other.
  // Skipped when the record already came from PubMed with its abstract.
  const pubmedLookup =
    work.doi && !record.abstractParagraphs?.length
      ? pubmedAbstract(http, work.doi)
      : null;
  const lookup = await europePmcLookup(http, {
    doi: work.doi,
    pmid: work.pmid,
  });
  if (lookup.ok) {
    epmc = lookup.value;
    work.pmid = work.pmid ?? epmc.pmid;
    work.pmcid = work.pmcid ?? epmc.pmcid;
    source.license = epmc.license ?? source.license;
  } else if (!lookup.notFound) {
    epmcFailed = true;
    source.errors.push(lookup.error);
  }
  // Never describe an unreachable service as "not found".
  const noEpmcText = epmcFailed
    ? "Europe PMC could not be reached, so open-access full text could not be checked"
    : null;

  const texts: PassageSource[] = [];
  let fullTextNote: string | null = null;
  if (epmc?.isOpenAccess && epmc.pmcid) {
    const fullText = await europePmcFullText(http, epmc.pmcid);
    if (fullText.ok) {
      const paragraphs = jatsBodyParagraphs(fullText.value);
      if (paragraphs.length > 0) {
        source.urls.fullText = `https://europepmc.org/article/PMC/${epmc.pmcid}`;
        texts.push({
          origin: "full_text",
          paragraphs,
          sourceUrl: source.urls.fullText,
        });
      } else {
        fullTextNote =
          "The open-access full text had no readable body paragraphs.";
      }
    } else {
      if (!fullText.notFound) source.errors.push(fullText.error);
      // Same open-access article from PubMed Central itself.
      const fallback = await pmcFullText(http, epmc.pmcid);
      const paragraphs = fallback.ok ? jatsBodyParagraphs(fallback.value) : [];
      if (paragraphs.length > 0) {
        source.urls.fullText = `https://pmc.ncbi.nlm.nih.gov/articles/${epmc.pmcid}/`;
        texts.push({
          origin: "full_text",
          paragraphs,
          sourceUrl: source.urls.fullText,
        });
      } else {
        if (!fallback.ok && !fallback.notFound)
          source.errors.push(fallback.error);
        fullTextNote = fullText.notFound
          ? "Europe PMC lists the work as open access, but its full text was not found."
          : "The open-access full text could not be retrieved from Europe PMC or PubMed Central.";
      }
    }
  }

  // Abstract: the PubMed record itself, Europe PMC, PubMed by DOI (exact
  // text, DOI-checked), then Crossref.
  let abstractFrom: "Europe PMC" | "PubMed" | "Crossref" | null = null;
  if (record.abstractParagraphs?.length && work.pmid) {
    texts.push({
      origin: "abstract",
      paragraphs: record.abstractParagraphs,
      sourceUrl: `https://pubmed.ncbi.nlm.nih.gov/${work.pmid}/`,
    });
    abstractFrom = "PubMed";
  }
  if (!abstractFrom && epmc?.abstract) {
    const paragraphs = abstractParagraphs(epmc.abstract);
    const url = epmc.pmid
      ? `https://europepmc.org/article/MED/${epmc.pmid}`
      : (source.urls.landingPage ?? source.urls.doi);
    if (paragraphs.length > 0 && url) {
      texts.push({ origin: "abstract", paragraphs, sourceUrl: url });
      abstractFrom = "Europe PMC";
    }
  }
  const pubmed = pubmedLookup ? await pubmedLookup : null;
  if (!abstractFrom && pubmed) {
    if (pubmed.ok) {
      work.pmid = work.pmid ?? pubmed.value.pmid;
      texts.push({
        origin: "abstract",
        paragraphs: pubmed.value.paragraphs,
        sourceUrl: `https://pubmed.ncbi.nlm.nih.gov/${pubmed.value.pmid}/`,
      });
      abstractFrom = "PubMed";
    } else if (!pubmed.notFound) {
      source.errors.push(pubmed.error);
    }
  }
  if (!abstractFrom && record.abstract) {
    const paragraphs = abstractParagraphs(record.abstract);
    const url = source.urls.landingPage ?? source.urls.doi;
    if (paragraphs.length > 0 && url) {
      texts.push({ origin: "abstract", paragraphs, sourceUrl: url });
      abstractFrom = "Crossref";
    }
  }

  if (texts.some((text) => text.origin === "full_text")) {
    source.access = "full_text";
  } else if (texts.length > 0) {
    source.access = "abstract_only";
    source.accessReason =
      fullTextNote ??
      (noEpmcText
        ? `${noEpmcText}; the abstract comes from ${abstractFrom}.`
        : epmc
          ? abstractFrom === "Europe PMC"
            ? "The work is not in the Europe PMC open-access subset; only its abstract is available."
            : `The work is not in the Europe PMC open-access subset; only its abstract is available (from ${abstractFrom}).`
          : `The work was not found in Europe PMC; the abstract comes from ${abstractFrom}.`);
  } else {
    source.access = "metadata_only";
    source.accessReason =
      fullTextNote ??
      (noEpmcText
        ? `${noEpmcText}, and neither PubMed nor Crossref supplied an abstract.`
        : epmc
          ? "Neither Europe PMC nor PubMed has an abstract or open-access full text for this work."
          : "The work was not found in Europe PMC, and neither PubMed nor Crossref supplied an abstract.");
  }

  source.passages = claims.flatMap((claim) =>
    selectPassages(claim.id, claim.text, texts),
  );
  return source;
}

/** Claim ids per reference id, from matched citations inside extracted claims. */
export function citedReferences(input: EvidenceInput): Map<string, string[]> {
  const byReference = new Map<string, string[]>();
  for (const citation of input.citations) {
    if (!citation.claimId) continue;
    for (const match of citation.matches) {
      const referenceId =
        match.status === "matched" ? match.referenceIds[0] : undefined;
      if (!referenceId) continue;
      const claimIds = byReference.get(referenceId) ?? [];
      if (!claimIds.includes(citation.claimId)) claimIds.push(citation.claimId);
      byReference.set(referenceId, claimIds);
    }
  }
  return byReference;
}

export async function retrieveEvidence(
  input: EvidenceInput,
  options: RetrievalOptions = {},
): Promise<EvidenceResult> {
  const now = options.now ?? (() => new Date());
  const maxSources = options.maxSources ?? DEFAULT_MAX_SOURCES;
  const http = new HttpClient({
    ...options,
    deadline:
      options.deadline ??
      Date.now() + (options.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS),
  });

  const claimsById = new Map(input.claims.map((claim) => [claim.id, claim]));
  const cited = citedReferences(input);
  const targets = input.references.filter((reference) =>
    cited.has(reference.id),
  );

  const sources = await Promise.all(
    targets.map((reference, index) => {
      const claims = (cited.get(reference.id) ?? [])
        .map((id) => claimsById.get(id))
        .filter((claim): claim is ExtractedClaim => claim !== undefined);
      if (index >= maxSources) {
        const skipped = emptySource(
          reference,
          claims.map((claim) => claim.id),
        );
        skipped.resolution = {
          ...skipped.resolution,
          status: "skipped",
          reason: `Only the first ${maxSources} cited references are retrieved per request.`,
        };
        skipped.accessReason = skipped.resolution.reason;
        return Promise.resolve(skipped);
      }
      return retrieveOne(http, reference, claims);
    }),
  );

  return {
    sources,
    services: ["crossref", "openalex", "europepmc", "ncbi-pmc", "pubmed"],
    retrievedAt: now().toISOString(),
    method: EVIDENCE_METHOD,
    version: EVIDENCE_VERSION,
    truncated: targets.length > maxSources,
    claimStatus: "not_verified",
  };
}
