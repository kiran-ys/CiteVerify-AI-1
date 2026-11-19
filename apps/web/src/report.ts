/**
 * Paper report: the content is built only from the API results for the
 * uploaded paper, then written as a plain PDF without any dependency.
 * Nothing is inferred: steps that were not run say so.
 */
import type { ClaimVerification } from "@citeverify/shared";
import type { PaperResult } from "./paper-session.ts";

export type ReportLine = {
  text: string;
  style: "title" | "heading" | "body" | "muted" | "quote";
};

const line = (style: ReportLine["style"], text: string): ReportLine => ({
  style,
  text,
});

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

const squash = (text: string) => text.replace(/\s+/g, " ").trim();

/** First non-empty line of page 1; labelled as such because PDFs carry no reliable title. */
export function firstLine(result: PaperResult): string | null {
  const page = result.extraction.pages?.[0]?.text ?? result.extraction.text;
  const first = page
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 3);
  return first ? clip(first, 200) : null;
}

export function buildReport(
  result: PaperResult,
  generatedAt: Date,
): ReportLine[] {
  const out: ReportLine[] = [];
  const claims = result.claims.items;
  const { references, inText } = result.citations;
  const refById = new Map(references.map((r) => [r.id, r]));
  const verification =
    "verification" in result ? result.verification : undefined;
  const evidence = "evidence" in result ? result.evidence : undefined;
  const verdictOf = new Map<string, ClaimVerification>(
    (verification?.results ?? []).map((v) => [v.claimId, v]),
  );
  const refLabel = (id: string) => {
    const ref = refById.get(id);
    return ref?.number != null
      ? `[${ref.number}]`
      : (ref?.metadata.authors[0] ?? id);
  };

  out.push(line("title", "CiteVerify AI - Paper Report"));
  out.push(
    line(
      "muted",
      `Generated ${generatedAt.toISOString().replace("T", " ").slice(0, 16)} UTC from the uploaded paper. Claims and citations are found by rules; a matched citation links a claim to the paper's reference list and is not evidence that the source supports it.`,
    ),
  );

  out.push(line("heading", "Paper"));
  out.push(line("body", `File name: ${result.document.name}`));
  const title = firstLine(result);
  out.push(
    line("body", `Title (first line of the PDF text): ${title ?? "not found"}`),
  );
  out.push(
    line(
      "body",
      `Pages: ${result.document.pageCount} | Characters extracted: ${result.extraction.text.length.toLocaleString("en-US")} | Size: ${(result.document.sizeBytes / 1048576).toFixed(1)} MB | Parser: ${result.extraction.parser.name} ${result.extraction.parser.version}`,
    ),
  );
  out.push(
    line(
      "body",
      `Extraction summary: ${claims.length} candidate claims (${claims.filter((c) => c.type === "cited_claim").length} citing other work, ${claims.filter((c) => c.type === "reported_finding").length} the paper's own findings), ${inText.length} in-text citations, ${references.length} reference entries${result.extraction.warnings.length ? `, ${result.extraction.warnings.length} extraction warnings` : ""}.`,
    ),
  );

  out.push(line("heading", "AI verification status"));
  if (!verification) {
    out.push(
      line(
        "body",
        "Not verified. AI verification was not run for this paper, so no verdicts are reported.",
      ),
    );
  } else {
    const counts = new Map<string, number>();
    for (const r of verification.results)
      counts.set(r.verdict, (counts.get(r.verdict) ?? 0) + 1);
    out.push(
      line(
        "body",
        `Run ${verification.verifiedAt.slice(0, 16).replace("T", " ")} UTC with ${verification.model ? `${verification.model.name} (local Ollama, prompt ${verification.model.promptVersion})` : "no model available"}. Results: ${[...counts].map(([k, n]) => `${k} ${n}`).join(", ") || "none"}.`,
      ),
    );
    out.push(
      line(
        "muted",
        "Verdicts are model judgements on retrieved text and require human review; their accuracy has not been measured.",
      ),
    );
  }

  out.push(line("heading", `Claims and citations (${claims.length})`));
  for (const claim of claims) {
    const v = verdictOf.get(claim.id);
    const status = v
      ? `AI verdict: ${v.verdict}`
      : claim.type === "reported_finding"
        ? "Own finding (not checked against sources)"
        : "Not verified";
    out.push(line("body", `${claim.id} | page ${claim.page} | ${status}`));
    out.push(line("quote", squash(claim.text)));
    const cites = inText.filter((c) => c.claimId === claim.id);
    for (const c of cites) {
      const matched = c.matches
        .map((m) =>
          m.status === "matched"
            ? `${m.key} -> ${m.referenceIds.map(refLabel).join(", ")}`
            : `${m.key}: ${m.status}`,
        )
        .join("; ");
      out.push(
        line(
          "muted",
          `Citation "${squash(c.marker)}": ${matched || "no items"}`,
        ),
      );
    }
    if (v?.reason)
      out.push(line("muted", `Reason: ${clip(squash(v.reason), 400)}`));
    for (const e of v?.evidence.filter(
      (x) => x.relation === "supports" || x.relation === "contradicts",
    ) ?? []) {
      out.push(
        line(
          "muted",
          `Evidence ${e.evidenceId} (${e.relation}, ${e.sourceTitle ? clip(e.sourceTitle, 80) : refLabel(e.referenceId)}): "${squash(e.text)}" ${e.sourceUrl}`,
        ),
      );
    }
  }

  out.push(line("heading", "Citation matching"));
  const statuses = inText.flatMap((c) => c.matches.map((m) => m.status));
  const count = (s: string) => statuses.filter((x) => x === s).length;
  out.push(
    line(
      "body",
      `Reference list ${result.citations.referenceList.found ? `found on page ${result.citations.referenceList.page} (${result.citations.referenceList.style ?? "unknown"} style)` : "not found"}. Cited items: ${count("matched")} matched, ${count("unmatched")} unmatched, ${count("ambiguous")} ambiguous.`,
    ),
  );
  for (const ref of references) {
    out.push(
      line(
        "muted",
        `${ref.number != null ? `[${ref.number}] ` : ""}${clip(squash(ref.text), 300)}`,
      ),
    );
  }

  out.push(line("heading", "Retrieved evidence and sources"));
  if (!evidence) {
    out.push(line("body", "Source retrieval was not run for this paper."));
  } else {
    out.push(
      line(
        "muted",
        `Retrieved ${evidence.retrievedAt.slice(0, 16).replace("T", " ")} UTC from ${evidence.services.join(", ")}. Passages are exact source text selected by term overlap; they are not verdicts.`,
      ),
    );
    for (const s of evidence.sources) {
      const link = s.urls.doi ?? s.urls.landingPage ?? s.urls.fullText;
      out.push(
        line(
          "body",
          `${refLabel(s.referenceId)} ${s.work ? clip(s.work.title, 160) : "Not identified"} | ${s.resolution.status} | ${s.access.replace("_", " ")}`,
        ),
      );
      if (link) out.push(line("muted", link));
      if (!s.work && s.resolution.reason)
        out.push(line("muted", clip(s.resolution.reason, 300)));
      for (const p of s.passages)
        out.push(
          line("quote", `"${squash(p.text)}" (${p.origin.replace("_", " ")})`),
        );
    }
  }

  out.push(line("heading", "Internal consistency"));
  const ic = result.internalConsistency;
  out.push(line("muted", ic.disclaimer));
  if (ic.results.length === 0)
    out.push(line("body", "No findings with checkable values."));
  for (const r of ic.results) {
    out.push(line("body", `${r.claimId}: ${r.status.replace("_", " ")}`));
    for (const c of r.checks)
      out.push(line("muted", `${c.status.replace("_", " ")} - ${c.detail}`));
  }
  return out;
}

// ------------------------------------------------------------------ PDF writer

const PAGE = { w: 595, h: 842, margin: 50 };
const STYLE: Record<
  ReportLine["style"],
  { size: number; bold: boolean; gray: number; indent: number; before: number }
> = {
  title: { size: 17, bold: true, gray: 0, indent: 0, before: 0 },
  heading: { size: 12.5, bold: true, gray: 0, indent: 0, before: 12 },
  body: { size: 9.5, bold: false, gray: 0, indent: 0, before: 4 },
  quote: { size: 9, bold: false, gray: 0.15, indent: 12, before: 1 },
  muted: { size: 8, bold: false, gray: 0.4, indent: 12, before: 1 },
};

const WIN_ANSI: Record<string, number> = {
  "€": 0x80,
  "…": 0x85,
  "‘": 0x91,
  "’": 0x92,
  "“": 0x93,
  "”": 0x94,
  "•": 0x95,
  "–": 0x96,
  "—": 0x97,
  "™": 0x99,
  μ: 0xb5,
};
const ASCII: Record<string, string> = {
  "≤": "<=",
  "≥": ">=",
  "−": "-",
  "‐": "-",
  "‑": "-",
  "→": "->",
  "≈": "~",
};

/** Text in the PDF's WinAnsi encoding; characters it lacks become "?". */
export function toWinAnsi(text: string): string {
  let out = "";
  for (const ch of text.normalize("NFKC")) {
    const mapped = ASCII[ch];
    if (mapped) out += mapped;
    else if (WIN_ANSI[ch]) out += String.fromCharCode(WIN_ANSI[ch]);
    else {
      const code = ch.codePointAt(0) ?? 63;
      out +=
        code === 9
          ? " "
          : (code >= 32 && code < 127) || (code >= 160 && code < 256)
            ? ch
            : "?";
    }
  }
  return out;
}

function wrap(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (let word of text.split(" ")) {
    while (word.length > maxChars) {
      if (current) lines.push(current);
      lines.push(word.slice(0, maxChars));
      word = word.slice(maxChars);
      current = "";
    }
    if (!current) current = word;
    else if (current.length + 1 + word.length <= maxChars)
      current += ` ${word}`;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

const escapePdf = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);

/** Writes report lines as an A4 PDF (Helvetica, page numbers in the footer). */
export function renderPdf(lines: ReportLine[]): Uint8Array {
  const pages: string[][] = [[]];
  let y = PAGE.h - PAGE.margin;
  for (const item of lines) {
    const st = STYLE[item.style];
    const width = PAGE.w - 2 * PAGE.margin - st.indent;
    // Helvetica averages about 0.5 em per character; 0.53 leaves a margin.
    const wrapped = wrap(
      toWinAnsi(item.text),
      Math.floor(width / (st.size * 0.53)),
    );
    y -= st.before;
    for (const text of wrapped) {
      const lead = st.size * 1.3;
      if (y - lead < PAGE.margin + 20) {
        pages.push([]);
        y = PAGE.h - PAGE.margin;
      }
      y -= lead;
      pages[pages.length - 1]?.push(
        `BT /${st.bold ? "F2" : "F1"} ${st.size} Tf ${st.gray} g 1 0 0 1 ${PAGE.margin + st.indent} ${y.toFixed(1)} Tm (${escapePdf(text)}) Tj ET`,
      );
    }
  }

  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "", // pages, filled below
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  ];
  const kids: number[] = [];
  pages.forEach((ops, index) => {
    const footer = `BT /F1 7.5 Tf 0.45 g 1 0 0 1 ${PAGE.margin} 30 Tm (CiteVerify AI report - page ${index + 1} of ${pages.length}) Tj ET`;
    const stream = [...ops, footer].join("\n");
    objects.push(
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
    const contentId = objects.length;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.w} ${PAGE.h}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    kids.push(objects.length);
  });
  objects[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;

  // Every character is below 256, so string length equals byte length.
  let pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets)
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i);
  return bytes;
}

export function reportFileName(documentName: string): string {
  const base = documentName
    .replace(/\.pdf$/i, "")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${base || "paper"}-citeverify-report.pdf`;
}

/** Builds the report and starts a browser download. */
export function downloadReport(result: PaperResult): void {
  const bytes = renderPdf(buildReport(result, new Date()));
  const url = URL.createObjectURL(
    new Blob([bytes.buffer as ArrayBuffer], { type: "application/pdf" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = reportFileName(result.document.name);
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
