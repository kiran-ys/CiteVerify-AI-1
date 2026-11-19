/**
 * Ctrl/⌘ K command palette. Searches the app's real destinations and the
 * uploaded paper's claims, references, and retrieved evidence. No results
 * are invented: with no paper, only destinations can match.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { PaperResult } from "./paper-session.ts";

export type PaletteTarget =
  | { kind: "page"; page: string }
  | { kind: "claim"; claimId: string };

export type PaletteItem = {
  id: string;
  group: "Go to" | "Claims" | "References" | "Evidence";
  label: string;
  detail: string;
  target: PaletteTarget;
};

const squash = (text: string) => text.replace(/\s+/g, " ").trim();

export function buildIndex(
  paper: PaperResult | undefined,
  pages: { id: string; label: string }[],
): PaletteItem[] {
  const items: PaletteItem[] = pages.map((p) => ({
    id: `page:${p.id}`,
    group: "Go to",
    label: p.label,
    detail: "Page",
    target: { kind: "page", page: p.id },
  }));
  if (!paper) return items;
  const claimFor = new Map<string, string>();
  for (const c of paper.citations.inText) {
    if (!c.claimId) continue;
    for (const m of c.matches)
      for (const ref of m.referenceIds)
        if (!claimFor.has(ref)) claimFor.set(ref, c.claimId);
  }
  for (const claim of paper.claims.items) {
    items.push({
      id: `claim:${claim.id}`,
      group: "Claims",
      label: squash(claim.text),
      detail: `${claim.id} · page ${claim.page}`,
      target: { kind: "claim", claimId: claim.id },
    });
  }
  for (const ref of paper.citations.references) {
    const claimId = claimFor.get(ref.id);
    items.push({
      id: `ref:${ref.id}`,
      group: "References",
      label: squash(ref.text),
      detail: ref.number != null ? `Reference ${ref.number}` : "Reference",
      target: claimId
        ? { kind: "claim", claimId }
        : { kind: "page", page: "quality" },
    });
  }
  if ("verification" in paper) {
    for (const result of paper.verification.results)
      for (const e of result.evidence)
        items.push({
          id: `ev:${result.claimId}:${e.evidenceId}`,
          group: "Evidence",
          label: squash(e.text),
          detail: `${e.sourceTitle ?? "Source"} · for ${result.claimId}`,
          target: { kind: "claim", claimId: result.claimId },
        });
  } else if ("evidence" in paper) {
    for (const s of paper.evidence.sources)
      for (const p of s.passages)
        items.push({
          id: `ev:${p.claimId}:${s.referenceId}:${p.location.paragraph}:${p.location.sentence}`,
          group: "Evidence",
          label: squash(p.text),
          detail: `${s.work?.title ?? "Source"} · for ${p.claimId}`,
          target: { kind: "claim", claimId: p.claimId },
        });
  }
  return items;
}

/** Items whose label or detail contains every word of the query. */
export function searchIndex(
  items: PaletteItem[],
  query: string,
  limit = 30,
): PaletteItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items.filter((i) => i.group === "Go to");
  return items
    .filter((i) => {
      const hay = `${i.label} ${i.detail}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    })
    .slice(0, limit);
}

export function CommandPalette({
  paper,
  pages,
  onSelect,
}: {
  paper: PaperResult | undefined;
  pages: { id: string; label: string }[];
  onSelect: (target: PaletteTarget) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<Element | null>(null);
  const index = useMemo(() => buildIndex(paper, pages), [paper, pages]);
  const results = useMemo(() => searchIndex(index, query), [index, query]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        opener.current = document.activeElement;
        setOpen((value) => !value);
      }
    };
    const onOpen = () => {
      opener.current = document.activeElement;
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("citeverify:open-palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("citeverify:open-palette", onOpen);
    };
  }, []);
  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      requestAnimationFrame(() => input.current?.focus());
    } else if (opener.current instanceof HTMLElement) opener.current.focus();
  }, [open]);

  if (!open) return null;
  const choose = (item: PaletteItem | undefined) => {
    if (!item) return;
    setOpen(false);
    onSelect(item.target);
  };
  return (
    <div className="palette-backdrop">
      <button
        type="button"
        className="palette-scrim"
        aria-label="Close search"
        onClick={() => setOpen(false)}
      />
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Search claims, references, evidence, and pages"
      >
        <input
          ref={input}
          aria-label="Search"
          aria-controls="palette-list"
          aria-activedescendant={results[active] ? `pal-${active}` : undefined}
          placeholder={
            paper
              ? "Search claims, references, evidence, pages…"
              : "Go to a page… (upload a paper to search its content)"
          }
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(results.length - 1, a + 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            }
            if (e.key === "Enter") choose(results[active]);
          }}
        />
        <ul id="palette-list" aria-label="Results">
          {results.length === 0 && (
            <li className="palette-empty">No matches in this paper.</li>
          )}
          {results.map((item, i) => (
            <li key={item.id}>
              <button
                type="button"
                id={`pal-${i}`}
                className={i === active ? "on" : ""}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(item)}
              >
                <small>{item.group}</small>
                <span>{item.label}</span>
                <em>{item.detail}</em>
              </button>
            </li>
          ))}
        </ul>
        <footer>↑ ↓ to move · Enter to open · Esc to close</footer>
      </div>
    </div>
  );
}
