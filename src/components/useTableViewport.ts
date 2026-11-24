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
      // getBoundingClientRect() already returns viewport-relative coordinates.
      // Subtracting window.scrollY again can shrink the table to its minimum.
      // Reserve room for the table's own footer, not the entire page's height.
      const tableFooter = root.querySelector<HTMLElement>('[data-testid="data-table-footer"]');
      const footerHeight = tableFooter?.getBoundingClientRect().height ?? 0;
      const bottom = footer?.getClientRects().length
        ? Math.min(window.innerHeight, footer.getBoundingClientRect().top)
        : window.innerHeight;
      const available = Math.max(144, Math.floor(bottom - bounds.top - footerHeight - 16));
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
