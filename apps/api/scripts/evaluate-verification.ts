/**
 * Evaluates retrieval and evidence-grounded verdicts against
 * eval/verification-dataset.json with the same steps as the API
 * (parse -> citations -> claims -> retrieval -> local model).
 *
 *   bun run eval:verification -- --claims 3   # first 3 labelled claims only
 *   bun run eval:verification                 # all labelled claims (slow)
 *
 *   bun run eval:verification -- --ids a,b --models llama3.2,qwen2.5:7b
 *
 * With --claims, only those claims' cited sources are retrieved and only
 * those claims are sent to the model. Needs the PDFs in tmp/ (git-ignored),
 * network access, and Ollama for verdicts. Timeouts and other failures are
 * reported apart from wrong verdicts.
 */
import { extractCitations } from "@citeverify/citation-engine";
import { extractClaims } from "@citeverify/claim-extractor";
import { parsePdf } from "@citeverify/document-parser";
import { retrieveEvidence } from "@citeverify/evidence-retrieval";
import type { ClaimVerification } from "@citeverify/shared";
import {
  DEFAULT_OLLAMA_HOST,
  DEFAULT_OLLAMA_MODEL,
  ollamaJudge,
  ollamaStatus,
  verifyClaims,
} from "@citeverify/verification-engine";

type Expected =
  | "Supported"
  | "Partially supported"
  | "Contradicted"
  | "Unable to verify";
type DatasetClaim = {
  id: string;
  claimStartsWith: string;
  references: number[];
  expected: Expected;
  certainty: "clear" | "borderline";
};
type Dataset = {
  labelStatus: string;
  papers: {
    id: string;
    pdf: string;
    references: { number: number; pmid?: string; doi?: string }[];
    claims: DatasetClaim[];
  }[];
};

const limitArg = process.argv.indexOf("--claims");
const limit = limitArg > 0 ? Number(process.argv[limitArg + 1]) : null;
const idsArg = process.argv.indexOf("--ids");
const ids =
  idsArg > 0 ? new Set((process.argv[idsArg + 1] ?? "").split(",")) : null;
const detailed = ids !== null;
const modelsArg = process.argv.indexOf("--models");
// --models a,b runs each model on the same retrieved evidence, one after another.
const models =
  modelsArg > 0
    ? (process.argv[modelsArg + 1] ?? "").split(",").filter(Boolean)
    : [process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL];
const root = new URL("../../../", import.meta.url).pathname;
const dataset = (await Bun.file(
  `${root}eval/verification-dataset.json`,
).json()) as Dataset;
const squash = (text: string) => text.replace(/\s+/g, " ").trim();
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const ollamaHost = {
  host: process.env.OLLAMA_HOST || DEFAULT_OLLAMA_HOST,
};

const report: Record<string, unknown>[] = [];
for (const paper of dataset.papers) {
  const file = Bun.file(`${root}${paper.pdf}`);
  if (!(await file.exists())) {
    console.log(`${paper.id}: skipped — ${paper.pdf} not found.`);
    continue;
  }
  const labelled = ids
    ? paper.claims.filter((claim) => ids.has(claim.id))
    : limit
      ? paper.claims.slice(0, limit)
      : paper.claims;
  if (labelled.length === 0) continue;
  const t0 = Date.now();

  const parsed = await parsePdf(await file.bytes());
  const markers = extractCitations(parsed.pages).inText.map((c) => ({
    page: c.page,
    ...c.location,
  }));
  const claims = extractClaims(parsed.pages, { citationSpans: markers }).claims;
  const citations = extractCitations(parsed.pages, claims);

  const selected = labelled.map((item) => ({
    item,
    claim: claims.find((c) =>
      squash(c.text).startsWith(squash(item.claimStartsWith)),
    ),
  }));
  const claimIds = new Set(
    selected.flatMap(({ claim }) => (claim ? [claim.id] : [])),
  );
  const chosenClaims = claims.filter((claim) => claimIds.has(claim.id));
  const chosenCitations = citations.inText.filter(
    (c) => c.claimId && claimIds.has(c.claimId),
  );
  const t1 = Date.now();

  const evidence = await retrieveEvidence({
    references: citations.references,
    claims: chosenClaims,
    citations: chosenCitations,
  });
  const t2 = Date.now();

  for (const model of models) {
    const ollama = { ...ollamaHost, model };
    const status = await ollamaStatus(ollama);
    const usable = status.available && status.modelInstalled;
    const perClaim = new Map<string, number>();
    const baseJudge = ollamaJudge(ollama);
    const timedJudge: typeof baseJudge = async (request) => {
      const started = Date.now();
      const answer = await baseJudge(request);
      const claimLine =
        /<claim>\n([\s\S]*?)\n<\/claim>/.exec(request.user)?.[1] ?? "";
      perClaim.set(squash(claimLine), Date.now() - started);
      return answer;
    };
    const verification = await verifyClaims(
      {
        claims: chosenClaims,
        citations: chosenCitations,
        references: citations.references,
        sources: evidence.sources,
      },
      {
        judge: usable ? timedJudge : null,
        modelName: usable ? ollama.model : null,
        unavailableReason: status.reason,
      },
    );
    const t3 = Date.now();

    // ---------------------------------------------------------------- retrieval
    const byNumber = new Map(citations.references.map((r) => [r.number, r]));
    const sources = new Map(evidence.sources.map((s) => [s.referenceId, s]));
    const cited = [...new Set(labelled.flatMap((c) => c.references))];
    const retrieval = cited.map((number) => {
      const gold = paper.references.find((r) => r.number === number);
      const ref = byNumber.get(number);
      const work = ref ? sources.get(ref.id)?.work : null;
      const correct =
        !!work &&
        !!gold &&
        ((gold.pmid !== undefined && work.pmid === gold.pmid) ||
          (gold.doi !== undefined && work.doi === gold.doi.toLowerCase()));
      return {
        number,
        correct,
        access: ref
          ? (sources.get(ref.id)?.access ?? "not looked up")
          : "not found",
      };
    });

    // ---------------------------------------------------------------- verdicts
    const rows = selected.map(({ item, claim }) => {
      const result: ClaimVerification | undefined = claim
        ? verification.results.find((r) => r.claimId === claim.id)
        : undefined;
      const predicted = result?.verdict ?? "claim not found";
      const failure =
        result?.unableCause &&
        result.unableCause !== "insufficient_evidence" &&
        result.unableCause !== "no_evidence"
          ? result.unableCause
          : null;
      return {
        expected: item.expected,
        predicted,
        certainty: item.certainty,
        outcome: failure
          ? `not judged (${failure})`
          : predicted === item.expected
            ? "correct"
            : "wrong",
        seconds: claim ? (perClaim.get(squash(claim.text)) ?? 0) / 1000 : 0,
        passages: result?.evidence.length ?? 0,
        claim: item.claimStartsWith.slice(0, 60),
        id: item.id,
        fullClaim: claim?.text ?? item.claimStartsWith,
        rationale:
          (item as DatasetClaim & { rationale?: string }).rationale ?? "",
        result,
      };
    });
    const judged = rows.filter(
      (r) => r.outcome === "correct" || r.outcome === "wrong",
    );
    const correct = rows.filter((r) => r.outcome === "correct").length;

    console.log(
      `\n=== ${paper.id}: ${rows.length} claim(s), model ${usable ? ollama.model : "unavailable"} ===`,
    );
    console.log(`Labels: ${dataset.labelStatus}`);
    console.log(
      `Time: total ${seconds(t3 - t0)} = parse/claims/citations ${seconds(t1 - t0)} + retrieval ${seconds(t2 - t1)} + model ${seconds(t3 - t2)}`,
    );
    console.log(
      `Retrieval: ${retrieval.filter((r) => r.correct).length}/${retrieval.length} cited references identified correctly; text accessible for ${retrieval.filter((r) => r.access === "abstract_only" || r.access === "full_text").length}/${retrieval.length}`,
    );
    if (!usable) console.log(`Verdicts not measured: ${status.reason}`);
    console.log(
      `Verdicts: ${correct}/${judged.length} correct among judged claims; ${rows.length - judged.length} not judged (timeouts or failures, counted separately)`,
    );
    for (const r of rows) {
      if (!detailed) {
        console.log(
          `  ${r.outcome.padEnd(26)} expected ${r.expected.padEnd(19)} got ${r.predicted.padEnd(19)} ${r.passages} passages, ${r.seconds.toFixed(1)} s  [${r.certainty}] ${r.claim}`,
        );
        continue;
      }
      console.log(`\n  --- ${r.id} (${r.outcome}) ---`);
      console.log(`  Claim: ${r.fullClaim}`);
      console.log(`  Evidence shown to the model (${r.passages} sentences):`);
      for (const e of r.result?.evidence ?? []) {
        console.log(
          `    ${e.evidenceId} [${e.relation}] ${e.sourceTitle?.slice(0, 50) ?? ""}: ${e.text}`,
        );
      }
      console.log(
        `  Expected: ${r.expected} (${r.certainty}) — ${r.rationale}`,
      );
      console.log(`  Actual:   ${r.predicted}`);
      if (r.result?.reason) console.log(`  Why:      ${r.result.reason}`);
      if (r.result?.explanation)
        console.log(`  Model:    ${r.result.explanation}`);
      console.log(`  Time:     ${r.seconds.toFixed(1)} s for the model call`);
    }
    report.push({
      detailedRows: detailed
        ? rows.map(({ result: _r, ...rest }) => rest)
        : undefined,
      paper: paper.id,
      limit,
      timingsMs: { prepare: t1 - t0, retrieval: t2 - t1, model: t3 - t2 },
      retrieval,
      rows,
      model,
    });
  }
}

const out = `${root}eval/results/latest.json`;
await Bun.write(
  out,
  `${JSON.stringify({ ranAt: new Date().toISOString(), labelStatus: dataset.labelStatus, report }, null, 2)}\n`,
);
console.log(`\nSaved: ${out}`);
