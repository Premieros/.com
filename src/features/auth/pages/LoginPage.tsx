import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Building2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Loader2,
  LockKeyhole,
  ShoppingCart,
  UtensilsCrossed,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Logo } from '@/components/Logo';
import { useToast } from '@/components/Toast';
import { DesignSurface } from '@/components/design/DesignSurface';
import { APP_ROUTES } from '@/core/navigation/routes';

type LoginSlide = {
  image: string;
  badgeAr: string;
  badgeEn: string;
  titleAr: string;
  titleEn: string;
  descriptionAr: string;
  descriptionEn: string;
};

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

  const slides = useMemo<LoginSlide[]>(() => [
    {
      image: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1800&q=88',
      badgeAr: 'تشغيل مطعم متكامل',
      badgeEn: 'Complete restaurant operations',
      titleAr: 'إدارة أسهل.. وتجربة أفضل',
      titleEn: 'Simpler management. Better experience.',
      descriptionAr: 'من الطلب إلى التوصيل، كل عمليات مطعمك في مكان واحد.',
      descriptionEn: 'From ordering to delivery, run every restaurant workflow from one place.',
    },
    {
      image: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=1800&q=88',
      badgeAr: 'صالة ومطبخ بتناغم',
      badgeEn: 'Dining room and kitchen in sync',
      titleAr: 'كل طلب واضح من أول ضغطة',
      titleEn: 'Every order clear from the first tap',
      descriptionAr: 'طاولات، مطبخ، شفتات وطباعة فواتير ضمن تجربة تشغيل واحدة.',
      descriptionEn: 'Tables, kitchen, shifts, and receipts in one connected operating flow.',
    },
    {
      image: 'https://images.unsplash.com/photo-1552566626-52f8b828add9?auto=format&fit=crop&w=1800&q=88',
      badgeAr: 'نقطة بيع حديثة',
      badgeEn: 'Modern point of sale',
      titleAr: 'أسرع في الخدمة.. أدق في الإدارة',
      titleEn: 'Faster service. Smarter control.',
      descriptionAr: 'واجهة مصممة للكاشير مع متابعة فورية للمبيعات والطلبات.',
      descriptionEn: 'A cashier-first experience with live sales and order visibility.',
    },
    {
      image: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&w=1800&q=88',
      badgeAr: 'تقارير وقرارات أفضل',
      badgeEn: 'Reporting for better decisions',
      titleAr: 'اعرف ما يحدث في مطعمك لحظة بلحظة',
      titleEn: 'Know what is happening in your restaurant, live',
      descriptionAr: 'مبيعات، تكلفة، مخزون وربحية الفروع في لوحة واحدة.',
      descriptionEn: 'Sales, cost, inventory, and branch profitability in one dashboard.',
    },
  ], []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSlideIndex((value) => (value + 1) % slides.length);
    }, 5200);
    return () => window.clearInterval(timer);
  }, [slides.length]);

  const goToSlide = (index: number) => {
    const total = slides.length;
    setSlideIndex((index + total) % total);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'pin' && !/^\d{4}$/.test(pin)) {
      show(t('pinInvalid'), 'error');
      return;
    }
    setLoading(true);
    try {
      const result = mode === 'pin'
        ? await signInWithUsername(username, pin)
        : await signIn(email, password);

      if (result.error) {
        const code = result.error.code;
        let msg: string;
        if (code === 'invalid_credentials') msg = t('invalidCredentials');
        else if (code === 'email_not_confirmed') msg = t('emailNotConfirmed');
        else if (code === 'user_not_found') msg = mode === 'pin' ? t('usernameNotFound') : t('userNotFound');
        else if (code === 'user_inactive') msg = t('userInactive');
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

  const activeSlide = slides[slideIndex];

  return (
    <DesignSurface testId="login-surface">
      <div
        dir={isAr ? 'rtl' : 'ltr'}
        className="min-h-screen bg-slate-50 text-slate-950 lg:grid lg:grid-cols-[minmax(0,1.55fr)_minmax(420px,0.8fr)]"
      >
        <section className="relative hidden min-h-screen overflow-hidden lg:block">
          {slides.map((slide, index) => (
            <img
              key={slide.image}
              src={slide.image}
              alt=""
              aria-hidden={index !== slideIndex}
              className={`absolute inset-0 h-full w-full object-cover transition-all duration-1000 ease-out ${
                index === slideIndex ? 'scale-100 opacity-100' : 'scale-[1.035] opacity-0'
              }`}
            />
          ))}

          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/32 to-slate-950/12" />
          <div className="absolute inset-0 bg-gradient-to-r from-slate-950/18 via-transparent to-transparent" />

          <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between p-8 xl:p-10">
            <div className="rounded-full border border-white/20 bg-black/20 px-4 py-2 text-xs font-black text-white backdrop-blur-md">
              {isAr ? activeSlide.badgeAr : activeSlide.badgeEn}
            </div>
            <div className="rounded-full border border-white/15 bg-black/15 px-4 py-2 text-[11px] font-bold tracking-wide text-white/85 backdrop-blur-md">
              PREMIER RESTAURANT OS
            </div>
          </div>

          <button
            type="button"
            aria-label={isAr ? 'الصورة السابقة' : 'Previous image'}
            onClick={() => goToSlide(slideIndex - 1)}
            className="absolute start-8 top-1/2 z-20 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full border border-white/30 bg-black/25 text-white backdrop-blur-md transition hover:bg-black/45"
          >
            {isAr ? <ChevronRight className="h-6 w-6" /> : <ChevronLeft className="h-6 w-6" />}
          </button>

          <button
            type="button"
            aria-label={isAr ? 'الصورة التالية' : 'Next image'}
            onClick={() => goToSlide(slideIndex + 1)}
            className="absolute end-8 top-1/2 z-20 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full border border-white/30 bg-black/25 text-white backdrop-blur-md transition hover:bg-black/45"
          >
            {isAr ? <ChevronLeft className="h-6 w-6" /> : <ChevronRight className="h-6 w-6" />}
          </button>

          <div className="absolute inset-x-0 bottom-0 z-10 p-8 xl:p-12">
            <div className="max-w-3xl">
              <h1 className="text-4xl font-black leading-[1.08] tracking-tight text-white xl:text-6xl">
                {isAr ? activeSlide.titleAr : activeSlide.titleEn}
              </h1>
              <p className="mt-4 max-w-2xl text-base font-semibold leading-8 text-white/85 xl:text-lg">
                {isAr ? activeSlide.descriptionAr : activeSlide.descriptionEn}
              </p>

              <div className="mt-7 grid max-w-2xl grid-cols-3 gap-3">
                {[
                  [BarChart3, isAr ? 'تقارير فورية' : 'Live reporting', isAr ? 'قرارات أوضح' : 'Clearer decisions'],
                  [UtensilsCrossed, isAr ? 'إدارة الطلبات' : 'Order flow', isAr ? 'الصالة والمطبخ' : 'Dining & kitchen'],
                  [ShoppingCart, isAr ? 'تجربة كاشير' : 'Cashier experience', isAr ? 'سريعة وسلسة' : 'Fast and fluid'],
                ].map(([Icon, title, subtitle]) => {
                  const FeatureIcon = Icon as typeof BarChart3;
                  return (
                    <div key={String(title)} className="rounded-2xl border border-white/15 bg-black/25 p-4 text-white backdrop-blur-md">
                      <FeatureIcon className="h-5 w-5 text-blue-300" />
                      <p className="mt-3 text-xs font-black">{String(title)}</p>
                      <p className="mt-1 text-[11px] font-semibold text-white/65">{String(subtitle)}</p>
                    </div>
                  );
                })}
              </div>

              <div className="mt-7 flex items-center gap-2">
                {slides.map((slide, index) => (
                  <button
                    key={slide.image}
                    type="button"
                    aria-label={isAr ? `انتقل للصورة ${index + 1}` : `Go to image ${index + 1}`}
                    onClick={() => goToSlide(index)}
                    className={`h-2.5 rounded-full transition-all ${
                      index === slideIndex ? 'w-9 bg-blue-400' : 'w-2.5 bg-white/55 hover:bg-white'
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="relative flex min-h-screen items-center justify-center overflow-hidden bg-white px-5 py-8 sm:px-8 lg:px-10 xl:px-14">
          <div className="pointer-events-none absolute -end-32 -top-32 h-72 w-72 rounded-full bg-blue-50 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-36 -start-36 h-80 w-80 rounded-full bg-slate-100 blur-3xl" />

          <div className="relative z-10 w-full max-w-md">
            <div className="mb-8 flex items-start justify-between gap-4">
              <Logo variant="horizontal" size={58} tone="navy" showTagline={false} />
              <button
                data-testid="login-language-toggle"
                type="button"
                onClick={() => setLang(isAr ? 'en' : 'ar')}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-black text-slate-600 shadow-sm transition hover:border-blue-300 hover:text-blue-700"
              >
                {isAr ? 'English' : 'العربية'}
              </button>
            </div>

            <div className="mb-7">
              <h2 className="text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
                {isAr ? 'مرحبًا بعودتك' : 'Welcome back'}
              </h2>
              <p className="mt-2 text-sm font-semibold leading-7 text-slate-500">
                {isAr ? 'سجّل دخولك إلى نظام إدارة المطعم' : 'Sign in to your restaurant management system'}
              </p>
            </div>

            <div data-testid="login-mode-toggle" className="mb-5 grid grid-cols-2 rounded-2xl bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setMode('pin')}
                className={`rounded-xl py-2.5 text-sm font-black transition ${
                  mode === 'pin' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500'
                }`}
              >
                {t('loginWithPin')}
              </button>
              <button
                type="button"
                onClick={() => setMode('password')}
                className={`rounded-xl py-2.5 text-sm font-black transition ${
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

              <Button data-testid="login-submit" type="submit" size="lg" className="w-full" disabled={loading}>
                {loading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <span className="inline-flex items-center gap-2">
                    {t('signIn')}
                    {isAr ? <ArrowLeft className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
                  </span>
                )}
              </Button>
            </form>

            <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
                  <LockKeyhole className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-black text-slate-800">
                    {isAr ? 'دخول آمن لموظفي المطعم' : 'Secure restaurant staff access'}
                  </p>
                  <p className="mt-1 text-[11px] font-semibold leading-5 text-slate-500">
                    {isAr ? 'استخدم رمز الموظف أو البريد الإلكتروني حسب حسابك.' : 'Use your staff PIN or email credentials depending on your account.'}
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-between gap-3 border-t border-slate-100 pt-5 text-xs font-bold text-slate-500">
              <Link data-testid="login-register-link" to={APP_ROUTES.register} className="text-blue-700 transition hover:text-blue-800 hover:underline">
                {isAr ? 'ابدأ 14 يومًا مجانًا' : 'Start 14 days free'}
              </Link>
              <span className="inline-flex items-center gap-1.5">
                <Building2 className="h-4 w-4" />
                Premier
              </span>
            </div>

            <div className="relative mt-7 overflow-hidden rounded-2xl lg:hidden">
              <img
                src={activeSlide.image}
                alt=""
                className="h-44 w-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-4 text-white">
                <p className="text-sm font-black">{isAr ? activeSlide.titleAr : activeSlide.titleEn}</p>
                <div className="mt-3 flex gap-1.5">
                  {slides.map((slide, index) => (
                    <button
                      key={slide.image}
                      type="button"
                      onClick={() => goToSlide(index)}
                      className={`h-2 rounded-full transition-all ${
                        index === slideIndex ? 'w-7 bg-blue-400' : 'w-2 bg-white/60'
                      }`}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </DesignSurface>
  );
}
