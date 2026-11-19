/**
 * Thin adapters for Crossref, OpenAlex, and Europe PMC. Each maps a service
 * response to plain records and never fills in missing fields.
 */
import type { ResolvedWork, ServiceError } from "@citeverify/shared";
import type { HttpClient } from "./http.ts";
import { normalizeDoi } from "./identity.ts";

export type ServiceRecord = {
  work: ResolvedWork;
  /** Abstract as supplied by the service (may contain markup). */
  abstract: string | null;
  license: string | null;
  landingPage: string | null;
  /** Volume and first page as the service records them, for telling reprints apart. */
  volume: string | null;
  firstPage: string | null;
};

export type Lookup<T> =
  | { ok: true; value: T }
  | { ok: false; notFound: true }
  | { ok: false; notFound: false; error: ServiceError };

type Json = Record<string, unknown>;

function isJson(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function first(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : undefined;
}

function invalid(
  service: ServiceError["service"],
  message: string,
): Lookup<never> {
  return {
    ok: false,
    notFound: false,
    error: { service, kind: "invalid_response", message },
  };
}

// ---------------------------------------------------------------- Crossref

function crossrefYear(item: Json): string | null {
  for (const key of [
    "issued",
    "published-print",
    "published-online",
    "published",
  ]) {
    const parts = isJson(item[key])
      ? first((item[key] as Json)["date-parts"])
      : undefined;
    const year = Array.isArray(parts) ? parts[0] : undefined;
    if (typeof year === "number") return String(year);
  }
  return null;
}

export function crossrefRecord(item: Json): ServiceRecord | null {
  const title = str(first(item.title));
  if (!title) return null;
  const authors = Array.isArray(item.author)
    ? item.author
        .filter(isJson)
        .map(
          (author) =>
            str(author.name) ??
            [str(author.given), str(author.family)].filter(Boolean).join(" "),
        )
        .filter((name): name is string => Boolean(name))
    : [];
  // Only the licence for the published version (VOR). Crossref also lists
  // text-and-data-mining (tdm) and accepted-manuscript licences, which say
  // nothing about whether a reader may access the article.
  const license = Array.isArray(item.license)
    ? (item.license
        .filter(isJson)
        .filter((entry) => entry["content-version"] === "vor")
        .map((entry) => str(entry.URL))
        .find(Boolean) ?? null)
    : null;
  const doi = str(item.DOI);
  return {
    work: {
      title,
      authors,
      year: crossrefYear(item),
      doi: doi ? normalizeDoi(doi) : null,
      journal: str(first(item["container-title"])),
      pmid: null,
      pmcid: null,
      openAlexId: null,
    },
    abstract: str(item.abstract),
    license,
    landingPage: doi ? `https://doi.org/${doi}` : str(item.URL),
    volume: str(item.volume),
    firstPage:
      str(item.page)
        ?.split(/[-\u2013]/)[0]
        ?.trim() || null,
  };
}

export async function crossrefByDoi(
  http: HttpClient,
  doi: string,
): Promise<Lookup<ServiceRecord>> {
  const url = http.withContact(
    new URL(`https://api.crossref.org/works/${encodeURIComponent(doi)}`),
    "crossref",
  );
  const result = await http.getJson(url.toString(), "crossref");
  if (!result.ok) {
    return result.status === 404
      ? { ok: false, notFound: true }
      : { ok: false, notFound: false, error: result.error };
  }
  const message = isJson(result.data) ? result.data.message : undefined;
  const record = isJson(message) ? crossrefRecord(message) : null;
  return record
    ? { ok: true, value: record }
    : invalid("crossref", "Crossref record had no title");
}

export async function crossrefSearch(
  http: HttpClient,
  query: string,
): Promise<Lookup<ServiceRecord[]>> {
  const url = http.withContact(
    new URL("https://api.crossref.org/works"),
    "crossref",
  );
  url.searchParams.set("query.bibliographic", query.slice(0, 600));
  url.searchParams.set("rows", "5");
  url.searchParams.set(
    "select",
    "DOI,title,author,issued,container-title,abstract,license,URL,volume,page",
  );
  const result = await http.getJson(url.toString(), "crossref");
  if (!result.ok) return { ok: false, notFound: false, error: result.error };
  const message = isJson(result.data) ? result.data.message : undefined;
  const items =
    isJson(message) && Array.isArray(message.items) ? message.items : null;
  if (!items)
    return invalid("crossref", "Crossref search response had no items list");
  return {
    ok: true,
    value: items
      .filter(isJson)
      .map(crossrefRecord)
      .filter((r): r is ServiceRecord => r !== null),
  };
}

// ---------------------------------------------------------------- OpenAlex

function idTail(value: unknown): string | null {
  const text = str(value);
  return text ? (text.split("/").at(-1) ?? null) : null;
}

export function openAlexRecord(item: Json): ServiceRecord | null {
  const title = str(item.title) ?? str(item.display_name);
  if (!title) return null;
  const ids = isJson(item.ids) ? item.ids : {};
  const pmcTail = idTail(ids.pmcid);
  const doi = str(item.doi);
  const primary = isJson(item.primary_location) ? item.primary_location : {};
  const source = isJson(primary.source) ? primary.source : {};
  return {
    work: {
      title,
      authors: Array.isArray(item.authorships)
        ? item.authorships
            .filter(isJson)
            .map((authorship) =>
              isJson(authorship.author)
                ? str(authorship.author.display_name)
                : null,
            )
            .filter((name): name is string => Boolean(name))
        : [],
      year:
        typeof item.publication_year === "number"
          ? String(item.publication_year)
          : null,
      doi: doi ? normalizeDoi(doi) : null,
      journal: str(source.display_name),
      pmid: idTail(ids.pmid),
      pmcid: pmcTail
        ? pmcTail.startsWith("PMC")
          ? pmcTail
          : `PMC${pmcTail}`
        : null,
      openAlexId: idTail(item.id),
    },
    // OpenAlex abstracts are inverted indexes; rebuilding them would not preserve exact wording.
    abstract: null,
    license: str(primary.license),
    landingPage: str(primary.landing_page_url) ?? (doi ? doi : null),
    volume: isJson(item.biblio) ? str(item.biblio.volume) : null,
    firstPage: isJson(item.biblio) ? str(item.biblio.first_page) : null,
  };
}

export async function openAlexSearch(
  http: HttpClient,
  query: string,
): Promise<Lookup<ServiceRecord[]>> {
  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("search", query.slice(0, 300));
  url.searchParams.set("per-page", "5");
  const result = await http.getJson(url.toString(), "openalex");
  if (!result.ok) return { ok: false, notFound: false, error: result.error };
  const results =
    isJson(result.data) && Array.isArray(result.data.results)
      ? result.data.results
      : null;
  if (!results)
    return invalid("openalex", "OpenAlex search response had no results list");
  return {
    ok: true,
    value: results
      .filter(isJson)
      .map(openAlexRecord)
      .filter((r): r is ServiceRecord => r !== null),
  };
}

// ---------------------------------------------------------------- Europe PMC

export type EuropePmcRecord = {
  pmid: string | null;
  pmcid: string | null;
  doi: string | null;
  isOpenAccess: boolean;
  inEpmc: boolean;
  abstract: string | null;
  license: string | null;
};

export async function europePmcLookup(
  http: HttpClient,
  ids: { doi: string | null; pmid: string | null },
): Promise<Lookup<EuropePmcRecord>> {
  const query = ids.doi
    ? `DOI:"${ids.doi}"`
    : ids.pmid
      ? `EXT_ID:${ids.pmid} AND SRC:MED`
      : null;
  if (!query) return { ok: false, notFound: true };
  const url = new URL(
    "https://www.ebi.ac.uk/europepmc/webservices/rest/search",
  );
  url.searchParams.set("query", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("resultType", "core");
  url.searchParams.set("pageSize", "5");
  const result = await http.getJson(url.toString(), "europepmc");
  if (!result.ok) return { ok: false, notFound: false, error: result.error };
  const list =
    isJson(result.data) && isJson(result.data.resultList)
      ? result.data.resultList.result
      : null;
  if (!Array.isArray(list))
    return invalid("europepmc", "Europe PMC response had no result list");

  const records = list.filter(isJson);
  const match = ids.doi
    ? records.find((record) => normalizeDoi(str(record.doi) ?? "") === ids.doi)
    : records.find((record) => str(record.pmid) === ids.pmid);
  if (!match) return { ok: false, notFound: true };
  return {
    ok: true,
    value: {
      pmid: str(match.pmid),
      pmcid: str(match.pmcid),
      doi: str(match.doi),
      isOpenAccess: match.isOpenAccess === "Y",
      inEpmc: match.inEPMC === "Y",
      abstract: str(match.abstractText),
      license: str(match.license),
    },
  };
}

export async function europePmcFullText(
  http: HttpClient,
  pmcid: string,
): Promise<Lookup<string>> {
  const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/${encodeURIComponent(pmcid)}/fullTextXML`;
  const result = await http.get(url, "europepmc", "application/xml");
  if (!result.ok) {
    return result.status === 404
      ? { ok: false, notFound: true }
      : { ok: false, notFound: false, error: result.error };
  }
  return result.body.includes("<article")
    ? { ok: true, value: result.body }
    : invalid("europepmc", "Full-text response was not a JATS article");
}

// ---------------------------------------------------------------- PubMed Central (NCBI)

/**
 * Open-access JATS full text from PubMed Central via NCBI E-utilities. Only
 * called for works Europe PMC already lists as open access.
 */
export async function pmcFullText(
  http: HttpClient,
  pmcid: string,
): Promise<Lookup<string>> {
  const url = new URL(
    "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi",
  );
  url.searchParams.set("db", "pmc");
  url.searchParams.set("id", pmcid.replace(/^PMC/i, ""));
  url.searchParams.set("rettype", "xml");
  url.searchParams.set("tool", "citeverify");
  const result = await http.get(
    http.withContact(url, "ncbi-pmc").toString(),
    "ncbi-pmc",
    "application/xml",
  );
  if (!result.ok) return { ok: false, notFound: false, error: result.error };
  return /<article\b/.test(result.body) && /<body\b/.test(result.body)
    ? { ok: true, value: result.body }
    : { ok: false, notFound: true };
}
