import { ArrowDown, ArrowUp, Search } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';

function isVisible(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
}

export function PageUtilityControls() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';

  const focusSearch = () => {
    const candidates = Array.from(document.querySelectorAll<HTMLInputElement>(
      'main input[type="search"]:not([disabled]), main input[data-testid*="search"]:not([disabled])',
    ));
    const target = candidates.find(isVisible);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      window.setTimeout(() => {
        target.focus();
        target.select();
      }, 220);
      return;
    }
    window.dispatchEvent(new Event('premier:open-command-palette'));
  };

  const buttonClass =
    'inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-ui-border bg-ui-page px-3 text-xs font-bold text-ui-text transition hover:border-ui-primary/40 hover:bg-ui-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-ring active:scale-[0.98] sm:flex-none';

  return (
    <div
      data-testid="page-utility-controls"
      className="flex w-full min-w-0 items-center justify-between gap-3"
      role="group"
      aria-label={ar ? 'أدوات الصفحة' : 'Page utilities'}
    >
      <span className="hidden shrink-0 text-xs font-semibold text-ui-subtle sm:inline">
        {ar ? 'أدوات الصفحة' : 'Page tools'}
      </span>
      <div data-testid="page-utility-menu" className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none">
        <button
          type="button"
          onClick={focusSearch}
          className={buttonClass}
          aria-label={ar ? 'بحث في الصفحة' : 'Search this page'}
          title={ar ? 'بحث في الصفحة' : 'Search this page'}
        >
          <Search className="h-4 w-4 shrink-0" />
          <span>{ar ? 'بحث' : 'Search'}</span>
        </button>
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className={buttonClass}
          aria-label={ar ? 'أعلى الصفحة' : 'Scroll to top'}
          title={ar ? 'أعلى الصفحة' : 'Scroll to top'}
        >
          <ArrowUp className="h-4 w-4 shrink-0" />
          <span>{ar ? 'أعلى' : 'Top'}</span>
        </button>
        <button
          type="button"
          onClick={() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' })}
          className={buttonClass}
          aria-label={ar ? 'أسفل الصفحة' : 'Scroll to bottom'}
          title={ar ? 'أسفل الصفحة' : 'Scroll to bottom'}
        >
          <ArrowDown className="h-4 w-4 shrink-0" />
          <span>{ar ? 'أسفل' : 'Bottom'}</span>
        </button>
      </div>
    </div>
  );
}
