import React, { useRef, useState, useEffect, useCallback, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface ScrollableCardStripProps {
  children: ReactNode;
  className?: string;
  testId?: string;
  scrollAmount?: number;
}

export function ScrollableCardStrip({
  children,
  className = '',
  testId = 'scrollable-card-strip',
  scrollAmount = 240,
}: ScrollableCardStripProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [canScrollStart, setCanScrollStart] = useState(false);
  const [canScrollEnd, setCanScrollEnd] = useState(false);
  const [isRtl, setIsRtl] = useState(false);

  // Drag-to-scroll state
  const isDragging = useRef(false);
  const startX = useRef(0);
  const initialScrollLeft = useRef(0);

  const checkScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;

    const rtl = document.documentElement.dir === 'rtl' || window.getComputedStyle(el).direction === 'rtl';
    setIsRtl(rtl);

    const { scrollLeft, scrollWidth, clientWidth } = el;
    const maxScroll = scrollWidth - clientWidth;

    if (maxScroll <= 2) {
      setCanScrollStart(false);
      setCanScrollEnd(false);
      return;
    }

    if (rtl) {
      // In RTL browsers, scrollLeft can be 0 -> -maxScroll or 0 -> maxScroll or maxScroll -> 0
      const absScroll = Math.abs(scrollLeft);
      setCanScrollStart(absScroll > 2);
      setCanScrollEnd(absScroll < maxScroll - 2);
    } else {
      setCanScrollStart(scrollLeft > 2);
      setCanScrollEnd(scrollLeft < maxScroll - 2);
    }
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    checkScroll();

    el.addEventListener('scroll', checkScroll, { passive: true });
    window.addEventListener('resize', checkScroll);

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => checkScroll());
      observer.observe(el);
      if (el.firstElementChild) observer.observe(el.firstElementChild);
    }

    return () => {
      el.removeEventListener('scroll', checkScroll);
      window.removeEventListener('resize', checkScroll);
      observer?.disconnect();
    };
  }, [checkScroll, children]);

  const handleScroll = (direction: 'prev' | 'next') => {
    const el = containerRef.current;
    if (!el) return;

    // Determine direction multiplier based on RTL
    let delta = direction === 'next' ? scrollAmount : -scrollAmount;
    if (isRtl) {
      delta = -delta;
    }

    el.scrollBy({ left: delta, behavior: 'smooth' });
  };

  // Mouse drag handlers
  const onMouseDown = (e: React.MouseEvent) => {
    const el = containerRef.current;
    if (!el) return;
    // Don't drag if clicking interactive elements
    if ((e.target as HTMLElement).closest('button, a, input, select')) return;

    isDragging.current = true;
    startX.current = e.pageX - el.offsetLeft;
    initialScrollLeft.current = el.scrollLeft;
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!isDragging.current) return;
    const el = containerRef.current;
    if (!el) return;
    e.preventDefault();
    const x = e.pageX - el.offsetLeft;
    const walk = (x - startX.current) * 1.5;
    el.scrollLeft = initialScrollLeft.current - walk;
  };

  const onMouseUpOrLeave = () => {
    isDragging.current = false;
  };

  return (
    <div data-testid={testId} className={`relative group/strip flex items-center ${className}`}>
      {/* Scroll Start Arrow */}
      {canScrollStart && (
        <button
          type="button"
          data-testid={`${testId}-prev-btn`}
          onClick={() => handleScroll('prev')}
          aria-label={isRtl ? 'تمرير للأمام' : 'Scroll previous'}
          className="absolute start-0 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-ui-border bg-ui-surface/95 text-ui-text shadow-ui-md backdrop-blur-sm transition-all hover:bg-ui-page-alt hover:scale-105 active:scale-95"
        >
          {isRtl ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      )}

      {/* Scrollable Container */}
      <div
        ref={containerRef}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUpOrLeave}
        onMouseLeave={onMouseUpOrLeave}
        className="w-full flex-1 overflow-x-auto scrollbar-none scroll-smooth touch-pan-x [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {children}
      </div>

      {/* Scroll End Arrow */}
      {canScrollEnd && (
        <button
          type="button"
          data-testid={`${testId}-next-btn`}
          onClick={() => handleScroll('next')}
          aria-label={isRtl ? 'تمرير للخلف' : 'Scroll next'}
          className="absolute end-0 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-ui-border bg-ui-surface/95 text-ui-text shadow-ui-md backdrop-blur-sm transition-all hover:bg-ui-page-alt hover:scale-105 active:scale-95"
        >
          {isRtl ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
      )}
    </div>
  );
}
