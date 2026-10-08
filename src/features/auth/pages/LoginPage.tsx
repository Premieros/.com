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

type LoginPreview = 'pos' | 'tables' | 'dashboard' | 'kitchen';

type LoginSlide = {
  image: string;
  preview: LoginPreview;
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
      image: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1800&q=90',
      preview: 'pos',
      titleAr: 'إدارة مطعمك بأسلوب أسهل وأذكى',
      titleEn: 'Run your restaurant in a simpler, smarter way',
      descriptionAr: 'من الطلبات حتى التقارير، كل ما تحتاجه في مكان واحد',
      descriptionEn: 'From orders to reports, everything you need in one place',
    },
    {
      image: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=1800&q=90',
      preview: 'tables',
      titleAr: 'كل الطلبات تحت السيطرة',
      titleEn: 'Keep every order under control',
      descriptionAr: 'اربط الصالة والمطبخ والكاشير في تجربة تشغيل واحدة',
      descriptionEn: 'Connect dining room, kitchen, and cashier in one workflow',
    },
    {
      image: 'https://images.unsplash.com/photo-1552566626-52f8b828add9?auto=format&fit=crop&w=1800&q=90',
      preview: 'dashboard',
      titleAr: 'أسرع في الخدمة.. أدق في الإدارة',
      titleEn: 'Faster service. Better control.',
      descriptionAr: 'نقطة بيع حديثة مصممة لسرعة الخدمة ووضوح التشغيل',
      descriptionEn: 'A modern point of sale built for speed and clarity',
    },
    {
      image: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&w=1800&q=90',
      preview: 'kitchen',
      titleAr: 'اعرف أرقام مطعمك لحظة بلحظة',
      titleEn: 'Know your restaurant numbers in real time',
      descriptionAr: 'مبيعات، مخزون، تكلفة وربحية في تقارير واضحة',
      descriptionEn: 'Sales, inventory, cost, and profitability in clear reports',
    },
  ], []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSlideIndex((value) => (value + 1) % slides.length);
    }, 5000);
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
      <div className="min-h-screen overflow-hidden bg-[#0d1117] text-slate-950 lg:grid lg:grid-cols-[60%_40%]" dir="ltr">
        <section className="relative hidden min-h-screen overflow-hidden lg:block">
          {slides.map((slide, index) => (
            <img
              key={slide.image}
              src={slide.image}
              alt=""
              aria-hidden={index !== slideIndex}
              className={`absolute inset-0 h-full w-full object-cover transition-all duration-1000 ease-out ${
                index === slideIndex ? 'scale-100 opacity-100' : 'scale-[1.025] opacity-0'
              }`}
            />
          ))}

          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/82 via-slate-950/30 to-slate-950/12" />
          <div className="absolute inset-0 bg-gradient-to-r from-slate-950/20 via-transparent to-slate-950/10" />

          <div className="absolute inset-0 z-10 flex items-center justify-center px-12 xl:px-16" dir={isAr ? 'rtl' : 'ltr'}>
            <div className="w-full max-w-5xl text-white">
              <div className="mx-auto max-w-3xl text-center">
                <p className="mb-3 text-sm font-black tracking-wide text-white/90">
                  {isAr ? 'نظام Premier لإدارة المطاعم' : 'Premier Restaurant Management System'}
                </p>
                <h1 className="text-4xl font-black leading-[1.12] tracking-tight drop-shadow-2xl xl:text-5xl">
                  {isAr ? activeSlide.titleAr : activeSlide.titleEn}
                </h1>
                <p className="mx-auto mt-3 max-w-2xl text-base font-semibold leading-7 text-white/90">
                  {isAr ? activeSlide.descriptionAr : activeSlide.descriptionEn}
                </p>
              </div>

              <div className="mx-auto mt-6 max-w-4xl">
                <RestaurantDevice preview={activeSlide.preview} isAr={isAr} />
              </div>

              <div className="mx-auto mt-5 grid max-w-3xl grid-cols-3 gap-3">
                {[
                  [BarChart3, isAr ? 'تقارير فورية' : 'Live reports'],
                  [UtensilsCrossed, isAr ? 'الصالة والمطبخ' : 'Dining & kitchen'],
                  [ShoppingCart, isAr ? 'نقطة بيع سريعة' : 'Fast POS'],
                ].map(([Icon, title]) => {
                  const FeatureIcon = Icon as typeof BarChart3;
                  return (
                    <div key={String(title)} className="rounded-2xl border border-white/20 bg-slate-950/35 px-4 py-3 backdrop-blur-md">
                      <div className="flex items-center justify-center gap-2">
                        <FeatureIcon className="h-4 w-4 text-blue-300" />
                        <p className="text-xs font-black">{String(title)}</p>
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
            className="absolute left-8 top-1/2 z-20 flex h-14 w-14 -translate-y-1/2 items-center justify-center rounded-full border border-white/30 bg-slate-950/35 text-white backdrop-blur-md transition hover:bg-slate-950/55"
          >
            <ChevronLeft className="h-7 w-7" />
          </button>

          <button
            type="button"
            aria-label={isAr ? 'الصورة التالية' : 'Next image'}
            onClick={() => goToSlide(slideIndex + 1)}
            className="absolute right-8 top-1/2 z-20 flex h-14 w-14 -translate-y-1/2 items-center justify-center rounded-full border border-white/30 bg-slate-950/35 text-white backdrop-blur-md transition hover:bg-slate-950/55"
          >
            <ChevronRight className="h-7 w-7" />
          </button>

          <div className="absolute inset-x-0 bottom-10 z-20 flex justify-center gap-3">
            {slides.map((slide, index) => (
              <button
                key={slide.image}
                type="button"
                aria-label={isAr ? `انتقل للصورة ${index + 1}` : `Go to image ${index + 1}`}
                onClick={() => goToSlide(index)}
                className={`h-3 rounded-full transition-all ${
                  index === slideIndex ? 'w-9 bg-blue-500' : 'w-3 bg-white/75 hover:bg-white'
                }`}
              />
            ))}
          </div>
        </section>

        <section
          className="relative z-30 flex min-h-screen items-center justify-center bg-white px-6 py-8 sm:px-10 lg:-ml-10 lg:rounded-l-[68px] lg:px-12 lg:shadow-[-28px_0_80px_-42px_rgba(15,23,42,0.55)] xl:px-16"
          dir={isAr ? 'rtl' : 'ltr'}
        >
          <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-blue-50/80 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 -left-10 h-72 w-72 rounded-full bg-slate-100 blur-3xl" />

          <div className="relative z-10 w-full max-w-[470px]">
            <div className="mb-8 flex items-center justify-between gap-4">
              <button
                data-testid="login-language-toggle"
                type="button"
                onClick={() => setLang(isAr ? 'en' : 'ar')}
                className="order-2 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-xs font-black text-slate-600 shadow-sm transition hover:border-blue-300 hover:text-blue-700"
              >
                {isAr ? 'English' : 'العربية'}
              </button>

              <div className="order-1">
                <Logo variant="horizontal" size={64} tone="navy" showTagline={false} />
              </div>
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

function RestaurantDevice({ preview, isAr }: { preview: LoginPreview; isAr: boolean }) {
  return (
    <div className="relative mx-auto h-[330px] w-full max-w-[820px] [perspective:1200px]">
      <div className="absolute inset-x-[-7%] bottom-0 h-24 rounded-[52%] bg-gradient-to-b from-[#9a6238] via-[#6c3f24] to-[#30190f] shadow-[0_28px_70px_rgba(0,0,0,0.42)]" />
      <div className="absolute inset-x-[4%] bottom-7 h-7 rounded-[50%] bg-black/35 blur-2xl" />

      {preview === 'pos' && (
        <>
          <div className="absolute bottom-12 left-[15%] w-[54%] [transform:rotateY(-4deg)]">
            <DeviceMonitor isAr={isAr} compact>
              <PosPreview isAr={isAr} />
            </DeviceMonitor>
          </div>
          <ReceiptPrinter isAr={isAr} className="absolute bottom-8 right-[14%]" />
          <CardTerminal className="absolute bottom-8 right-[5%]" />
        </>
      )}

      {preview === 'tables' && (
        <>
          <div className="absolute bottom-12 left-[8%] w-[47%] [transform:rotateY(4deg)]">
            <DeviceMonitor isAr={isAr} compact>
              <TablesPreview isAr={isAr} />
            </DeviceMonitor>
          </div>
          <HandheldDevice className="absolute bottom-10 right-[22%]" isAr={isAr} />
          <ReceiptPrinter isAr={isAr} className="absolute bottom-8 right-[7%]" />
        </>
      )}

      {preview === 'dashboard' && (
        <>
          <div className="absolute bottom-11 left-[10%] w-[56%]">
            <LaptopDevice isAr={isAr}>
              <DashboardPreview isAr={isAr} />
            </LaptopDevice>
          </div>
          <PhoneDevice className="absolute bottom-11 right-[19%]" />
          <CardTerminal className="absolute bottom-8 right-[6%]" />
        </>
      )}

      {preview === 'kitchen' && (
        <>
          <div className="absolute bottom-11 left-[12%] w-[58%] [transform:rotateY(-3deg)]">
            <DeviceMonitor isAr={isAr}>
              <KitchenPreview isAr={isAr} />
            </DeviceMonitor>
          </div>
          <HandheldDevice className="absolute bottom-10 right-[19%]" isAr={isAr} kitchen />
          <ReceiptPrinter isAr={isAr} className="absolute bottom-8 right-[6%]" />
        </>
      )}
    </div>
  );
}

function DeviceMonitor({ children, isAr, compact = false }: { children: React.ReactNode; isAr: boolean; compact?: boolean }) {
  return (
    <div className="relative">
      <div className="absolute -inset-3 rounded-[26px] bg-black/25 blur-xl" />
      <div className="relative rounded-[22px] border border-white/10 bg-[#111827] p-2.5 shadow-[0_24px_48px_rgba(0,0,0,0.5)]">
        <div className="overflow-hidden rounded-[14px] border border-slate-700 bg-slate-50">
          <div className="flex h-7 items-center justify-between border-b border-slate-200 bg-white px-2.5 text-[7px] font-bold text-slate-500">
            <div className="flex items-center gap-1.5">
              <span className="flex h-3.5 w-3.5 items-center justify-center rounded bg-blue-600 text-[6px] font-black text-white">P</span>
              <span>Premier</span>
            </div>
            <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">{isAr ? 'متصل' : 'Online'}</span>
          </div>
          <div className={compact ? "h-[170px] bg-slate-50" : "h-[186px] bg-slate-50"}>
            <div className="h-full origin-top-left scale-[0.78] overflow-hidden" style={{ width: '128.2%', height: '128.2%' }}>
              {children}
            </div>
          </div>
        </div>
      </div>
      <div className="mx-auto h-7 w-20 rounded-b-[16px] bg-gradient-to-b from-slate-900 to-slate-950" />
      <div className="mx-auto h-2.5 w-32 rounded-[50%] bg-slate-950/90" />
    </div>
  );
}

function LaptopDevice({ children, isAr }: { children: React.ReactNode; isAr: boolean }) {
  return (
    <div className="relative">
      <div className="rounded-t-[20px] border-[7px] border-slate-900 bg-slate-900 shadow-2xl">
        <div className="overflow-hidden rounded-[10px] bg-slate-50">
          <div className="flex h-6 items-center justify-between bg-white px-2 text-[7px] font-bold text-slate-500">
            <span>Premier</span><span>{isAr ? 'لوحة التحكم' : 'Dashboard'}</span>
          </div>
          <div className="h-[165px]">
            <div className="h-full origin-top-left scale-[0.72]" style={{ width: '138.9%', height: '138.9%' }}>{children}</div>
          </div>
        </div>
      </div>
      <div className="h-4 rounded-b-[60%] bg-gradient-to-b from-slate-300 to-slate-500 shadow-xl" />
    </div>
  );
}

function ReceiptPrinter({ isAr, className = '' }: { isAr: boolean; className?: string }) {
  return (
    <div className={`${className} w-16`}>
      <div className="rounded-t-xl bg-slate-900 p-2 shadow-xl">
        <div className="mx-auto h-1 w-10 rounded-full bg-slate-600" />
        <div className="mx-auto mt-2 h-9 w-11 rounded bg-white p-1 text-[4px] leading-tight text-slate-500 shadow">
          <p className="font-black text-slate-700">Premier</p>
          <p>#1042</p>
          <p>{isAr ? 'إجمالي' : 'Total'} 735.30</p>
        </div>
      </div>
    </div>
  );
}

function CardTerminal({ className = '' }: { className?: string }) {
  return (
    <div className={`${className} w-12 rotate-[4deg]`}>
      <div className="rounded-[13px] bg-slate-800 p-1.5 shadow-xl">
        <div className="h-8 rounded-lg bg-blue-500/20 p-1 text-[5px] text-blue-100">VISA<br/>735.30</div>
        <div className="mt-1 grid grid-cols-3 gap-0.5">{Array.from({length:9},(_,i)=><span key={i} className="h-1.5 rounded-sm bg-slate-600" />)}</div>
      </div>
    </div>
  );
}

function HandheldDevice({ className = '', isAr, kitchen = false }: { className?: string; isAr: boolean; kitchen?: boolean }) {
  return (
    <div className={`${className} w-[72px] rotate-[7deg]`}>
      <div className="rounded-[18px] border border-slate-700 bg-slate-950 p-1.5 shadow-2xl">
        <div className="overflow-hidden rounded-[13px] bg-white p-1.5 text-[5px] text-slate-700">
          <div className="mb-1 flex justify-between font-black"><span>Premier</span><span className="text-emerald-600">●</span></div>
          {kitchen ? (
            <div className="space-y-1">
              {['#2436','#2437','#2438'].map((x,i)=><div key={x} className="rounded bg-slate-100 p-1"><b>{x}</b><br/>{i+1} × Pancake</div>)}
            </div>
          ) : (
            <>
              <p className="font-black">{isAr ? 'الطاولات' : 'Tables'}</p>
              <div className="mt-1 grid grid-cols-2 gap-1">
                {Array.from({length:6},(_,i)=><div key={i} className={`rounded p-1 text-center ${i<2?'bg-blue-50 text-blue-700':'bg-emerald-50 text-emerald-700'}`}>{i+1}</div>)}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function PhoneDevice({ className = '' }: { className?: string }) {
  return (
    <div className={`${className} w-[66px] -rotate-[5deg]`}>
      <div className="rounded-[20px] bg-slate-950 p-1.5 shadow-2xl">
        <div className="rounded-[15px] bg-white p-2 text-[5px] text-slate-600">
          <p className="font-black text-blue-700">Premier</p>
          <p className="mt-1">Sales</p>
          <p className="text-[10px] font-black text-slate-900">18.4K</p>
          <div className="mt-1 flex h-10 items-end gap-0.5">{[2,4,3,6,5,8].map((h,i)=><span key={i} className="flex-1 rounded-t bg-blue-500" style={{height:`${h*4}px`}} />)}</div>
        </div>
      </div>
    </div>
  );
}

function PosPreview({ isAr }: { isAr: boolean }) {
  const products = [
    ['Pancake Nutella', '130'], ['Pancake Lotus', '120'], ['Seafood chowder', '250'],
    ['Club Sandwich', '170'], ['Tomato soup', '90'], ['Fries', '60'],
  ];
  return (
    <div className="grid h-full grid-cols-[34%_66%] text-[8px]" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="border-e border-slate-200 bg-white p-2">
        <div className="mb-2 rounded-lg bg-blue-50 p-2 text-xs font-black text-slate-800">{isAr ? 'طلب جديد' : 'New order'}</div>
        <div className="space-y-1.5">
          {products.slice(0, 4).map(([name, price], index) => (
            <div key={name} className="rounded-lg border border-slate-200 bg-slate-50 p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-black text-slate-700">{name}</span>
                <span className="font-black text-blue-700">{price}</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-slate-400"><span>{index + 1}</span><span>− 1 +</span></div>
            </div>
          ))}
        </div>
        <div className="mt-2 rounded-lg bg-blue-600 p-2 text-center font-black text-white">{isAr ? 'دفع' : 'Pay'} · 660</div>
      </div>
      <div className="p-2">
        <div className="mb-2 flex gap-1 overflow-hidden">
          {['الكل','Coffee','Burger','Dessert','Fries'].map((x,i)=><span key={x} className={`rounded-lg px-2 py-1 ${i===0?'bg-blue-600 text-white':'bg-white text-slate-500'}`}>{x}</span>)}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {products.map(([name, price], index) => (
            <div key={name} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className={`h-12 bg-gradient-to-br ${['from-orange-100 to-amber-300','from-rose-100 to-pink-300','from-emerald-100 to-lime-300'][index%3]}`} />
              <div className="p-2"><p className="truncate font-black text-slate-800">{name}</p><div className="mt-1 flex justify-between"><span className="font-black text-blue-700">{price}</span><span className="flex h-4 w-4 items-center justify-center rounded bg-blue-600 text-white">+</span></div></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TablesPreview({ isAr }: { isAr: boolean }) {
  return (
    <div className="h-full p-3 text-[8px]" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="mb-2 flex items-center justify-between">
        <div><p className="text-sm font-black text-slate-900">{isAr ? 'الطاولات' : 'Tables'}</p><p className="text-slate-400">{isAr ? 'اختر طاولة لفتح الطلب' : 'Choose a table to open an order'}</p></div>
        <span className="rounded-lg bg-blue-600 px-3 py-1.5 font-black text-white">{isAr ? 'طلب جديد +' : '+ New order'}</span>
      </div>
      <div className="mb-2 flex gap-2"><span className="rounded bg-blue-600 px-3 py-1 text-white">{isAr ? 'الكل 50' : 'All 50'}</span><span className="rounded bg-white px-3 py-1 text-slate-500">{isAr ? 'متاحة 44' : 'Available 44'}</span><span className="rounded bg-white px-3 py-1 text-slate-500">{isAr ? 'مشغولة 6' : 'Occupied 6'}</span></div>
      <div className="grid grid-cols-4 gap-2">
        {Array.from({length:12},(_,i)=>i+1).map((n)=>(
          <div key={n} className={`rounded-xl border p-2 ${n<=2?'border-blue-300 bg-blue-50':'border-emerald-300 bg-emerald-50'}`}>
            <div className="flex items-center justify-between"><span className="font-black text-slate-900">Table {String(n).padStart(2,'0')}</span><span className={n<=2?'text-blue-700':'text-emerald-700'}>{n<=2?(isAr?'بالمطبخ':'Kitchen'):(isAr?'متاحة':'Free')}</span></div>
            <div className="mt-4 text-slate-500">{n<=2 ? `${n*35} EGP · ${n+2} items` : (isAr?'اضغط لفتح طلب':'Tap to open')}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DashboardPreview({ isAr }: { isAr: boolean }) {
  const cards = [
    [isAr?'صافي المبيعات':'Net sales','566,671'],
    [isAr?'متوسط الفاتورة':'Avg ticket','625'],
    [isAr?'عدد الفواتير':'Invoices','936'],
    [isAr?'المصروفات':'Expenses','66,768'],
    [isAr?'المشتريات':'Purchases','244,443'],
    [isAr?'المرتجعات':'Returns','1,365'],
  ];
  return (
    <div className="h-full p-3 text-[8px]" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="mb-3"><p className="text-sm font-black text-slate-900">{isAr?'ملخص السنة':'Year summary'}</p><p className="text-slate-400">{isAr?'مؤشرات المبيعات والربحية':'Sales and profitability overview'}</p></div>
      <div className="grid grid-cols-3 gap-2">
        {cards.map(([label,value],i)=>(
          <div key={label} className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-center justify-between"><span className="text-slate-500">{label}</span><span className={`h-5 w-5 rounded-lg ${i%2?'bg-blue-50':'bg-emerald-50'}`} /></div>
            <p className="mt-3 text-base font-black text-slate-950">{value}</p>
            <p className="mt-1 text-slate-400">EGP</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function KitchenPreview({ isAr }: { isAr: boolean }) {
  return (
    <div className="h-full bg-slate-100 p-3 text-[8px]" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="mb-3 flex items-center justify-between">
        <div><p className="text-sm font-black text-slate-900">{isAr?'شاشة المطبخ':'Kitchen display'}</p><p className="text-slate-400">KDS · Live orders</p></div>
        <span className="rounded-lg bg-emerald-100 px-3 py-1 font-black text-emerald-700">{isAr?'متصل':'Online'}</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {Array.from({length:6},(_,i)=>(
          <div key={i} className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-center justify-between"><span className="font-black text-slate-900">#{2436+i}</span><span className={`rounded px-2 py-0.5 ${i<2?'bg-amber-100 text-amber-700':'bg-blue-100 text-blue-700'}`}>{i<2?(isAr?'جديد':'New'):(isAr?'تحضير':'Prep')}</span></div>
            <div className="mt-3 space-y-1 text-slate-600"><p>2 × Turkish Coffee</p><p>1 × Pancake Lotus</p><p>1 × Water</p></div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-500" style={{width:`${35+i*9}%`}} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}
}
