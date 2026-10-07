import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Building2,
  CheckCircle2,
  ClipboardList,
  Loader2,
  LockKeyhole,
  PackageSearch,
  Play,
  ShoppingCart,
  Sparkles,
  UtensilsCrossed,
  WalletCards,
  X,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Logo } from '@/components/Logo';
import { useToast } from '@/components/Toast';
import { DesignSurface } from '@/components/design/DesignSurface';
import { APP_ROUTES } from '@/core/navigation/routes';

type SceneKey = 'pos' | 'food' | 'management' | 'analytics' | 'reports';

const sceneIcons = {
  pos: ShoppingCart,
  food: UtensilsCrossed,
  management: Building2,
  analytics: BarChart3,
  reports: ClipboardList,
} satisfies Record<SceneKey, typeof ShoppingCart>;

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
  const [loginOpen, setLoginOpen] = useState(false);
  const [sceneIndex, setSceneIndex] = useState(0);
  const isAr = lang === 'ar';

  const scenes = useMemo(() => ([
    {
      key: 'pos' as const,
      title: isAr ? 'نقطة بيع أسرع وأكثر مرونة' : 'A faster, more flexible point of sale',
      description: isAr
        ? 'بيع، دفع، شفتات، وطباعة فواتير في تجربة واحدة سريعة.'
        : 'Sales, payments, shifts, and receipts in one fast experience.',
      badge: isAr ? 'نقطة البيع' : 'Point of Sale',
    },
    {
      key: 'food' as const,
      title: isAr ? 'تشغيل المطعم من الطلب حتى التقديم' : 'Restaurant operations from order to service',
      description: isAr
        ? 'طلبات، مطبخ، طاولات، تجهيز، وهالك ضمن دورة تشغيل مترابطة.'
        : 'Orders, kitchen, tables, preparation, and waste in one connected workflow.',
      badge: isAr ? 'المطاعم والمطبخ' : 'Restaurant & Kitchen',
    },
    {
      key: 'management' as const,
      title: isAr ? 'إدارة الفروع والمستخدمين من مكان واحد' : 'Manage branches and teams from one place',
      description: isAr
        ? 'صلاحيات، فروع، موظفون، عمليات يومية، ومتابعة تشغيل المؤسسة.'
        : 'Permissions, branches, employees, daily operations, and organization control.',
      badge: isAr ? 'الإدارة والتشغيل' : 'Management',
    },
    {
      key: 'analytics' as const,
      title: isAr ? 'حلّل مبيعاتك واتخذ القرار الصحيح' : 'Analyze sales and make better decisions',
      description: isAr
        ? 'مؤشرات لحظية، مقارنة الفروع، الأصناف الأعلى أداءً، وربحية أوضح.'
        : 'Live KPIs, branch comparisons, top products, and clearer profitability.',
      badge: isAr ? 'تحليل المبيعات' : 'Sales Analytics',
    },
    {
      key: 'reports' as const,
      title: isAr ? 'تقارير دقيقة ورؤية مالية أوضح' : 'Accurate reports and clearer financial insight',
      description: isAr
        ? 'تقارير تشغيلية ومالية ومخزون ومصروفات قابلة للتصفية والتصدير.'
        : 'Operational, financial, inventory, and expense reporting with filters and exports.',
      badge: isAr ? 'التقارير الذكية' : 'Smart Reports',
    },
  ]), [isAr]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSceneIndex((value) => (value + 1) % scenes.length);
    }, 5500);
    return () => window.clearInterval(timer);
  }, [scenes.length]);

  useEffect(() => {
    if (!loginOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLoginOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [loginOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'pin' && !/^\d{4}$/.test(pin)) {
      show(t('pinInvalid'), 'error');
      return;
    }
    setLoading(true);
    try {
      const result = mode === 'pin' ? await signInWithUsername(username, pin) : await signIn(email, password);
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

  const activeScene = scenes[sceneIndex];
  const SceneIcon = sceneIcons[activeScene.key];

  return (
    <DesignSurface testId="login-surface">
      <div className="login-showcase min-h-screen overflow-hidden bg-[#f7fbff] text-slate-950">
        <header className="relative z-30 mx-auto flex max-w-[1500px] items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-10">
          <Logo
            variant="horizontal"
            size={52}
            tone="navy"
            tagline={isAr ? 'منصة إدارة الأعمال' : 'Business Management Platform'}
          />

          <div className="flex items-center gap-2">
            <button
              data-testid="login-language-toggle"
              type="button"
              onClick={() => setLang(isAr ? 'en' : 'ar')}
              className="rounded-full border border-blue-100 bg-white/90 px-4 py-2 text-xs font-black text-slate-600 shadow-sm transition hover:border-blue-300 hover:text-blue-700"
            >
              {isAr ? 'English' : 'العربية'}
            </button>
            <button
              data-testid="open-login-modal"
              type="button"
              onClick={() => setLoginOpen(true)}
              className="rounded-full bg-blue-600 px-5 py-2.5 text-sm font-black text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700"
            >
              {isAr ? 'تسجيل الدخول' : 'Sign in'}
            </button>
          </div>
        </header>

        <main className="relative mx-auto grid min-h-[calc(100vh-86px)] max-w-[1500px] items-center gap-8 px-4 pb-8 sm:px-6 lg:grid-cols-[0.95fr_1.05fr] lg:px-10">
          <div className="relative z-10 max-w-2xl py-8 lg:py-16">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-blue-100 bg-white px-4 py-2 text-xs font-black text-blue-700 shadow-sm">
              <Sparkles className="h-4 w-4" />
              {isAr ? 'منصة واحدة لإدارة مؤسستك' : 'One platform to run your business'}
            </div>

            <h1 className="text-4xl font-black leading-[1.08] tracking-tight text-slate-950 sm:text-5xl xl:text-6xl">
              {isAr ? 'أدر مؤسستك من شاشة واحدة' : 'Run your business from one screen'}
            </h1>
            <p className="mt-5 max-w-xl text-base font-semibold leading-8 text-slate-600 sm:text-lg">
              {isAr
                ? 'نقطة بيع، مخزون، تشغيل، تحليل مبيعات، محاسبة، وتقارير متعددة الفروع ضمن تجربة واحدة متكاملة.'
                : 'Point of sale, inventory, operations, sales analytics, accounting, and multi-branch reporting in one connected experience.'}
            </p>

            <div className="mt-7 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setLoginOpen(true)}
                className="inline-flex min-h-12 items-center gap-2 rounded-2xl bg-blue-600 px-6 text-sm font-black text-white shadow-xl shadow-blue-600/20 transition hover:-translate-y-0.5 hover:bg-blue-700"
              >
                {isAr ? 'دخول النظام' : 'Enter platform'}
                {isAr ? <ArrowLeft className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
              </button>
              <Link
                data-testid="login-register-link"
                to={APP_ROUTES.register}
                className="inline-flex min-h-12 items-center gap-2 rounded-2xl border border-blue-200 bg-white px-6 text-sm font-black text-blue-700 shadow-sm transition hover:border-blue-300 hover:bg-blue-50"
              >
                <Play className="h-4 w-4" />
                {isAr ? 'ابدأ 14 يومًا مجانًا' : 'Start 14 days free'}
              </Link>
            </div>

            <div className="mt-8 grid max-w-2xl grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                [ShoppingCart, isAr ? 'نقطة بيع' : 'POS'],
                [Building2, isAr ? 'إدارة الفروع' : 'Branches'],
                [BarChart3, isAr ? 'تحليل المبيعات' : 'Analytics'],
                [ClipboardList, isAr ? 'التقارير' : 'Reports'],
              ].map(([Icon, label]) => {
                const FeatureIcon = Icon as typeof ShoppingCart;
                return (
                  <div key={String(label)} className="rounded-2xl border border-blue-100 bg-white/90 p-4 shadow-sm">
                    <FeatureIcon className="mb-3 h-5 w-5 text-blue-600" />
                    <p className="text-xs font-black text-slate-700">{String(label)}</p>
                  </div>
                );
              })}
            </div>
          </div>

          <section className="relative z-10 min-h-[500px] lg:min-h-[650px]">
            <div className="absolute inset-0 rounded-[42px] bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-950 shadow-2xl shadow-blue-950/20" />
            <div className="absolute -start-10 top-8 h-48 w-48 rounded-full bg-cyan-300/20 blur-3xl" />
            <div className="absolute -end-10 bottom-8 h-56 w-56 rounded-full bg-violet-400/20 blur-3xl" />

            <div className="relative flex min-h-[500px] flex-col justify-between overflow-hidden rounded-[42px] border border-white/15 p-6 text-white sm:p-8 lg:min-h-[650px] lg:p-10">
              <div className="flex items-center justify-between gap-3">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-black backdrop-blur">
                  <SceneIcon className="h-4 w-4" />
                  {activeScene.badge}
                </div>
                <div className="flex gap-1.5">
                  {scenes.map((scene, index) => (
                    <button
                      key={scene.key}
                      type="button"
                      aria-label={scene.badge}
                      onClick={() => setSceneIndex(index)}
                      className={`h-2.5 rounded-full transition-all ${index === sceneIndex ? 'w-8 bg-white' : 'w-2.5 bg-white/35'}`}
                    />
                  ))}
                </div>
              </div>

              <div className="relative my-6 flex flex-1 items-center justify-center">
                <div key={activeScene.key} className="login-scene-stage">
                  {activeScene.key === 'pos' && <PosScene />}
                  {activeScene.key === 'food' && <FoodScene />}
                  {activeScene.key === 'management' && <ManagementScene />}
                  {activeScene.key === 'analytics' && <AnalyticsScene />}
                  {activeScene.key === 'reports' && <ReportsScene />}
                </div>
              </div>

              <div className="max-w-xl">
                <h2 className="text-2xl font-black sm:text-3xl">{activeScene.title}</h2>
                <p className="mt-3 text-sm font-semibold leading-7 text-blue-100 sm:text-base">{activeScene.description}</p>
              </div>
            </div>
          </section>

          <div className="pointer-events-none absolute inset-x-0 bottom-0 -z-0 h-56 bg-gradient-to-t from-blue-50 to-transparent" />
        </main>
      </div>

      {loginOpen && (
        <div
          data-testid="login-modal"
          className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setLoginOpen(false);
          }}
        >
          <div className="relative w-full max-w-md overflow-hidden rounded-[30px] border border-blue-100 bg-white p-6 shadow-2xl sm:p-8">
            <button
              type="button"
              aria-label={isAr ? 'إغلاق' : 'Close'}
              onClick={() => setLoginOpen(false)}
              className="absolute end-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="mb-6">
              <Logo variant="horizontal" size={42} tone="navy" showTagline={false} />
              <div className="mt-6 flex items-center gap-2">
                <LockKeyhole className="h-5 w-5 text-blue-600" />
                <h2 className="text-2xl font-black text-slate-950">{isAr ? 'مرحبًا بك' : 'Welcome back'}</h2>
              </div>
              <p className="mt-2 text-sm font-semibold text-slate-500">
                {isAr ? 'سجّل دخولك للوصول إلى Premier.' : 'Sign in to access Premier.'}
              </p>
            </div>

            <div data-testid="login-mode-toggle" className="mb-5 flex rounded-2xl bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setMode('pin')}
                className={`flex-1 rounded-xl py-2.5 text-sm font-black transition ${mode === 'pin' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500'}`}
              >
                {t('loginWithPin')}
              </button>
              <button
                type="button"
                onClick={() => setMode('password')}
                className={`flex-1 rounded-xl py-2.5 text-sm font-black transition ${mode === 'password' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500'}`}
              >
                {t('loginWithEmail')}
              </button>
            </div>

            <form data-testid="login-form" onSubmit={handleSubmit} className="space-y-4">
              {mode === 'pin' ? (
                <>
                  <Input id="login-username" label={t('username')} value={username} onChange={(e) => setUsername(e.target.value)} required autoComplete="username" />
                  <Input id="login-pin" label={t('pin')} type="password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} required inputMode="numeric" maxLength={4} placeholder="••••" />
                </>
              ) : (
                <>
                  <Input id="login-email" label={t('email')} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
                  <Input id="login-password" label={t('password')} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} autoComplete="current-password" />
                </>
              )}

              <Button data-testid="login-submit" type="submit" size="lg" className="w-full" disabled={loading}>
                {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : t('signIn')}
              </Button>
            </form>

            <div className="mt-5 rounded-2xl bg-blue-50 p-4 text-center">
              <p className="text-sm font-black text-slate-800">{isAr ? 'ليس لديك حساب؟' : 'New to Premier?'}</p>
              <Link to={APP_ROUTES.register} className="mt-2 inline-flex font-black text-blue-700 hover:underline">
                {isAr ? 'ابدأ التجربة المجانية' : 'Start your free trial'}
              </Link>
            </div>
          </div>
        </div>
      )}
    </DesignSurface>
  );
}

function PosScene() {
  return (
    <div className="relative h-[300px] w-[300px] sm:h-[360px] sm:w-[390px]">
      <div className="login-float-card absolute inset-x-4 top-6 rounded-3xl bg-white p-4 text-slate-900 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div className="h-3 w-24 rounded-full bg-blue-100" />
          <div className="rounded-full bg-emerald-100 px-3 py-1 text-[10px] font-black text-emerald-700">LIVE POS</div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {[1,2,3,4,5,6].map((item) => <div key={item} className="aspect-square rounded-2xl bg-gradient-to-br from-blue-50 to-slate-100 p-2"><div className="h-full rounded-xl bg-white shadow-sm" /></div>)}
        </div>
      </div>
      <div className="login-float-card-delayed absolute bottom-1 end-0 rounded-2xl bg-slate-950 px-5 py-4 shadow-xl">
        <p className="text-[10px] font-bold text-slate-400">TOTAL</p>
        <p className="text-2xl font-black text-white">1,248.50</p>
      </div>
    </div>
  );
}

function FoodScene() {
  return (
    <div className="relative h-[300px] w-[320px] sm:h-[360px] sm:w-[420px]">
      <div className="login-food-orbit absolute start-4 top-8 h-36 w-36 rounded-full bg-gradient-to-br from-amber-300 via-orange-400 to-rose-500 shadow-2xl">
        <div className="absolute inset-4 rounded-full border-[10px] border-amber-100/90 bg-orange-600 shadow-inner" />
        <div className="absolute start-1/2 top-1/2 h-5 w-20 -translate-x-1/2 -translate-y-1/2 rotate-12 rounded-full bg-emerald-400" />
      </div>
      <div className="login-food-orbit-delayed absolute end-4 bottom-8 h-32 w-32 rounded-[38%] bg-gradient-to-br from-yellow-200 via-yellow-400 to-amber-600 shadow-2xl">
        <div className="absolute inset-x-3 top-5 h-8 rounded-full bg-emerald-500" />
        <div className="absolute inset-x-3 bottom-5 h-8 rounded-full bg-rose-500" />
      </div>
      <div className="absolute start-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-white/20 bg-white/10 px-5 py-4 text-center backdrop-blur">
        <UtensilsCrossed className="mx-auto h-8 w-8" />
        <p className="mt-2 text-sm font-black">KDS • TABLES • ORDERS</p>
      </div>
    </div>
  );
}

function ManagementScene() {
  return (
    <div className="grid w-[320px] grid-cols-2 gap-4 sm:w-[420px]">
      {[
        [Building2, 'Branches', '08'],
        [PackageSearch, 'Inventory', '94%'],
        [WalletCards, 'Payments', '128'],
        [CheckCircle2, 'Approvals', '12'],
      ].map(([Icon, label, value], index) => {
        const CardIcon = Icon as typeof Building2;
        return (
          <div key={String(label)} className={`login-float-card rounded-3xl bg-white p-5 text-slate-900 shadow-2xl ${index % 2 ? 'translate-y-7' : ''}`}>
            <CardIcon className="h-6 w-6 text-blue-600" />
            <p className="mt-5 text-xs font-bold text-slate-500">{String(label)}</p>
            <p className="mt-1 text-2xl font-black">{String(value)}</p>
          </div>
        );
      })}
    </div>
  );
}

function AnalyticsScene() {
  return (
    <div className="w-[320px] rounded-[32px] bg-white p-6 text-slate-900 shadow-2xl sm:w-[430px]">
      <div className="flex items-end gap-3">
        {[38,62,48,78,66,96,82].map((height, index) => (
          <div key={index} className="flex-1">
            <div className="login-chart-bar rounded-t-xl bg-gradient-to-t from-blue-700 to-cyan-400" style={{ height: `${height * 1.65}px`, animationDelay: `${index * 90}ms` }} />
          </div>
        ))}
      </div>
      <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4">
        <div>
          <p className="text-[10px] font-bold text-slate-400">SALES GROWTH</p>
          <p className="text-2xl font-black text-emerald-600">+24.8%</p>
        </div>
        <BarChart3 className="h-9 w-9 text-blue-600" />
      </div>
    </div>
  );
}

function ReportsScene() {
  return (
    <div className="relative h-[320px] w-[320px] sm:w-[420px]">
      {[0,1,2].map((index) => (
        <div
          key={index}
          className="login-report-sheet absolute start-1/2 top-1/2 w-[280px] -translate-x-1/2 -translate-y-1/2 rounded-3xl bg-white p-5 text-slate-900 shadow-2xl sm:w-[360px]"
          style={{ transform: `translate(-50%, -50%) translate(${index * 10}px, ${index * 13}px) rotate(${(index - 1) * 2}deg)`, animationDelay: `${index * 140}ms` }}
        >
          <div className="mb-4 flex items-center justify-between">
            <div className="h-3 w-28 rounded-full bg-slate-200" />
            <ClipboardList className="h-5 w-5 text-blue-600" />
          </div>
          <div className="space-y-3">
            {[70,92,58,84].map((width) => <div key={width} className="h-3 rounded-full bg-blue-50" style={{ width: `${width}%` }} />)}
          </div>
        </div>
      ))}
    </div>
  );
}
