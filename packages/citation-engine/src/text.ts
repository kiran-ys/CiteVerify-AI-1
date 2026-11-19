/** Small text helpers shared by reference and citation extraction. */

export type PageText = { page: number; text: string };
export type Line = { page: number; start: number; end: number; text: string };

export function collapse(text: string): string {
  return text
    .replace(/-\n\s*/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

export function splitLines(page: PageText): Line[] {
  const lines: Line[] = [];
  let start = 0;
  for (let index = 0; index <= page.text.length; index++) {
    if (index === page.text.length || page.text[index] === "\n") {
      lines.push({
        page: page.page,
        start,
        end: index,
        text: page.text.slice(start, index),
      });
      start = index + 1;
    }
  }
  return lines;
}

function repetitionKey(line: string): string {
  return line.trim().toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ");
}

const PAGE_NUMBER = /^(?:page\s*)?\d{1,4}(?:\s*(?:of|\/)\s*\d{1,4})?$/i;

/**
 * Returns a predicate for layout furniture: page numbers and lines repeated
 * on at least half the pages (running heads and footers).
 */
export function furnitureDetector(
  pages: PageText[],
): (line: string) => boolean {
  const repeated = new Set<string>();
  if (pages.length >= 3) {
    const counts = new Map<string, number>();
    for (const page of pages) {
      const keys = new Set(
        splitLines(page)
          .map((line) => repetitionKey(line.text))
          .filter((key) => key.length > 0 && key.length <= 160),
      );
      for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const threshold = Math.max(2, Math.ceil(pages.length / 2));
    for (const [key, count] of counts) {
      if (count >= threshold) repeated.add(key);
    }
  }
  return (line) => {
    const trimmed = line.trim();
    return PAGE_NUMBER.test(trimmed) || repeated.has(repetitionKey(trimmed));
  };
}

/** Case- and accent-insensitive form for comparing author names. */
export function foldName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’']/g, "'")
    .toLowerCase();
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
