/**
 * Pure research-workflow logic built only on the API results the browser
 * holds: human review queue, saved-analysis history, JSON/Markdown exports,
 * source filtering, and the claim → reference → record → evidence → verdict
 * graph. Nothing here invents data, and human review never changes a verdict.
 */
import type {
  ClaimVerification,
  RetrievedSource,
  VerificationVerdict,
} from "@citeverify/shared";
import type { PaperResult } from "./paper-session.ts";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const squash = (text: string) => text.replace(/\s+/g, " ").trim();

/** Stable key for one paper's results (name + size + extracted length). */
export function paperKey(paper: PaperResult): string {
  return `${paper.document.name}|${paper.document.sizeBytes}|${paper.extraction.text.length}`;
}

const verificationOf = (paper: PaperResult) =>
  "verification" in paper ? paper.verification : undefined;
const evidenceOf = (paper: PaperResult) =>
  "evidence" in paper ? paper.evidence : undefined;

// ------------------------------------------------------------------ review queue

export type ReviewReason =
  | "contradicted"
  | "partially_supported"
  | "model_failure"
  | "unable_to_verify"
  | "missing_evidence"
  | "citation_problem"
  | "not_verified";

export const REASON_LABEL: Record<ReviewReason, string> = {
  contradicted: "Contradicted by a cited passage",
  partially_supported: "Only partly supported",
  model_failure: "AI model failed or answer was invalid",
  unable_to_verify: "Evidence did not settle the claim",
  missing_evidence: "No evidence passage retrieved",
  citation_problem: "Unmatched or ambiguous citation",
  not_verified: "Not yet verified",
};
const PRIORITY: ReviewReason[] = [
  "contradicted",
  "partially_supported",
  "model_failure",
  "unable_to_verify",
  "missing_evidence",
  "citation_problem",
  "not_verified",
];

export type ReviewStatus = "unreviewed" | "reviewed" | "follow_up";
export type ReviewState = Record<
  string,
  { status: ReviewStatus; note: string }
>;

export type QueueItem = {
  claimId: string;
  page: number;
  text: string;
  reason: ReviewReason;
  priority: number;
  verdict: VerificationVerdict | null;
};

/** Claims that need a human look, most urgent first. Supported claims are left out. */
export function reviewQueue(paper: PaperResult): QueueItem[] {
  const verdicts = new Map(
    (verificationOf(paper)?.results ?? []).map((r) => [r.claimId, r]),
  );
  const items: QueueItem[] = [];
  for (const claim of paper.claims.items) {
    const cites = paper.citations.inText.filter((c) => c.claimId === claim.id);
    if (cites.length === 0) continue; // own findings: covered by internal consistency
    const v = verdicts.get(claim.id);
    const badCitation = cites.some((c) =>
      c.matches.some((m) => m.status !== "matched"),
    );
    let reason: ReviewReason | null;
    if (!v) reason = badCitation ? "citation_problem" : "not_verified";
    else if (v.verdict === "Contradicted") reason = "contradicted";
    else if (v.verdict === "Partially supported")
      reason = "partially_supported";
    else if (v.verdict === "Unable to verify")
      reason =
        v.unableCause &&
        [
          "model_unavailable",
          "model_error",
          "model_timeout",
          "invalid_output",
          "time_budget",
        ].includes(v.unableCause)
          ? "model_failure"
          : v.unableCause === "no_evidence"
            ? "missing_evidence"
            : "unable_to_verify";
    else reason = badCitation ? "citation_problem" : null;
    if (!reason) continue;
    items.push({
      claimId: claim.id,
      page: claim.page,
      text: squash(claim.text),
      reason,
      priority: PRIORITY.indexOf(reason),
      verdict: v?.verdict ?? null,
    });
  }
  return items.sort((a, b) => a.priority - b.priority || a.page - b.page);
}

const REVIEW_PREFIX = "citeverify.review.";

export function loadReviews(
  storage: StorageLike | undefined,
  key: string,
): ReviewState {
  try {
    const raw = storage?.getItem(REVIEW_PREFIX + key);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return typeof parsed === "object" && parsed !== null
      ? (parsed as ReviewState)
      : {};
  } catch {
    return {};
  }
}

export function saveReviews(
  storage: StorageLike | undefined,
  key: string,
  state: ReviewState,
): boolean {
  try {
    storage?.setItem(REVIEW_PREFIX + key, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ history

export type HistoryEntry = {
  key: string;
  name: string;
  title: string | null;
  savedAt: string;
  status: "extracted" | "sources retrieved" | "verified";
  claims: number;
  cited: number;
  verified: number;
  /** The PDF itself is never stored, so the analysis cannot be rerun from history. */
  pdfStored: false;
};
type HistoryRecord = HistoryEntry & { result: PaperResult };
const HISTORY_KEY = "citeverify.history.v1";
export const HISTORY_LIMIT = 8;

function readHistory(storage: StorageLike | undefined): HistoryRecord[] {
  try {
    const raw = storage?.getItem(HISTORY_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as HistoryRecord[]) : [];
  } catch {
    return [];
  }
}

export function listHistory(storage: StorageLike | undefined): HistoryEntry[] {
  return readHistory(storage).map(({ result: _r, ...entry }) => entry);
}

export function loadFromHistory(
  storage: StorageLike | undefined,
  key: string,
): PaperResult | undefined {
  return readHistory(storage).find((r) => r.key === key)?.result;
}

/**
 * Saves (or updates) an analysis. When storage is full, the oldest entries
 * are dropped one by one; returns false if it still cannot be saved.
 */
export function saveToHistory(
  storage: StorageLike | undefined,
  paper: PaperResult,
  now: Date,
  title: string | null,
): boolean {
  const key = paperKey(paper);
  const v = verificationOf(paper);
  const record: HistoryRecord = {
    key,
    name: paper.document.name,
    title,
    savedAt: now.toISOString(),
    status: v
      ? "verified"
      : evidenceOf(paper)
        ? "sources retrieved"
        : "extracted",
    claims: paper.claims.items.length,
    cited: new Set(
      paper.citations.inText.flatMap((c) => (c.claimId ? [c.claimId] : [])),
    ).size,
    verified: v?.results.length ?? 0,
    pdfStored: false,
    result: paper,
  };
  let records = [
    record,
    ...readHistory(storage).filter((r) => r.key !== key),
  ].slice(0, HISTORY_LIMIT);
  while (records.length > 0) {
    try {
      storage?.setItem(HISTORY_KEY, JSON.stringify(records));
      return true;
    } catch {
      if (records.length === 1) return false;
      records = records.slice(0, -1);
    }
  }
  return false;
}

export function removeFromHistory(
  storage: StorageLike | undefined,
  key: string,
): void {
  try {
    storage?.setItem(
      HISTORY_KEY,
      JSON.stringify(readHistory(storage).filter((r) => r.key !== key)),
    );
    storage?.removeItem(REVIEW_PREFIX + key);
  } catch {
    // Storage blocked: nothing to remove.
  }
}

// ------------------------------------------------------------------ sources

export type SourceFilter = {
  query: string;
  resolution: "all" | "resolved" | "unresolved";
  access:
    | "all"
    | "full_text"
    | "abstract_only"
    | "metadata_only"
    | "unavailable";
};

export function filterSources(
  paper: PaperResult,
  filter: SourceFilter,
): { source: RetrievedSource; number: number | null; reference: string }[] {
  const evidence = evidenceOf(paper);
  if (!evidence) return [];
  const refs = new Map(paper.citations.references.map((r) => [r.id, r]));
  const q = filter.query.trim().toLowerCase();
  return evidence.sources
    .map((source) => {
      const ref = refs.get(source.referenceId);
      return {
        source,
        number: ref?.number ?? null,
        reference: squash(ref?.text ?? ""),
      };
    })
    .filter(({ source, number, reference }) => {
      const resolved = source.resolution.status === "resolved";
      if (filter.resolution === "resolved" && !resolved) return false;
      if (filter.resolution === "unresolved" && resolved) return false;
      if (filter.access !== "all" && source.access !== filter.access)
        return false;
      if (!q) return true;
      const hay = [
        reference,
        source.work?.title ?? "",
        ...(source.work?.authors ?? []),
        source.work?.doi ?? "",
        source.work?.pmid ?? "",
        number !== null ? `ref ${number} [${number}] reference ${number}` : "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    })
    .sort((a, b) => (a.number ?? 1e9) - (b.number ?? 1e9));
}

// ------------------------------------------------------------------ graph

export type GraphReference = {
  referenceId: string;
  number: number | null;
  match: "matched" | "unmatched" | "ambiguous";
  record: "resolved" | "not identified" | "not looked up";
  access: RetrievedSource["access"] | "not looked up";
  passages: number;
};
export type GraphRow = {
  claimId: string;
  page: number;
  text: string;
  markers: string[];
  references: GraphReference[];
  unmatchedMarkers: string[];
  verdict: ClaimVerification | null;
  /** Passages the verdict cites as supporting or contradicting. */
  citedEvidence: number;
};

/** One row per claim that cites anything: the chain from claim to verdict. */
export function citationGraph(paper: PaperResult): GraphRow[] {
  const sources = new Map(
    (evidenceOf(paper)?.sources ?? []).map((s) => [s.referenceId, s]),
  );
  const verdicts = new Map(
    (verificationOf(paper)?.results ?? []).map((r) => [r.claimId, r]),
  );
  return paper.claims.items.flatMap((claim) => {
    const cites = paper.citations.inText.filter((c) => c.claimId === claim.id);
    if (cites.length === 0) return [];
    const byRef = new Map<string, GraphReference>();
    const unmatchedMarkers: string[] = [];
    for (const c of cites)
      for (const m of c.matches) {
        if (m.status !== "matched") {
          unmatchedMarkers.push(`${m.key} (${m.status})`);
          continue;
        }
        for (const id of m.referenceIds) {
          const s = sources.get(id);
          byRef.set(id, {
            referenceId: id,
            number:
              paper.citations.references.find((r) => r.id === id)?.number ??
              null,
            match: "matched",
            record: !s
              ? "not looked up"
              : s.resolution.status === "resolved"
                ? "resolved"
                : "not identified",
            access: s?.access ?? "not looked up",
            passages: s
              ? s.passages.filter((p) => p.claimId === claim.id).length
              : 0,
          });
        }
      }
    const verdict = verdicts.get(claim.id) ?? null;
    return [
      {
        claimId: claim.id,
        page: claim.page,
        text: squash(claim.text),
        markers: cites.map((c) => squash(c.marker)),
        references: [...byRef.values()],
        unmatchedMarkers,
        verdict,
        citedEvidence:
          verdict?.evidence.filter(
            (e) => e.relation === "supports" || e.relation === "contradicts",
          ).length ?? 0,
      },
    ];
  });
}

// ------------------------------------------------------------------ exports

const LIMITATIONS = [
  "Automated verification is not a substitute for expert review.",
  "A citation match links a claim to the paper's reference list; it is not evidence that the source supports the claim.",
  "Retrieved metadata is not evidence text; only quoted passages are evidence.",
  "AI explanations are generated text, not evidence. Verdicts must be checked against the quoted passages.",
  "Unable to verify means the available evidence could not settle the claim, not that the claim is false.",
  "Internal-consistency checks compare the paper with itself and are not external validation.",
  "Accuracy has not been measured against independently reviewed labels; no confidence score is reported.",
];

export function exportJson(
  paper: PaperResult,
  reviews: ReviewState,
  now: Date,
) {
  const v = verificationOf(paper);
  const e = evidenceOf(paper);
  return {
    format: "citeverify-report",
    version: 1,
    exportedAt: now.toISOString(),
    paper: {
      fileName: paper.document.name,
      pages: paper.document.pageCount,
      sizeBytes: paper.document.sizeBytes,
      charactersExtracted: paper.extraction.text.length,
      parser: paper.extraction.parser,
    },
    statistics: {
      claims: paper.claims.items.length,
      inTextCitations: paper.citations.inText.length,
      references: paper.citations.references.length,
      sourcesLookedUp: e?.sources.length ?? null,
      sourcesResolved: e
        ? e.sources.filter((s) => s.resolution.status === "resolved").length
        : null,
    },
    retrieval: e
      ? {
          retrievedAt: e.retrievedAt,
          services: e.services,
          truncated: e.truncated,
        }
      : { status: "not performed" },
    verification: v
      ? {
          verifiedAt: v.verifiedAt,
          model: v.model,
          modelAvailable: v.modelAvailable,
          truncated: v.truncated,
          reviewStatus: v.reviewStatus,
        }
      : { status: "AI verification not performed" },
    claims: citationGraph(paper).map((row) => ({
      id: row.claimId,
      page: row.page,
      text: row.text,
      citationMarkers: row.markers,
      unmatchedCitations: row.unmatchedMarkers,
      references: row.references.map((r) => {
        const ref = paper.citations.references.find(
          (x) => x.id === r.referenceId,
        );
        const s = e?.sources.find((x) => x.referenceId === r.referenceId);
        return {
          number: r.number,
          text: squash(ref?.text ?? ""),
          record: s?.work ?? null,
          access: r.access,
          links: s?.urls ?? null,
        };
      }),
      verdict: row.verdict?.verdict ?? "Not verified",
      unableCause: row.verdict?.unableCause ?? null,
      reason: row.verdict?.reason ?? null,
      explanation: row.verdict?.explanation ?? null,
      explanationIsEvidence: false,
      evidence: (row.verdict?.evidence ?? []).map((ev) => ({
        id: ev.evidenceId,
        relation: ev.relation,
        text: ev.text,
        source: ev.sourceTitle,
        doi: ev.doi,
        url: ev.sourceUrl,
        origin: ev.origin,
        location: ev.location,
      })),
      humanReview: reviews[row.claimId] ?? { status: "unreviewed", note: "" },
    })),
    internalConsistency: paper.internalConsistency,
    limitations: LIMITATIONS,
  };
}

export function exportMarkdown(
  paper: PaperResult,
  reviews: ReviewState,
  now: Date,
): string {
  const data = exportJson(paper, reviews, now);
  const v = verificationOf(paper);
  const lines: string[] = [
    `# CiteVerify AI report — ${paper.document.name}`,
    "",
    `Exported ${now.toISOString().replace("T", " ").slice(0, 16)} UTC. Pages: ${paper.document.pageCount}. Claims: ${data.statistics.claims}. In-text citations: ${data.statistics.inTextCitations}. References: ${data.statistics.references}.`,
    "",
    "## Status",
    "",
    `- Source retrieval: ${evidenceOf(paper) ? `${data.statistics.sourcesResolved} of ${data.statistics.sourcesLookedUp} cited works identified` : "not performed"}`,
    `- AI verification: ${v ? `${v.model ? `${v.model.name} via ${v.model.provider}` : "no model"}, ${v.verifiedAt.slice(0, 16).replace("T", " ")} UTC` : "AI verification not performed"}`,
    "",
    "## Claims",
    "",
  ];
  for (const claim of data.claims) {
    const review = claim.humanReview;
    lines.push(
      `### ${claim.id} (page ${claim.page}) — ${claim.verdict}`,
      "",
      `> ${claim.text}`,
      "",
    );
    if (claim.unmatchedCitations.length)
      lines.push(
        `- Unmatched citations: ${claim.unmatchedCitations.join(", ")}`,
      );
    for (const r of claim.references)
      lines.push(
        `- Reference ${r.number ?? "?"}: ${r.record?.title ?? "not identified"} (${String(r.access).replace("_", " ")})${r.links?.doi ? ` — ${r.links.doi}` : ""}`,
      );
    if (claim.reason) lines.push(`- Reason: ${squash(claim.reason)}`);
    if (claim.explanation)
      lines.push(
        `- AI explanation (generated text, not evidence): ${squash(claim.explanation)}`,
      );
    for (const ev of claim.evidence.filter(
      (x) => x.relation === "supports" || x.relation === "contradicts",
    ))
      lines.push(
        `- Evidence ${ev.id} (${ev.relation}, ${ev.origin.replace("_", " ")}): "${squash(ev.text)}" — ${ev.source ?? "source"} ${ev.url}`,
      );
    lines.push(
      `- Human review: ${review.status.replace("_", " ")}${review.note ? ` — ${squash(review.note)}` : ""}`,
      "",
    );
  }
  lines.push("## Limitations", "", ...LIMITATIONS.map((l) => `- ${l}`), "");
  return lines.join("\n");
}

export function downloadText(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
