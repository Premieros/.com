import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  ChevronLeft,
  ChevronRight,
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
      image: '/auth/login-scene-pos.jpg',
      titleAr: 'إدارة مطعمك بأسلوب أسهل وأذكى',
      titleEn: 'Run your restaurant in a simpler, smarter way',
      descriptionAr: 'نقطة بيع سريعة وواضحة داخل بيئة مطعم حقيقية',
      descriptionEn: 'A fast, clear point of sale inside a real restaurant environment',
    },
    {
      image: '/auth/login-scene-tables.jpg',
      titleAr: 'كل الطاولات والطلبات أمامك',
      titleEn: 'Every table and order in front of you',
      descriptionAr: 'تابع حالة الطاولات وافتح الطلبات بدون تعقيد',
      descriptionEn: 'Track table status and open orders without friction',
    },
    {
      image: '/auth/login-scene-dashboard.jpg',
      titleAr: 'قرارات أفضل من أرقام أوضح',
      titleEn: 'Better decisions from clearer numbers',
      descriptionAr: 'مبيعات، مخزون، تكلفة وربحية في لوحة تحكم واحدة',
      descriptionEn: 'Sales, inventory, cost, and profitability in one dashboard',
    },
  ], []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSlideIndex((value) => (value + 1) % slides.length);
    }, 5600);
    return () => window.clearInterval(timer);
  }, [slides.length]);

  const goToSlide = (index: number) => {
    setSlideIndex((index + slides.length) % slides.length);
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
      <div className="min-h-screen overflow-hidden bg-[#0b1220] text-slate-950 lg:grid lg:grid-cols-[62%_38%]" dir="ltr">
        <section className="relative hidden min-h-screen overflow-hidden lg:block">
          {slides.map((slide, index) => (
            <img
              key={slide.image}
              src={slide.image}
              alt=""
              aria-hidden={index !== slideIndex}
              className={`absolute inset-0 h-full w-full object-cover object-center transition-all duration-1000 ease-out ${
                index === slideIndex ? 'scale-100 opacity-100' : 'scale-[1.018] opacity-0'
              }`}
            />
          ))}

          <div className="absolute inset-0 bg-gradient-to-b from-slate-950/62 via-slate-950/12 to-slate-950/45" />
          <div className="absolute inset-0 bg-gradient-to-r from-slate-950/48 via-transparent to-transparent" />

          <div className="absolute inset-x-0 top-0 z-10 p-8 xl:p-10" dir={isAr ? 'rtl' : 'ltr'}>
            <div className="max-w-[720px]">
              <p className="text-sm font-black tracking-wide text-white/90">
                {isAr ? 'نظام Premier لإدارة المطاعم والكافيهات' : 'Premier Restaurant & Café Management'}
              </p>

              <h1 className="mt-4 max-w-[690px] text-4xl font-black leading-[1.08] tracking-tight text-white drop-shadow-2xl xl:text-6xl">
                {isAr ? activeSlide.titleAr : activeSlide.titleEn}
              </h1>

              <p className="mt-4 max-w-2xl text-base font-semibold leading-8 text-white/85 xl:text-lg">
                {isAr ? activeSlide.descriptionAr : activeSlide.descriptionEn}
              </p>

              <div className="mt-6 grid max-w-2xl grid-cols-3 gap-3">
                {[
                  [BarChart3, isAr ? 'تقارير فورية' : 'Live reports'],
                  [UtensilsCrossed, isAr ? 'إدارة الطلبات' : 'Order management'],
                  [ShoppingCart, isAr ? 'تشغيل أسرع' : 'Faster service'],
                ].map(([Icon, label]) => {
                  const FeatureIcon = Icon as typeof BarChart3;
                  return (
                    <div key={String(label)} className="rounded-2xl border border-white/15 bg-slate-950/32 px-4 py-3 text-white shadow-lg backdrop-blur-md">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600/95">
                          <FeatureIcon className="h-4 w-4" />
                        </span>
                        <span className="text-xs font-black">{String(label)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <button
            type="button"
            aria-label={isAr ? 'الصورة السابقة' : 'Previous image'}
            onClick={() => goToSlide(slideIndex - 1)}
            className="absolute left-6 top-1/2 z-20 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full border border-white/25 bg-slate-950/35 text-white shadow-xl backdrop-blur-md transition hover:bg-slate-950/55"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>

          <button
            type="button"
            aria-label={isAr ? 'الصورة التالية' : 'Next image'}
            onClick={() => goToSlide(slideIndex + 1)}
            className="absolute right-6 top-1/2 z-20 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full border border-white/25 bg-slate-950/35 text-white shadow-xl backdrop-blur-md transition hover:bg-slate-950/55"
          >
            <ChevronRight className="h-6 w-6" />
          </button>

          <div className="absolute inset-x-0 bottom-7 z-20 flex justify-center gap-2.5">
            {slides.map((slide, index) => (
              <button
                key={slide.image}
                type="button"
                aria-label={isAr ? `انتقل للصورة ${index + 1}` : `Go to image ${index + 1}`}
                onClick={() => goToSlide(index)}
                className={`h-2.5 rounded-full transition-all ${
                  index === slideIndex ? 'w-9 bg-blue-500' : 'w-2.5 bg-white/70 hover:bg-white'
                }`}
              />
            ))}
          </div>
        </section>

        <section
          className="relative z-30 flex min-h-screen items-center justify-center bg-white px-6 py-8 sm:px-10 lg:-ml-8 lg:rounded-l-[56px] lg:px-10 lg:shadow-[-26px_0_70px_-36px_rgba(15,23,42,0.5)] xl:px-14"
          dir={isAr ? 'rtl' : 'ltr'}
        >
          <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-blue-50/80 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 -left-10 h-72 w-72 rounded-full bg-slate-100 blur-3xl" />

          <div className="relative z-10 w-full max-w-[470px]">
            <div className="mb-8 flex items-center justify-between gap-4">
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

            <div className="mb-7">
              <h2 className="text-4xl font-black tracking-tight text-slate-950">
                {isAr ? 'مرحبًا بعودتك' : 'Welcome back'}
              </h2>
              <p className="mt-3 text-base font-semibold leading-7 text-slate-500">
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

              <Button
                data-testid="login-submit"
                type="submit"
                size="lg"
                className="mt-2 min-h-14 w-full rounded-2xl text-base font-black shadow-xl shadow-blue-600/20"
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <span className="inline-flex items-center gap-2">
                    {t('signIn')}
                    {isAr ? <ArrowLeft className="h-5 w-5" /> : <ArrowRight className="h-5 w-5" />}
                  </span>
                )}
              </Button>
            </form>

            <div className="my-5 flex items-center gap-4">
              <div className="h-px flex-1 bg-slate-200" />
              <span className="text-xs font-black text-slate-400">{isAr ? 'أو' : 'OR'}</span>
              <div className="h-px flex-1 bg-slate-200" />
            </div>

            <button
              type="button"
              onClick={() => setMode(mode === 'pin' ? 'password' : 'pin')}
              className="flex min-h-14 w-full items-center justify-center gap-3 rounded-2xl border border-blue-200 bg-blue-50/50 px-4 text-sm font-black text-slate-800 transition hover:border-blue-300 hover:bg-blue-50"
            >
              <LockKeyhole className="h-5 w-5 text-blue-600" />
              {mode === 'pin'
                ? (isAr ? 'الدخول بالبريد الإلكتروني' : 'Sign in with email')
                : (isAr ? 'الدخول برمز الموظف' : 'Sign in with staff PIN')}
            </button>

            <div className="mt-8 flex items-center justify-between gap-4 border-t border-slate-100 pt-5 text-xs font-bold text-slate-500">
              <Link
                data-testid="login-register-link"
                to={APP_ROUTES.register}
                className="text-blue-700 transition hover:text-blue-800 hover:underline"
              >
                {isAr ? 'ابدأ 14 يومًا مجانًا' : 'Start 14 days free'}
              </Link>
              <span>Premier © 2026</span>
            </div>

            <div className="relative mt-8 overflow-hidden rounded-3xl lg:hidden">
              <img src={activeSlide.image} alt="" className="h-52 w-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950/85 via-slate-950/25 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-5 text-white">
                <p className="text-lg font-black">{isAr ? activeSlide.titleAr : activeSlide.titleEn}</p>
                <div className="mt-3 flex gap-2">
                  {slides.map((slide, index) => (
                    <button
                      key={slide.image}
                      type="button"
                      onClick={() => goToSlide(index)}
                      className={`h-2.5 rounded-full transition-all ${
                        index === slideIndex ? 'w-8 bg-blue-400' : 'w-2.5 bg-white/65'
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
