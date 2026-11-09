import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Loader2, LockKeyhole, ShieldCheck, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Logo } from '@/components/Logo';
import { useToast } from '@/components/Toast';
import { DesignSurface } from '@/components/design/DesignSurface';
import { APP_ROUTES } from '@/core/navigation/routes';
import { AntigravityLoginHero } from '@/features/auth/components/AntigravityLoginHero';

export function LoginPage() {
  const { signIn, signInWithUsername } = useAuth();
  const { t, lang, setLang } = useLanguage();
  const { show } = useToast();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'pin' | 'password'>('pin');
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const isAr = lang === 'ar';

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const root = document.getElementById('root');
    const previous = {
      htmlOverflow: html.style.overflow, htmlHeight: html.style.height,
      bodyOverflow: body.style.overflow, bodyHeight: body.style.height,
      rootOverflow: root?.style.overflow ?? '', rootHeight: root?.style.height ?? '',
    };
    html.style.overflow = 'hidden';
    html.style.height = '100%';
    body.style.overflow = 'hidden';
    body.style.height = '100%';
    if (root) { root.style.overflow = 'hidden'; root.style.height = '100%'; }
    return () => {
      html.style.overflow = previous.htmlOverflow; html.style.height = previous.htmlHeight;
      body.style.overflow = previous.bodyOverflow; body.style.height = previous.bodyHeight;
      if (root) { root.style.overflow = previous.rootOverflow; root.style.height = previous.rootHeight; }
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const focusBefore = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLInputElement>('input')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !loading) { event.preventDefault(); setOpen(false); }
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled)'));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (focusBefore?.isConnected) focusBefore.focus();
      else triggerRef.current?.focus();
    };
  }, [open, loading]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'pin' && !/^\d{4}$/.test(pin)) { show(t('pinInvalid'), 'error'); return; }
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
        else msg = t('loginFailed') + ' ' + result.error.message;
        show(msg, 'error');
      }
    } finally { setLoading(false); }
  };

  const inputClass = '!border-white/20 !bg-white/10 !text-white !rounded-2xl !min-h-12 placeholder:!text-slate-400';

  return (
    <DesignSurface testId="login-surface" className="h-[100dvh] overflow-hidden !space-y-0">
      <div className="relative h-[100dvh] overflow-hidden bg-[#090517] text-white" dir={isAr ? 'rtl' : 'ltr'}>
        <AntigravityLoginHero isAr={isAr} />

        <header className="absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-3 border-b border-white/10 bg-[#0d071b]/60 px-4 py-3 backdrop-blur-xl sm:px-9 sm:py-5">
          <Logo variant="horizontal" size={48} tone="white" showTagline={false} />
          <div className="flex items-center gap-2">
            <button data-testid="login-language-toggle" type="button" onClick={() => setLang(isAr ? 'en' : 'ar')}
              className="rounded-full border border-white/20 bg-white/5 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-white/15">
              {isAr ? 'English' : 'العربية'}
            </button>
            <button data-testid="login-open-modal" type="button" ref={triggerRef} onClick={() => setOpen(true)}
              className="rounded-full bg-[#8054F6] px-5 py-2.5 text-xs font-extrabold text-white shadow-lg shadow-violet-800/40 transition hover:bg-[#946fff]">
              {t('signIn')}
            </button>
          </div>
        </header>

        {open && (
          <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[#05020d]/75 px-4 py-4 backdrop-blur-lg" onMouseDown={(event) => {
            if (event.target === event.currentTarget && !loading) setOpen(false);
          }}>
            <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="premier-login-title"
              data-testid="login-modal"
              className="relative my-auto w-full max-w-[455px] rounded-[30px] border border-white/15 bg-[#140d28]/95 p-5 text-white shadow-[0_30px_100px_rgba(0,0,0,.65)] sm:p-7">
              <div className="mb-5 flex items-start justify-between gap-3">
                <Logo variant="horizontal" size={48} tone="white" showTagline={false} />
                <button type="button" aria-label={isAr ? 'إغلاق نافذة الدخول' : 'Close sign in dialog'}
                  onClick={() => !loading && setOpen(false)} disabled={loading}
                  className="rounded-full border border-white/15 bg-white/10 p-2 text-white hover:bg-white/20 disabled:opacity-50">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="mb-4">
                <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-violet-500/15 px-3 py-1.5 text-[11px] font-bold text-violet-200">
                  <ShieldCheck className="h-4 w-4" />{isAr ? 'بوابة دخول Premier الآمنة' : 'Premier secure sign-in'}
                </div>
                <h2 id="premier-login-title" className="text-3xl font-black">{isAr ? 'مرحبًا بعودتك' : 'Welcome back'}</h2>
                <p className="mt-1 text-sm text-slate-300">{isAr ? 'سجّل دخولك إلى نظام Premier' : 'Sign in to Premier'}</p>
              </div>
              <div data-testid="login-mode-toggle" className="mb-4 grid grid-cols-2 gap-1 rounded-2xl bg-white/10 p-1">
                <button type="button" onClick={() => setMode('pin')}
                  className={'rounded-xl px-2 py-3 text-sm font-bold transition ' + (mode === 'pin' ? 'bg-white text-[#221339]' : 'text-slate-200 hover:bg-white/10')}>
                  {t('loginWithPin')}
                </button>
                <button type="button" onClick={() => setMode('password')}
                  className={'rounded-xl px-2 py-3 text-sm font-bold transition ' + (mode === 'password' ? 'bg-white text-[#221339]' : 'text-slate-200 hover:bg-white/10')}>
                  {t('loginWithEmail')}
                </button>
              </div>
              <form data-testid="login-form" onSubmit={handleSubmit} className="space-y-3">
                {mode === 'pin' ? (
                  <>
                    <div className="[&_label]:!text-slate-200"><Input id="login-username" className={inputClass} label={t('username')}
                      value={username} onChange={(e) => setUsername(e.target.value)} required autoComplete="username" /></div>
                    <div className="[&_label]:!text-slate-200"><Input id="login-pin" className={inputClass} label={t('pin')} type="password"
                      value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                      required inputMode="numeric" maxLength={4} placeholder="••••" /></div>
                  </>
                ) : (
                  <>
                    <div className="[&_label]:!text-slate-200"><Input id="login-email" className={inputClass} label={t('email')}
                      type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></div>
                    <div className="[&_label]:!text-slate-200"><Input id="login-password" className={inputClass} label={t('password')}
                      type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                      required minLength={6} autoComplete="current-password" /></div>
                  </>
                )}
                <Button data-testid="login-submit" type="submit" size="lg"
                  className="!mt-4 !min-h-14 w-full !rounded-2xl !bg-[#8054F6] !text-base !font-bold !text-white shadow-lg shadow-violet-900/30"
                  disabled={loading}>
                  {loading ? <Loader2 className="h-5 w-5 animate-spin" /> :
                    <span className="inline-flex items-center gap-2">{t('signIn')}
                      {isAr ? <ArrowLeft className="h-5 w-5" /> : <ArrowRight className="h-5 w-5" />}
                    </span>}
                </Button>
              </form>
              <button type="button" onClick={() => setMode(mode === 'pin' ? 'password' : 'pin')}
                className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/5 px-3 text-sm font-semibold text-slate-100 transition hover:bg-white/10">
                <LockKeyhole className="h-4 w-4 text-violet-300" />
                {mode === 'pin' ? (isAr ? 'الدخول بالبريد الإلكتروني' : 'Sign in with email') : (isAr ? 'الدخول برمز الموظف' : 'Sign in with staff PIN')}
              </button>
              <Link data-testid="login-register-link" to={APP_ROUTES.register}
                className="mt-4 flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-violet-300/30 bg-violet-500/10 px-3 text-center text-sm font-bold text-violet-100 transition hover:bg-violet-500/20">
                {isAr ? 'أنشئ مؤسستك الآن — 14 يومًا مجانًا' : 'Create your business — 14 days free'}
                {isAr ? <ArrowLeft className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
              </Link>
              <p className="mt-3 text-center text-[11px] text-slate-400">premier.os © 2026</p>
            </div>
          </div>
        )}
      </div>
    </DesignSurface>
  );
}
