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

  const slides = useMemo(
    () => [
      '/auth/exact/login-art-1.webp',
      '/auth/exact/login-art-4.webp',
    ],
    [],
  );

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSlideIndex((value) => (value + 1) % slides.length);
    }, 5600);

    return () => window.clearInterval(timer);
  }, [slides.length]);

  useEffect(() => {
    const nextSlide = slides[(slideIndex + 1) % slides.length];
    const preload = new Image();
    preload.src = nextSlide;
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
    <DesignSurface testId="login-surface">
      <div className="min-h-[100dvh] bg-white text-slate-950 lg:grid lg:grid-cols-[56%_44%]" dir="ltr">
        <section className="relative hidden h-[100dvh] min-h-[680px] overflow-hidden bg-slate-950 lg:block">
          <img
            key={slides[slideIndex]}
            src={slides[slideIndex]}
            alt=""
            loading="eager"
            decoding="async"
            fetchPriority="high"
            draggable={false}
            className="absolute inset-0 h-full w-full object-cover object-center"
          />
        </section>

        <section
          className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-white px-6 py-8 sm:px-10 lg:border-s lg:border-slate-100 lg:px-12 xl:px-16"
          dir={isAr ? 'rtl' : 'ltr'}
        >
          <div className="relative z-10 w-full max-w-[470px]">
            <div className="mb-10 flex items-center justify-between gap-4">
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

            <div className="mb-8">
              <h1 className="text-4xl font-black tracking-tight text-slate-950">
                {isAr ? 'مرحبًا بعودتك' : 'Welcome back'}
              </h1>
              <p className="mt-3 text-base font-semibold leading-7 text-slate-500">
                {isAr ? 'سجّل دخولك إلى نظام Premier' : 'Sign in to Premier'}
              </p>
            </div>

            <div
              data-testid="login-mode-toggle"
              className="mb-6 grid grid-cols-2 rounded-2xl bg-slate-100 p-1"
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

            <div className="my-5 flex items-center gap-4">
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

          </div>
        </section>
      </div>
    </DesignSurface>
  );
}
