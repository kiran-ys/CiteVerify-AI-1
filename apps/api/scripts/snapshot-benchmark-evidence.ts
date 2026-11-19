/**
 * Captures, for every externally cited claim in the evaluation papers, the
 * exact evidence passages the verifier would send to a model (no model is
 * called). The snapshot is the fixed input for the reasoning benchmark, so
 * model results can be compared without retrieval changing underneath.
 *
 *   bun run --cwd apps/api scripts/snapshot-benchmark-evidence.ts
 *
 * Needs the PDFs in tmp/ (git-ignored) and network access.
 */
import { extractCitations } from "@citeverify/citation-engine";
import { extractClaims } from "@citeverify/claim-extractor";
import { parsePdf } from "@citeverify/document-parser";
import { retrieveEvidence } from "@citeverify/evidence-retrieval";
import { verifyClaims } from "@citeverify/verification-engine";

const root = new URL("../../../", import.meta.url).pathname;
const papers = [
  { id: "PMC7065031", pdf: "tmp/realpaper/PMC7065031.pdf" },
  { id: "ioannidis-2005", pdf: "tmp/realpaper/ioannidis-2005-plosmed.pdf" },
];

const out: Record<string, unknown>[] = [];
for (const paper of papers) {
  const parsed = await parsePdf(await Bun.file(`${root}${paper.pdf}`).bytes());
  const markers = extractCitations(parsed.pages).inText.map((c) => ({
    page: c.page,
    ...c.location,
  }));
  const claims = extractClaims(parsed.pages, { citationSpans: markers }).claims;
  const citations = extractCitations(parsed.pages, claims);
  const evidence = await retrieveEvidence({
    references: citations.references,
    claims,
    citations: citations.inText,
  });
  const verification = await verifyClaims(
    {
      claims,
      citations: citations.inText,
      references: citations.references,
      sources: evidence.sources,
    },
    {
      // Never answers: only the selected evidence is captured.
      judge: async () => ({ ok: false, kind: "error", reason: "snapshot" }),
      modelName: "snapshot",
      timeBudgetMs: 600_000,
    },
  );
  const byRef = new Map(evidence.sources.map((s) => [s.referenceId, s]));
  const refs = new Map(citations.references.map((r) => [r.id, r]));
  for (const result of verification.results) {
    const claim = claims.find((c) => c.id === result.claimId);
    const refIds = [
      ...new Set(
        citations.inText
          .filter((c) => c.claimId === result.claimId)
          .flatMap((c) => c.matches.flatMap((m) => m.referenceIds)),
      ),
    ];
    out.push({
      paper: paper.id,
      claimId: result.claimId,
      page: claim?.page,
      claim: claim?.text.replace(/\s+/g, " ").trim(),
      references: refIds.map((id) => ({
        number: refs.get(id)?.number ?? null,
        title: byRef.get(id)?.work?.title ?? null,
        doi: byRef.get(id)?.work?.doi ?? null,
        access: byRef.get(id)?.access ?? "not looked up",
      })),
      passages: result.evidence.map((e) => ({
        id: e.evidenceId,
        referenceNumber: refs.get(e.referenceId)?.number ?? null,
        source: e.sourceTitle,
        doi: e.doi,
        url: e.sourceUrl,
        origin: e.origin,
        text: e.text,
      })),
    });
  }
}
const file = `${root}eval/benchmark/evidence-snapshot.json`;
await Bun.write(
  file,
  `${JSON.stringify({ capturedAt: new Date().toISOString(), cases: out }, null, 2)}\n`,
);
console.log(`Saved ${out.length} claims to ${file}`);
