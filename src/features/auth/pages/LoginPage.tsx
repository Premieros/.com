import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  LockKeyhole,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Logo } from '@/components/Logo';
import { useToast } from '@/components/Toast';
import { DesignSurface } from '@/components/design/DesignSurface';
import { APP_ROUTES } from '@/core/navigation/routes';

export function LoginPage() {
  const { signIn, signInWithUsername } = useAuth();
  const { t, lang, setLang } = useLanguage();
  const { show } = useToast();

  const [mode, setMode] = useState<'pin' | 'password'>('pin');
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [slideIndex, setSlideIndex] = useState(0);

  const isAr = lang === 'ar';

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const root = document.getElementById('root');

    const previous = {
      htmlOverflow: html.style.overflow,
      htmlHeight: html.style.height,
      bodyOverflow: body.style.overflow,
      bodyHeight: body.style.height,
      rootOverflow: root?.style.overflow ?? '',
      rootHeight: root?.style.height ?? '',
    };

    html.style.overflow = 'hidden';
    html.style.height = '100%';
    body.style.overflow = 'hidden';
    body.style.height = '100%';

    if (root) {
      root.style.overflow = 'hidden';
      root.style.height = '100%';
    }

    return () => {
      html.style.overflow = previous.htmlOverflow;
      html.style.height = previous.htmlHeight;
      body.style.overflow = previous.bodyOverflow;
      body.style.height = previous.bodyHeight;

      if (root) {
        root.style.overflow = previous.rootOverflow;
        root.style.height = previous.rootHeight;
      }
    };
  }, []);

  // Each visual has an explicit product capability and an accessible description.
  const slides = useMemo(() => [
    { image: '/auth/hq/pos.webp', titleAr: 'نقطة بيع سريعة ومرنة', titleEn: 'Fast, flexible point of sale', textAr: 'طلبات ومبيعات ومدفوعات من واجهة واحدة', textEn: 'Orders, sales and payments in one workspace' },
    { image: '/auth/hq/tables.webp', titleAr: 'إدارة الطاولات والطلبات', titleEn: 'Tables & order management', textAr: 'تابع الصالة، الطاولات، وحالة كل طلب', textEn: 'Keep track of tables, dining areas and orders' },
    { image: '/auth/hq/kitchen.webp', titleAr: 'المطبخ والإنتاج', titleEn: 'Kitchen & production', textAr: 'نظّم تحضير الطلبات والوصفات والمكونات', textEn: 'Coordinate kitchen orders, recipes and ingredients' },
    { image: '/auth/hq/dashboard.webp', titleAr: 'لوحات تحكم وتقارير', titleEn: 'Dashboards & reports', textAr: 'راقب الأداء والمبيعات والتكاليف في مكان واحد', textEn: 'See performance, sales and costing in one place' },
    { image: '/auth/creative/dashboard.webp', titleAr: 'المخزون والمشتريات', titleEn: 'Inventory & purchasing', textAr: 'تابع حركة المخزون والخامات والتوريد', textEn: 'Track stock, raw materials and purchases' },
    { image: '/auth/exact/login-art-4.webp', titleAr: 'المحاسبة والفروع', titleEn: 'Accounting & branches', textAr: 'إدارة مالية وصلاحيات وفروع متعددة', textEn: 'Financial workflows, permissions and multiple branches' },
  ], []);

  const activeSlide = slides[slideIndex];

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSlideIndex((value) => (value + 1) % slides.length);
    }, 4200);

    return () => window.clearInterval(timer);
  }, [slides.length]);

  useEffect(() => {
    const nextSlide = slides[(slideIndex + 1) % slides.length];
    const preload = new Image();
    preload.src = nextSlide.image;
  }, [slideIndex, slides]);


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (mode === 'pin' && !/^\d{4}$/.test(pin)) {
      show(t('pinInvalid'), 'error');
      return;
    }

    setLoading(true);
    try {
      const result =
        mode === 'pin'
          ? await signInWithUsername(username, pin)
          : await signIn(email, password);

      if (result.error) {
        const code = result.error.code;
        let msg: string;

        if (code === 'invalid_credentials') msg = t('invalidCredentials');
        else if (code === 'email_not_confirmed') msg = t('emailNotConfirmed');
        else if (code === 'user_not_found') {
          msg = mode === 'pin' ? t('usernameNotFound') : t('userNotFound');
        } else if (code === 'user_inactive') msg = t('userInactive');
        else if (code === 'user_locked') msg = t('userLocked');
        else if (code === 'over_request_rate_limit') msg = t('rateLimited');
        else if (code === 'email_address_invalid') msg = t('invalidCredentials');
        else msg = `${t('loginFailed')} ${result.error.message}`;

        show(msg, 'error');
      }
    } finally {
      setLoading(false);
    }
  };


  return (
    <DesignSurface testId="login-surface" className="h-[100dvh] overflow-hidden !space-y-0">
      <style>{`
        @keyframes login-scene-zoom-out {
          0% {
            transform: scale(1.025);
            opacity: 0;
          }
          10% {
            opacity: 1;
          }
          92% {
            opacity: 1;
          }
          100% {
            transform: scale(1);
            opacity: 0;
          }
        }

        @media (max-height: 760px) and (min-width: 1024px) {
          .login-panel-shell {
            transform: scale(0.9);
            transform-origin: center;
            width: 111.111%;
          }
        }

        @media (max-height: 680px) and (min-width: 1024px) {
          .login-panel-shell {
            transform: scale(0.82);
            width: 121.951%;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          [style*='login-scene-zoom-out'] {
            animation: none !important;
            transform: scale(1) !important;
            opacity: 1 !important;
          }
        }
      `}</style>
      <div className="h-[100dvh] overflow-hidden bg-white text-slate-950 lg:grid lg:grid-cols-[64%_36%]" dir="ltr">
        <section className="relative hidden h-full min-h-0 overflow-hidden bg-slate-950 lg:block">
          <img
            key={activeSlide.image}
            src={activeSlide.image}
            alt={isAr ? activeSlide.titleAr : activeSlide.titleEn}
            loading="eager"
            decoding="async"
            fetchPriority="high"
            draggable={false}
            className="absolute inset-0 h-full w-full object-cover object-center will-change-transform"
            style={{ animation: 'login-scene-zoom-out 4200ms ease-out both' }}
          />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-slate-950/95 via-slate-950/65 to-transparent px-10 pb-10 pt-28 text-white xl:px-14" dir={isAr ? 'rtl' : 'ltr'}>
            <div className="max-w-2xl">
              <p className="mb-2 text-xs font-black tracking-[0.18em] text-sky-300">PREMIER OS</p>
              <h2 className="text-3xl font-black leading-tight xl:text-4xl">{isAr ? activeSlide.titleAr : activeSlide.titleEn}</h2>
              <p className="mt-3 text-base font-medium leading-relaxed text-slate-100">{isAr ? activeSlide.textAr : activeSlide.textEn}</p>
            </div>
            <div className="pointer-events-auto mt-6 flex items-center gap-2" role="tablist" aria-label={isAr ? 'إمكانيات النظام' : 'System capabilities'}>
              {slides.map((slide, index) => (
                <button key={slide.image} type="button" role="tab" aria-selected={slideIndex === index}
                  aria-label={isAr ? slide.titleAr : slide.titleEn}
                  onClick={() => setSlideIndex(index)}
                  className={`h-2.5 rounded-full transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${slideIndex === index ? 'w-9 bg-sky-400' : 'w-2.5 bg-white/60 hover:bg-white'}`}
                />
              ))}
            </div>
          </div>
        </section>

        <section
          className="relative flex h-full min-h-0 items-center justify-center overflow-hidden bg-white px-6 py-4 sm:px-10 lg:border-s lg:border-slate-100 lg:px-9 xl:px-12"
          dir={isAr ? 'rtl' : 'ltr'}
        >
          <div className="login-panel-shell relative z-10 w-full max-w-[430px]">
            <div className="mb-6 flex items-center justify-between gap-4">
              <Logo variant="horizontal" size={62} tone="navy" showTagline={false} />

              <button
                data-testid="login-language-toggle"
                type="button"
                onClick={() => setLang(isAr ? 'en' : 'ar')}
                className="rounded-full border border-slate-200 bg-white px-4 py-2.5 text-xs font-black text-slate-600 shadow-sm transition hover:border-blue-300 hover:text-blue-700"
              >
                {isAr ? 'English' : 'العربية'}
              </button>
            </div>

            <div className="mb-5">
              <h1 className="text-4xl font-black tracking-tight text-slate-950">
                {isAr ? 'مرحبًا بعودتك' : 'Welcome back'}
              </h1>
              <p className="mt-2 text-base font-semibold leading-6 text-slate-500">
                {isAr ? 'سجّل دخولك إلى نظام Premier' : 'Sign in to Premier'}
              </p>
            </div>

            <div
              data-testid="login-mode-toggle"
              className="mb-4 grid grid-cols-2 rounded-2xl bg-slate-100 p-1"
            >
              <button
                type="button"
                onClick={() => setMode('pin')}
                className={`rounded-xl py-3 text-sm font-black transition ${
                  mode === 'pin' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500'
                }`}
              >
                {t('loginWithPin')}
              </button>
              <button
                type="button"
                onClick={() => setMode('password')}
                className={`rounded-xl py-3 text-sm font-black transition ${
                  mode === 'password' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500'
                }`}
              >
                {t('loginWithEmail')}
              </button>
            </div>

            <form data-testid="login-form" onSubmit={handleSubmit} className="space-y-4">
              {mode === 'pin' ? (
                <>
                  <Input
                    id="login-username"
                    label={t('username')}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    autoComplete="username"
                  />
                  <Input
                    id="login-pin"
                    label={t('pin')}
                    type="password"
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    required
                    inputMode="numeric"
                    maxLength={4}
                    placeholder="••••"
                  />
                </>
              ) : (
                <>
                  <Input
                    id="login-email"
                    label={t('email')}
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                  />
                  <Input
                    id="login-password"
                    label={t('password')}
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    autoComplete="current-password"
                  />
                </>
              )}

              <Button
                data-testid="login-submit"
                type="submit"
                size="lg"
                className="mt-2 min-h-14 w-full rounded-2xl text-base font-black shadow-lg shadow-blue-600/20"
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <span className="inline-flex items-center gap-2">
                    {t('signIn')}
                    {isAr ? (
                      <ArrowLeft className="h-5 w-5" />
                    ) : (
                      <ArrowRight className="h-5 w-5" />
                    )}
                  </span>
                )}
              </Button>
            </form>

            <div className="my-3 flex items-center gap-4">
              <div className="h-px flex-1 bg-slate-200" />
              <span className="text-xs font-black text-slate-400">{isAr ? 'أو' : 'OR'}</span>
              <div className="h-px flex-1 bg-slate-200" />
            </div>

            <button
              type="button"
              onClick={() => setMode(mode === 'pin' ? 'password' : 'pin')}
              className="flex min-h-14 w-full items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 transition hover:border-blue-300 hover:bg-blue-50/40"
            >
              <LockKeyhole className="h-5 w-5 text-blue-600" />
              {mode === 'pin'
                ? isAr
                  ? 'الدخول بالبريد الإلكتروني'
                  : 'Sign in with email'
                : isAr
                  ? 'الدخول برمز الموظف'
                  : 'Sign in with staff PIN'}
            </button>

            <div className="mt-5 border-t border-slate-100 pt-3">
              <Link
                data-testid="login-register-link"
                to={APP_ROUTES.register}
                className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border-2 border-blue-200 bg-blue-50 px-4 text-sm font-black text-blue-800 transition hover:border-blue-400 hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                {isAr ? 'أنشئ مؤسستك الآن — 14 يومًا مجانًا' : 'Create your business — 14 days free'}
                {isAr ? <ArrowLeft className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
              </Link>
              <p className="mt-2 text-center text-[11px] text-slate-400">Premier © 2026</p>
            </div>

          </div>
        </section>
      </div>
    </DesignSurface>
  );
}
