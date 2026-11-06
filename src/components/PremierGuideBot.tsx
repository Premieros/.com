import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { APP_ROUTES } from '@/core/navigation/routes';
import { useAuth } from '@/context/AuthContext';
import { useCan } from '@/lib/permissions';

/**
 * Visual onboarding only: it never submits a form, executes payments, or
 * reads/transmits customer or product values. The user performs every action.
 */
type Stage = 'intro' | 'products' | 'add' | 'name' | 'price' | 'wizard-next' | 'save' | 'pos' | 'finish';
type Tip = { message: string; selector?: string; route?: string; cta?: string };

const TIPS: Record<Stage, Tip> = {
  intro: { message: 'أهلًا بك! أنا مساعد Premier. سأريك أين تضغط لإنشاء منتجك الأول ثم بيعه.', cta: 'لنبدأ' },
  products: { message: 'لنفتح شاشة المنيو والمنتجات، ثم نضيف منتجًا جديدًا.', route: APP_ROUTES.products, cta: 'فتح المنتجات' },
  add: { message: 'اضغط على زر «إضافة» لإنشاء منتج جديد. أنا أشير إليه الآن 👆', selector: '[data-testid="products-add"]' },
  name: { message: 'اكتب اسم المنتج في هذا الحقل، ثم اختر الفرع والتصنيف إن لزم.', selector: '[data-testid="product-setup-wizard-page"] input[required]' },
  price: { message: 'أدخل سعر البيع. راجع بيانات المنتج قبل الانتقال للمراجعة.', selector: '[data-testid="product-setup-wizard-page"] input[type="number"]' },
  'wizard-next': { message: 'تابع خطوات إعداد المنتج حتى تصل إلى «مراجعة». المكونات اختيارية حسب نشاطك.', selector: '[data-testid="product-setup-wizard-page"] button' },
  save: { message: 'بعد مراجعة البيانات اضغط «حفظ المنتج». لا يمكنني الحفظ بدلًا عنك.', selector: '[data-testid="product-setup-wizard-page"] button' },
  pos: { message: 'أحسنت! انتقل إلى نقطة البيع وابحث عن المنتج الذي أنشأته.', route: APP_ROUTES.pos, cta: 'فتح نقطة البيع' },
  finish: { message: 'اختر المنتج وأضفه للطلب، ثم راجع الإجمالي وطريقة الدفع. أكّد البيع بنفسك بعد التحقق.', selector: '[data-testid="pos-catalog-shell"]', cta: 'إنهاء الإرشاد' },
};

const ORDER: Stage[] = ['intro', 'products', 'add', 'name', 'price', 'wizard-next', 'save', 'pos', 'finish'];
const STORAGE_KEY = 'premier:visual-guide:v1:';
const routeFor = (stage: Stage) => stage === 'add' ? APP_ROUTES.products
  : ['name', 'price', 'wizard-next', 'save'].includes(stage) ? APP_ROUTES.products + '/setup'
  : stage === 'finish' ? APP_ROUTES.pos : undefined;

function PremierMascot({ pointing }: { pointing: boolean }) {
  return (
    <svg viewBox="0 0 140 170" width="112" height="136" aria-hidden="true" className={pointing ? 'premier-bot-pointing' : 'premier-bot-idle'}>
      <defs>
        <linearGradient id="premierBotWhite" x1="0" x2="1" y1="0" y2="1"><stop stopColor="#fff"/><stop offset="1" stopColor="#dcd6f8"/></linearGradient>
        <linearGradient id="premierBotPurple" x1="0" x2="1" y1="0" y2="1"><stop stopColor="#a78bfa"/><stop offset="1" stopColor="#6038ea"/></linearGradient>
      </defs>
      <ellipse cx="70" cy="160" rx="46" ry="7" fill="#221448" opacity=".15"/>
      <path d="M52 119 37 152Q47 165 64 154L70 127M88 119l15 33Q91 165 78 154L70 127" stroke="#342354" strokeWidth="6" fill="url(#premierBotWhite)" strokeLinejoin="round"/>
      <rect x="37" y="89" width="66" height="50" rx="25" fill="url(#premierBotWhite)" stroke="#b7a9f2" strokeWidth="3"/>
      <path d="M59 102h25a9 9 0 0 1 0 18H66v9H55v-18a9 9 0 0 1 4-9Z" fill="#211436" opacity=".9"/>
      <circle cx="90" cy="124" r="5" fill="#7952f4"/>
      <path d="M44 104 23 129" stroke="#f7f5ff" strokeWidth="12" strokeLinecap="round"/>
      <circle cx="22" cy="130" r="9" fill="url(#premierBotPurple)"/>
      <g className="premier-bot-arm">
        <path d="M95 107 116 78" stroke="#f7f5ff" strokeWidth="12" strokeLinecap="round"/>
        <circle cx="116" cy="78" r="9" fill="url(#premierBotPurple)"/>
        <path d="M116 73 132 50" stroke="#f7f5ff" strokeWidth="9" strokeLinecap="round"/>
        <circle cx="132" cy="50" r="5" fill="#7952f4"/>
      </g>
      <rect x="16" y="21" width="108" height="80" rx="38" fill="url(#premierBotWhite)" stroke="#af9df0" strokeWidth="3"/>
      <rect x="27" y="32" width="86" height="58" rx="25" fill="#1c1230"/>
      <path d="M43 61q8-14 16 0M79 61q8-14 16 0" fill="none" stroke="#bdaaff" strokeWidth="5" strokeLinecap="round"/>
      <path d="M58 74q12 10 24 0" stroke="#bdaaff" strokeWidth="3" fill="none" strokeLinecap="round"/>
      <path d="M70 22V13" stroke="#7952f4" strokeWidth="5" strokeLinecap="round"/>
      <circle cx="70" cy="9" r="8" fill="url(#premierBotPurple)"/>
      <circle cx="17" cy="65" r="12" fill="url(#premierBotPurple)"/>
      <circle cx="123" cy="65" r="12" fill="url(#premierBotPurple)"/>
    </svg>
  );
}

export function PremierGuideBot() {
  const { user } = useAuth();
  const can = useCan();
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<Stage>('intro');
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [visibleTarget, setVisibleTarget] = useState(false);
  const [revision, setRevision] = useState(0);
  const storageKey = user?.id ? STORAGE_KEY + user.id : '';

  useEffect(() => {
    if (!storageKey) { setOpen(false); return; }
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved && ORDER.includes(saved as Stage)) setStage(saved as Stage);
    } catch { /* private browsing */ }
  }, [storageKey]);

  const go = useCallback((next: Stage) => {
    setStage(next);
    if (storageKey) {
      try { window.localStorage.setItem(storageKey, next); } catch { /* private browsing */ }
    }
    const requiredRoute = routeFor(next);
    if (requiredRoute && location.pathname !== requiredRoute) navigate(requiredRoute);
  }, [location.pathname, navigate, storageKey]);

  const step = TIPS[stage];
  const available = Boolean(user && user.role !== 'super_admin');
  const canGuide = can('products.view') && can('products.create') && can('pos.view');

  useEffect(() => {
    if (!open || !available || !canGuide) { setTargetRect(null); setVisibleTarget(false); return; }
    const selector = step.selector;
    if (!selector) { setTargetRect(null); setVisibleTarget(false); return; }
    let frame = 0;
    const update = () => {
      const root = document.querySelector(selector);
      let element = root as HTMLElement | null;
      // For wizard navigation, target only the visible action button.
      if (stage === 'wizard-next' || stage === 'save') {
        const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-testid="product-setup-wizard-page"] button'));
        const match = stage === 'save' ? /حفظ|Save/i : /التالي|Next|مراجعة|Review/i;
        element = buttons.find(button => match.test(button.textContent || '') && button.getBoundingClientRect().width > 0) || null;
      }
      if (stage === 'price') {
        // Sale price is the second numeric input, after cost price.
        element = document.querySelectorAll<HTMLInputElement>('[data-testid="product-setup-wizard-page"] input[type="number"]')[1] || null;
      }
      if (element) {
        const rect = element.getBoundingClientRect();
        const shown = rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight;
        setTargetRect(shown ? rect : null);
        setVisibleTarget(shown);
      } else { setTargetRect(null); setVisibleTarget(false); }
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
    update();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'disabled'] });
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); window.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule); };
  }, [open, available, canGuide, stage, step.selector, location.pathname, revision]);

  useEffect(() => {
    if (!open) return;
    if (stage === 'products' && location.pathname === APP_ROUTES.products) go('add');
    if (stage === 'add' && location.pathname === APP_ROUTES.products + '/setup') go('name');
    if (stage === 'save' && location.pathname === APP_ROUTES.products) go('pos');
    if (stage === 'pos' && location.pathname === APP_ROUTES.pos) go('finish');
  }, [open, stage, location.pathname, go]);

  if (!available || location.pathname === APP_ROUTES.login || location.pathname === APP_ROUTES.register) return null;
  const index = ORDER.indexOf(stage);
  const next = () => {
    if (stage === 'intro') return go('products');
    if (stage === 'products') return navigate(APP_ROUTES.products);
    if (stage === 'add') return setRevision(x => x + 1);
    if (stage === 'name') return go('price');
    if (stage === 'price') return go('wizard-next');
    if (stage === 'wizard-next') return go('save');
    if (stage === 'save') return setRevision(x => x + 1);
    if (stage === 'pos') return navigate(APP_ROUTES.pos);
    setOpen(false);
  };
  return (
    <div data-premier-guide dir="rtl" className="fixed bottom-4 left-3 z-[75] font-sans sm:bottom-6 sm:left-6" style={{ pointerEvents: 'none' }}>
      <style>{`@keyframes premier-guide-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}@keyframes premier-guide-point{0%,100%{transform:rotate(0deg)}50%{transform:rotate(-12deg)}}.premier-bot-idle,.premier-bot-pointing{animation:premier-guide-float 3s ease-in-out infinite}.premier-bot-pointing .premier-bot-arm{transform-origin:96px 108px;animation:premier-guide-point 1.2s ease-in-out infinite}@media(prefers-reduced-motion:reduce){.premier-bot-idle,.premier-bot-pointing,.premier-bot-arm{animation:none!important}}`}</style>
      {open && canGuide && visibleTarget && targetRect && (
        <div aria-hidden="true" className="fixed z-[74] rounded-lg border-[3px] border-violet-500 shadow-[0_0_0_5px_rgba(124,58,237,.17),0_0_22px_5px_rgba(124,58,237,.3)]"
          style={{ top: Math.max(0, targetRect.top - 5), left: Math.max(0, targetRect.left - 5), width: targetRect.width + 10, height: targetRect.height + 10, pointerEvents: 'none' }} />
      )}
      {open && canGuide && (
        <section role="dialog" aria-label="مساعد Premier الإرشادي" className="mb-1 max-h-[52dvh] w-[min(87vw,350px)] overflow-y-auto rounded-[22px] border border-violet-300 bg-white p-4 text-slate-900 shadow-[0_8px_38px_rgba(57,27,115,.25)]" style={{ pointerEvents: 'auto' }}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="rounded-full bg-violet-700 px-3 py-1 text-xs font-bold text-white">✨ مساعد Premier</span>
            <button type="button" className="rounded-full px-2 text-lg" aria-label="تصغير المساعد" onClick={() => setOpen(false)}>×</button>
          </div>
          <p className="text-sm font-semibold leading-7">{step.message}</p>
          {step.selector && !visibleTarget && <p className="mt-1 text-xs text-amber-700">العنصر غير ظاهر الآن. تأكد من فتح الخطوة الصحيحة أو مرّر الصفحة إليه.</p>}
          <div className="mt-3 flex items-center justify-between gap-2">
            <button type="button" className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600" onClick={() => setOpen(false)}>تخطي الآن</button>
            <span className="text-[11px] text-violet-700">{index + 1} / {ORDER.length}</span>
            <button type="button" className="rounded-xl bg-violet-700 px-3 py-2 text-xs font-bold text-white hover:bg-violet-800" onClick={next}>{step.cta || (stage === 'add' || stage === 'save' ? 'أنتظر ضغطك' : 'التالي')}</button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1" aria-hidden="true">{ORDER.map((part, i) => <span key={part} className={'h-1.5 flex-1 rounded-full ' + (i <= index ? 'bg-violet-600' : 'bg-violet-100')}/>)}</div>
        </section>
      )}
      {open && !canGuide && <div className="mb-2 w-64 rounded-xl bg-white p-3 text-sm shadow-xl" style={{ pointerEvents: 'auto' }}>تحتاج صلاحية عرض وإنشاء المنتجات وفتح نقطة البيع لتشغيل هذه الجولة.</div>}
      <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open} aria-label={open ? 'إخفاء روبوت Premier' : 'فتح روبوت Premier'}
        className="block rounded-2xl outline-offset-2 focus-visible:outline focus-visible:outline-violet-600" style={{ pointerEvents: 'auto', filter: 'drop-shadow(0 8px 12px rgba(49,29,105,.24))' }}>
        <PremierMascot pointing={open && visibleTarget}/>
      </button>
      {!open && <button type="button" onClick={() => { go('intro'); setOpen(true); }} className="rounded-full bg-violet-700 px-3 py-1 text-xs font-bold text-white shadow-lg" style={{ pointerEvents: 'auto' }}>ابدأ الإرشاد</button>}
    </div>
  );
}
