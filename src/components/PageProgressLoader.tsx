import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BrandLoading } from '@/components/BrandLoading';
import { useLanguage } from '@/context/LanguageContext';

type ProgressContextValue = {
  begin: () => void;
  complete: () => void;
};

const ProgressContext = createContext<ProgressContextValue | null>(null);
// A loading overlay must never leave the operator with a silent 92% spinner.
export const PAGE_LOADING_STALL_MS = 15_000;

export function PageLoadProgressProvider({ children }: { children: ReactNode }) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stalled, setStalled] = useState(false);
  const activeLoads = useRef(0);
  const tickTimer = useRef<number | null>(null);
  const stallTimer = useRef<number | null>(null);
  const frameTimer = useRef<number | null>(null);

  const clearTick = useCallback(() => {
    if (tickTimer.current !== null) {
      window.clearInterval(tickTimer.current);
      tickTimer.current = null;
    }
    if (frameTimer.current !== null) {
      window.cancelAnimationFrame(frameTimer.current);
      frameTimer.current = null;
    }
    if (stallTimer.current !== null) {
      window.clearTimeout(stallTimer.current);
      stallTimer.current = null;
    }
  }, []);

  const begin = useCallback(() => {
    activeLoads.current += 1;
    if (activeLoads.current > 1) return;

    clearTick();
    setVisible(true);
    setStalled(false);
    setProgress(0);
    stallTimer.current = window.setTimeout(() => {
      stallTimer.current = null;
      if (tickTimer.current !== null) {
        window.clearInterval(tickTimer.current);
        tickTimer.current = null;
      }
      setStalled(true);
    }, PAGE_LOADING_STALL_MS);

    frameTimer.current = window.requestAnimationFrame(() => {
      frameTimer.current = null;
      setProgress(8);
    });

    tickTimer.current = window.setInterval(() => {
      setProgress((current) => {
        if (current >= 92) return current;
        const remaining = 92 - current;
        const next = current + Math.max(1, remaining * 0.16);
        return Math.min(92, next);
      });
    }, 85);
  }, [clearTick]);

  const complete = useCallback(() => {
    activeLoads.current = Math.max(0, activeLoads.current - 1);
    if (activeLoads.current > 0) return;

    clearTick();
    setProgress(100);
    setStalled(false);
    setVisible(false);
  }, [clearTick]);

  useEffect(() => () => {
    clearTick();
  }, [clearTick]);

  const value = useMemo(() => ({ begin, complete }), [begin, complete]);

  return (
    <ProgressContext.Provider value={value}>
      {children}
      {visible && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-ui-page/95 px-6 backdrop-blur-sm"
          role="status"
          aria-live="polite"
          aria-label={ar ? 'جارٍ تحميل الصفحة' : 'Loading page'}
          data-testid="page-progress-loader"
        >
          <div className="w-full max-w-md rounded-3xl border border-ui-border bg-ui-surface p-6 shadow-ui-lg">
            <div className="mb-5 flex justify-center"><BrandLoading size={72} /></div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-base font-black text-ui-text">
                  {ar ? 'جارٍ تجهيز الصفحة' : 'Preparing your page'}
                </p>
                <p className="mt-1 text-sm text-ui-muted">
                  {stalled
                    ? (ar ? 'تأخر تحميل الصفحة. قد يكون الاتصال ضعيفًا أو أحد الملفات لم يصل.' : 'The page is taking too long. Your connection or a page file may be unavailable.')
                    : (ar ? 'النظام يعمل، لحظات ويتم عرض المحتوى.' : 'The system is working. Your content will appear shortly.')}
                </p>
              </div>
              <span className="min-w-16 text-end text-2xl font-black tabular-nums text-ui-primary">
                {Math.round(progress)}%
              </span>
            </div>

            <div
              className="mt-5 h-2.5 overflow-hidden rounded-full bg-ui-page-alt"
              aria-hidden="true"
            >
              <div
                className="h-full rounded-full bg-ui-primary transition-[width] duration-150 ease-out motion-reduce:transition-none"
                style={{ width: `${progress}%` }}
              />
            </div>
            {stalled && (
              <div className="mt-4 flex flex-col gap-2" role="alert">
                <button type="button" onClick={() => window.location.reload()}
                  className="rounded-xl bg-ui-primary px-4 py-2 font-bold text-ui-primary-fg">
                  {ar ? 'إعادة تحميل الصفحة' : 'Reload page'}
                </button>
                <p className="text-center text-xs text-ui-muted">
                  {ar ? 'لن يتم إرسال أي عملية بيع أو دفع من شاشة الانتظار.' : 'This loading screen does not submit sales or payments.'}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </ProgressContext.Provider>
  );
}

export function PageLoadFallback() {
  const context = useContext(ProgressContext);

  useEffect(() => {
    context?.begin();
    return () => context?.complete();
  }, [context]);

  return <div className="min-h-screen bg-ui-page" data-testid="page-load-fallback" aria-hidden="true" />;
}
