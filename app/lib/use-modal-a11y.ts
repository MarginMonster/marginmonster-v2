import { useEffect, useRef } from "react";

/** Modal/lightbox accessibility, shared by every overlay (the Studio's forge,
 *  Manage, the done/queued state, the two tap-to-enlarge lightboxes). Returns a
 *  ref for the dialog container and wires up: Escape-to-close, initial focus
 *  moved INTO the dialog on open, focus RETURNED to the opener on close, and a
 *  Tab focus-trap that keeps keyboard focus inside while it's open. `active`
 *  gates it so a closed overlay costs nothing. */
export function useModalA11y<T extends HTMLElement>(active: boolean, onClose: () => void) {
  const ref = useRef<T | null>(null);
  const onCloseRef = useRef(onClose); onCloseRef.current = onClose;
  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    const opener = document.activeElement as HTMLElement | null;
    const focusable = () =>
      node
        ? Array.from(
            node.querySelectorAll<HTMLElement>(
              'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])',
            ),
          ).filter((el) => el.offsetParent !== null || el === document.activeElement)
        : [];
    // Initial focus lands inside — the first control, else the container itself.
    const first = focusable()[0];
    if (first) first.focus();
    else if (node) { node.setAttribute("tabindex", "-1"); node.focus(); }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onCloseRef.current(); return; }
      if (e.key !== "Tab" || !node) return;
      const items = focusable();
      if (items.length === 0) { e.preventDefault(); return; }
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      const activeEl = document.activeElement;
      if (e.shiftKey && (activeEl === firstEl || !node.contains(activeEl))) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && activeEl === lastEl) { e.preventDefault(); firstEl.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      // Return focus to whatever opened the overlay (if it's still around).
      if (opener && typeof opener.focus === "function" && document.contains(opener)) opener.focus();
    };
    // Only re-run on open/close — onClose is read through a ref so a new
    // identity never re-triggers focus handling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  return ref;
}
