import { useEffect, type RefObject } from 'react';

/**
 * Basic modal accessibility: move focus into the dialog when it opens, keep Tab inside it, close on Escape,
 * and restore focus to the trigger when it closes. The dialog element needs `tabIndex={-1}` so it can hold focus.
 */
export function useModalA11y(ref: RefObject<HTMLElement | null>, opts: { onEscape?: () => void; active: boolean }) {
  const { onEscape, active } = opts;

  // Focus into the dialog on open; restore focus to whatever had it when the dialog closes.
  useEffect(() => {
    if (!active) return;
    const node = ref.current; if (!node) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const first = node.querySelector<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])');
    (first ?? node).focus();
    return () => previouslyFocused?.focus?.();
  }, [ref, active]);

  // Escape closes; Tab wraps within the dialog. Re-registers when the close handler changes, without refocusing.
  useEffect(() => {
    if (!active) return;
    const node = ref.current; if (!node) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { if (onEscape) { e.preventDefault(); onEscape(); } return; }
      if (e.key !== 'Tab') return;
      const items = Array.from(node.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select, textarea, iframe, [tabindex]:not([tabindex="-1"])')).filter(el => el.offsetParent !== null);
      if (!items.length) { e.preventDefault(); node.focus(); return; }
      const firstEl = items[0], lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [ref, active, onEscape]);
}
