import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';

export const WorkspaceToolbarTarget = createContext<HTMLElement | null | undefined>(undefined);

export function WorkspaceControls({ children }: { children: ReactNode }) {
  const target = useContext(WorkspaceToolbarTarget);
  const controls = <div data-testid="page-actions" className="flex min-w-max shrink-0 items-center gap-2">{children}</div>;
  if (target === undefined) return controls;
  return target ? createPortal(controls, target) : null;
}

export function WorkspaceScrollRow({ children, className = '' }: { children: ReactNode; className?: string }) {
  const { lang } = useLanguage();
  const rtl = lang === 'ar';
  const viewport = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  useEffect(() => {
    const node = viewport.current;
    const content = track.current;
    if (!node || !content) return;
    function update() {
      if (!node) return;
      const offset = Math.abs(node.scrollLeft);
      const next = { start: offset > 2, end: node.scrollWidth - node.clientWidth - offset > 2 };
      setEdges(previous => previous.start === next.start && previous.end === next.end ? previous : next);
    }
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(node);
    observer?.observe(content);
    node.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      observer?.disconnect();
      node.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [rtl]);

  function move(towardsEnd: boolean) {
    const node = viewport.current;
    if (!node) return;
    const forward = rtl ? -1 : 1;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    node.scrollBy({ left: node.clientWidth * 0.8 * forward * (towardsEnd ? 1 : -1), behavior: reduced ? 'auto' : 'smooth' });
  }

  const overflow = edges.start || edges.end;
  const Previous = rtl ? ChevronRight : ChevronLeft;
  const Next = rtl ? ChevronLeft : ChevronRight;
  const arrow = 'grid h-8 w-8 shrink-0 place-items-center rounded-full border border-ui-border bg-ui-surface text-ui-text disabled:opacity-30';
  return <div className={`flex min-w-0 items-center gap-1 ${className}`}>
    {overflow && <button type="button" className={arrow} aria-label={rtl ? 'تمرير نحو البداية' : 'Scroll toward start'} disabled={!edges.start} onClick={() => move(false)}><Previous size={16} aria-hidden="true" /></button>}
    <div ref={viewport} className="min-w-0 flex-1 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div ref={track} className="flex w-max min-w-full items-center gap-2">{children}</div>
    </div>
    {overflow && <button type="button" className={arrow} aria-label={rtl ? 'تمرير نحو النهاية' : 'Scroll toward end'} disabled={!edges.end} onClick={() => move(true)}><Next size={16} aria-hidden="true" /></button>}
  </div>;
}
