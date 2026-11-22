import { useLayoutEffect, useRef } from 'react';

/** Fit the row viewport between the page controls and the fixed application footer. */
export function useTableViewport(enabled = true) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = ref.current;
    const main = root?.closest<HTMLElement>('[data-testid="app-main"]');
    if (!enabled || !root || !main || typeof ResizeObserver === 'undefined') return;
    const footer = document.querySelector<HTMLElement>('[data-testid="app-bottom-footer"]');
    let frame = 0;

    const measure = () => {
      const viewport = [...root.querySelectorAll<HTMLElement>('[data-table-viewport]')]
        .find((element) => element.getClientRects().length > 0);
      if (!viewport) return;
      const bounds = viewport.getBoundingClientRect();
      const padding = Number.parseFloat(getComputedStyle(main).paddingBottom) || 0;
      const contentBelow = Math.max(0, main.getBoundingClientRect().bottom - bounds.bottom - padding);
      const bottom = footer?.getClientRects().length
        ? Math.min(window.innerHeight, footer.getBoundingClientRect().top)
        : window.innerHeight;
      const available = Math.max(144, Math.floor(bottom - bounds.top - window.scrollY - contentBelow - 8));
      const next = `${available}px`;
      if (root.style.getPropertyValue('--table-rows-height') !== next) {
        root.style.setProperty('--table-rows-height', next);
      }
    };

    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };

    const observer = new ResizeObserver(schedule);
    observer.observe(main);
    observer.observe(root);
    if (footer) observer.observe(footer);
    window.addEventListener('resize', schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [enabled]);

  return ref;
}
