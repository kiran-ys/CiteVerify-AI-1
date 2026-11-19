function escapePdfText(text: string): string {
  return text.replace(/([\\()])/g, "\\$1");
}

export function createTextPdf(
  text = "CiteVerify extracted this real PDF text.",
): Uint8Array {
  const content = `BT\n/F1 16 Tf\n72 720 Td\n(${escapePdfText(text)}) Tj\nET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${new TextEncoder().encode(content).length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(new TextEncoder().encode(pdf).length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = new TextEncoder().encode(pdf).length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

export function createEmptyPdf(): Uint8Array {
  return createTextPdf("");
}

/**
 * Builds a multi-page PDF where each inner array is one page and each string
 * is one text line. Text must be ASCII (standard Helvetica encoding).
 */
export function createMultiPagePdf(pages: string[][]): Uint8Array {
  const pageCount = pages.length;
  // Objects: 1 catalog, 2 pages, 3 font, then (page, content) pairs.
  const pageObjectIds = pages.map((_, index) => 4 + index * 2);
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageCount} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  for (const [index, lines] of pages.entries()) {
    const body = lines
      .map((line, lineIndex) =>
        lineIndex === 0
          ? `(${escapePdfText(line)}) Tj`
          : `T* (${escapePdfText(line)}) Tj`,
      )
      .join("\n");
    const content = `BT\n/F1 10 Tf\n14 TL\n50 760 Td\n${body}\nET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`,
      `<< /Length ${new TextEncoder().encode(content).length} >>\nstream\n${content}\nendstream`,
    );
  }

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(new TextEncoder().encode(pdf).length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = new TextEncoder().encode(pdf).length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}
