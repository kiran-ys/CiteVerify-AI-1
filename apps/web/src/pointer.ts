/**
 * Decorative pointer effects: a soft halo that eases toward the cursor and
 * grows over interactive elements, a gentle magnetic pull on `.magnetic`
 * buttons, and a spotlight on `.spotlight` surfaces. All motion runs in one
 * requestAnimationFrame loop writing transforms and CSS variables, so React
 * never re-renders. The native cursor is kept, the overlay never receives
 * pointer events, and nothing runs for touch/coarse pointers or reduced motion.
 */
const INTERACTIVE =
  "a, button, select, summary, [role='button'], label[for], .metric";
const TEXT_INPUT = "input, textarea, [contenteditable='true']";

export function pointerEffectsAllowed(): boolean {
  return (
    typeof matchMedia !== "undefined" &&
    matchMedia("(pointer: fine) and (hover: hover)").matches &&
    !matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function installPointerEffects(doc: Document = document): () => void {
  if (!pointerEffectsAllowed()) return () => {};
  const halo = doc.createElement("div");
  halo.className = "cursor-halo";
  halo.setAttribute("aria-hidden", "true");
  doc.body.append(halo);

  let targetX = -100;
  let targetY = -100;
  let x = targetX;
  let y = targetY;
  let frame = 0;
  let magnet: HTMLElement | null = null;
  let spot: HTMLElement | null = null;

  const tick = () => {
    // Eased interpolation: 22% of the remaining distance per frame.
    x += (targetX - x) * 0.22;
    y += (targetY - y) * 0.22;
    halo.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
    frame =
      Math.abs(targetX - x) + Math.abs(targetY - y) > 0.3
        ? requestAnimationFrame(tick)
        : 0;
  };

  const onMove = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    targetX = event.clientX;
    targetY = event.clientY;
    if (!frame) frame = requestAnimationFrame(tick);
    const target = event.target instanceof Element ? event.target : null;
    const overText = !!target?.closest(TEXT_INPUT);
    halo.classList.toggle("is-hidden", overText);
    halo.classList.toggle(
      "is-active",
      !overText && !!target?.closest(INTERACTIVE),
    );

    const nextMagnet = target?.closest<HTMLElement>(".magnetic") ?? null;
    if (magnet && magnet !== nextMagnet) {
      magnet.style.removeProperty("--mag-x");
      magnet.style.removeProperty("--mag-y");
    }
    magnet = nextMagnet;
    if (magnet) {
      const box = magnet.getBoundingClientRect();
      const dx = (event.clientX - (box.left + box.width / 2)) / box.width;
      const dy = (event.clientY - (box.top + box.height / 2)) / box.height;
      magnet.style.setProperty("--mag-x", `${(dx * 6).toFixed(1)}px`);
      magnet.style.setProperty("--mag-y", `${(dy * 4).toFixed(1)}px`);
    }

    spot = target?.closest<HTMLElement>(".spotlight") ?? null;
    if (spot) {
      const box = spot.getBoundingClientRect();
      spot.style.setProperty("--spot-x", `${event.clientX - box.left}px`);
      spot.style.setProperty("--spot-y", `${event.clientY - box.top}px`);
    }
  };
  const onLeave = () => {
    halo.classList.add("is-hidden");
    magnet?.style.removeProperty("--mag-x");
    magnet?.style.removeProperty("--mag-y");
  };
  const onEnter = () => halo.classList.remove("is-hidden");

  doc.addEventListener("pointermove", onMove, { passive: true });
  doc.documentElement.addEventListener("pointerleave", onLeave);
  doc.documentElement.addEventListener("pointerenter", onEnter);
  return () => {
    cancelAnimationFrame(frame);
    doc.removeEventListener("pointermove", onMove);
    doc.documentElement.removeEventListener("pointerleave", onLeave);
    doc.documentElement.removeEventListener("pointerenter", onEnter);
    halo.remove();
  };
}
