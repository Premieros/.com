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
    const triggerEl = triggerRef.current;
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
      else triggerEl?.focus();
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
      <div className="relative h-[100dvh] overflow-hidden bg-[#0f1412] text-[#ecf2ee]" dir={isAr ? 'rtl' : 'ltr'}>
        <AntigravityLoginHero isAr={isAr} />

        <header className="absolute inset-x-3 top-3 z-20 flex items-center justify-between gap-3 rounded-[26px] border border-white/10 bg-[#171d1a]/75 px-4 py-2.5 backdrop-blur-xl sm:inset-x-6 sm:px-6 sm:py-3">
          <Logo variant="horizontal" size={44} tone="white" showTagline={false} />
          <div className="flex items-center gap-2">
            <button data-testid="login-language-toggle" type="button" onClick={() => setLang(isAr ? 'en' : 'ar')}
              className="rounded-full border border-white/20 bg-white/5 px-4 py-2 text-xs font-bold text-white transition hover:bg-white/15">
              {isAr ? 'English' : 'العربية'}
            </button>
            <button data-testid="login-open-modal" type="button" ref={triggerRef} onClick={() => setOpen(true)}
              className="rounded-full bg-[#a8481c] px-5 py-2.5 text-xs font-bold text-[#fff7f2] shadow-lg shadow-[#a8481c]/30 transition hover:bg-[#b9531f]">
              {t('signIn')}
            </button>
          </div>
        </header>

        {open && (
          <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[#0b0f0d]/75 px-4 py-4 backdrop-blur-lg" onMouseDown={(event) => {
            if (event.target === event.currentTarget && !loading) setOpen(false);
          }}>
            <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="premier-login-title"
              data-testid="login-modal"
              className="relative my-auto w-full max-w-[430px] rounded-[30px] border border-white/15 bg-[#171d1a]/95 p-6 text-[#ecf2ee] shadow-[0_30px_100px_rgba(0,0,0,.65)] sm:p-7">
              <div className="mb-5 flex items-start justify-between gap-3">
                <Logo variant="horizontal" size={44} tone="white" showTagline={false} />
                <button type="button" aria-label={isAr ? 'إغلاق نافذة الدخول' : 'Close sign in dialog'}
                  onClick={() => !loading && setOpen(false)} disabled={loading}
                  className="rounded-full border border-white/15 bg-white/10 p-2 text-white hover:bg-white/20 disabled:opacity-50">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="mb-4">
                <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-[#ffa77a]/15 px-3 py-1 text-[11px] font-bold text-[#ffa77a]">
                  <ShieldCheck className="h-4 w-4" />{isAr ? 'بوابة دخول Premier الآمنة' : 'Premier secure sign-in'}
                </div>
                <h2 id="premier-login-title" className="text-2xl font-bold tracking-tight">{isAr ? 'مرحبًا بعودتك' : 'Welcome back'}</h2>
                <p className="mt-1 text-sm text-[#a8b4ad]">{isAr ? 'سجّل دخولك إلى نظام Premier' : 'Sign in to Premier'}</p>
              </div>
              <div data-testid="login-mode-toggle" className="mb-4 grid grid-cols-2 gap-1 rounded-full bg-white/10 p-1">
                <button type="button" onClick={() => setMode('pin')}
                  className={'rounded-full px-2 py-2.5 text-sm font-semibold transition ' + (mode === 'pin' ? 'bg-white text-[#18201b]' : 'text-[#a8b4ad] hover:text-white')}>
                  {t('loginWithPin')}
                </button>
                <button type="button" onClick={() => setMode('password')}
                  className={'rounded-full px-2 py-2.5 text-sm font-semibold transition ' + (mode === 'password' ? 'bg-white text-[#18201b]' : 'text-[#a8b4ad] hover:text-white')}>
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
                  className="!mt-4 !min-h-14 w-full !rounded-full !bg-[#a8481c] hover:!bg-[#b9531f] !text-base !font-bold !text-[#fff7f2] shadow-lg shadow-[#a8481c]/30"
                  disabled={loading}>
                  {loading ? <Loader2 className="h-5 w-5 animate-spin" /> :
                    <span className="inline-flex items-center gap-2">{t('signIn')}
                      {isAr ? <ArrowLeft className="h-5 w-5" /> : <ArrowRight className="h-5 w-5" />}
                    </span>}
                </Button>
              </form>
              <button type="button" onClick={() => setMode(mode === 'pin' ? 'password' : 'pin')}
                className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 text-sm font-semibold text-slate-100 transition hover:bg-white/10">
                <LockKeyhole className="h-4 w-4 text-[#ffa77a]" />
                {mode === 'pin' ? (isAr ? 'الدخول بالبريد الإلكتروني' : 'Sign in with email') : (isAr ? 'الدخول برمز الموظف' : 'Sign in with staff PIN')}
              </button>
              <Link data-testid="login-register-link" to={APP_ROUTES.register}
                className="mt-3 flex min-h-12 items-center justify-center gap-2 rounded-full border border-[#ffa77a]/30 bg-[#a8481c]/15 px-3 text-center text-sm font-bold text-[#ffd4be] transition hover:bg-[#a8481c]/25">
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
