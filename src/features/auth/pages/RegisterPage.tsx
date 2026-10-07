import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2, Sparkles } from 'lucide-react';
import { supabase } from '@/api';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Logo } from '@/components/Logo';
import { useToast } from '@/components/Toast';
import { DesignSurface } from '@/components/design/DesignSurface';
import { APP_ROUTES } from '@/core/navigation/routes';
import {
  BUSINESS_PROFILE_KEYS,
  BUSINESS_PROFILE_PRESETS,
  type BusinessProfileKey,
} from '@/core/organizations/businessProfiles';

interface TrialRegistrationResult {
  success?: boolean;
  error?: string;
  detail?: string;
  trial_days?: number;
}

export function RegisterPage() {
  const { signIn } = useAuth();
  const { lang, setLang } = useLanguage();
  const { show } = useToast();
  const navigate = useNavigate();
  const isAr = lang === 'ar';

  const [storeName, setStoreName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [businessType, setBusinessType] = useState<BusinessProfileKey>('retail');
  const [loading, setLoading] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password.length < 6) {
      show(isAr ? 'كلمة المرور يجب أن تكون 6 أحرف على الأقل.' : 'Password must be at least 6 characters.', 'error');
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('register_trial_tenant', {
        p_store_name: storeName.trim(),
        p_owner_name: ownerName.trim(),
        p_email: email.trim().toLowerCase(),
        p_password: password,
        p_business_type: businessType,
        p_store_name_en: null,
        p_phone: phone.trim() || null,
        p_address: null,
        p_currency: 'EGP',
      });

      if (error) {
        show(isAr ? 'تعذر إنشاء الحساب. حاول مرة أخرى.' : 'Could not create the account. Please try again.', 'error');
        return;
      }

      const result = (data ?? {}) as TrialRegistrationResult;
      if (!result.success) {
        const messages: Record<string, { ar: string; en: string }> = {
          EMAIL_TAKEN: { ar: 'البريد الإلكتروني مستخدم بالفعل.', en: 'This email is already in use.' },
          INVALID_EMAIL: { ar: 'البريد الإلكتروني غير صحيح.', en: 'Invalid email address.' },
          WEAK_PASSWORD: { ar: 'كلمة المرور ضعيفة.', en: 'Password is too weak.' },
          MISSING_STORE_NAME: { ar: 'اسم المؤسسة مطلوب.', en: 'Business name is required.' },
          INVALID_BUSINESS_TYPE: { ar: 'نوع النشاط غير صحيح.', en: 'Invalid business type.' },
        };
        const message = messages[result.error || ''];
        show(message ? (isAr ? message.ar : message.en) : (isAr ? 'تعذر إنشاء الحساب.' : 'Registration failed.'), 'error');
        return;
      }

      const login = await signIn(email, password);
      if (login.error) {
        show(
          isAr
            ? 'تم إنشاء الحساب والتجربة المجانية. سجّل الدخول بالبريد وكلمة المرور.'
            : 'Your account and free trial were created. Sign in with your email and password.',
          'success',
        );
        navigate(APP_ROUTES.login, { replace: true });
        return;
      }

      show(isAr ? 'مرحبًا بك — بدأت تجربتك المجانية لمدة 14 يومًا.' : 'Welcome — your 14-day free trial has started.', 'success');
      navigate(APP_ROUTES.dashboard, { replace: true });
    } finally {
      setLoading(false);
    }
  };

  return (
    <DesignSurface testId="register-surface">
      <div className="min-h-screen bg-ui-page-alt dark:bg-navy-950 px-4 py-8">
        <div className="mx-auto max-w-2xl">
          <div className="mb-6 flex items-center justify-between">
            <Logo variant="horizontal" size={40} tone="navy" tagline={isAr ? 'منصة إدارة الأعمال' : 'Business Management Platform'} />
            <button
              type="button"
              onClick={() => setLang(isAr ? 'en' : 'ar')}
              className="rounded-xl border border-ui-border bg-ui-surface px-4 py-2 text-sm font-bold text-ui-muted"
            >
              {isAr ? 'English' : 'العربية'}
            </button>
          </div>

          <div className="rounded-3xl border border-ui-border bg-ui-surface p-6 shadow-xl md:p-8">
            <div className="mb-6">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-ui-primary-soft px-3 py-1 text-xs font-black text-ui-accent">
                <Sparkles className="h-4 w-4" />
                {isAr ? '14 يومًا مجانًا' : '14 days free'}
              </div>
              <h1 className="text-2xl font-black text-ui-text">
                {isAr ? 'أنشئ حساب مؤسستك' : 'Create your business account'}
              </h1>
              <p className="mt-2 text-sm font-medium text-ui-muted">
                {isAr
                  ? 'استخدم جميع الوحدات لمدة 14 يومًا. بعد انتهاء التجربة يستمر حسابك على شاشة البيع فقط دون حذف بياناتك.'
                  : 'Use all modules for 14 days. After the trial, your account continues with the sales screen only and your data is kept.'}
              </p>
            </div>

            <form onSubmit={submit} className="space-y-5">
              <Input
                id="register-store-name"
                label={isAr ? 'اسم المؤسسة' : 'Business name'}
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
                required
              />

              <div>
                <label htmlFor="register-business-type" className="mb-2 block text-sm font-bold text-ui-text">
                  {isAr ? 'نوع النشاط' : 'Business activity'}
                </label>
                <select
                  id="register-business-type"
                  value={businessType}
                  onChange={(e) => setBusinessType(e.target.value as BusinessProfileKey)}
                  className="h-12 w-full rounded-xl border border-ui-border bg-ui-surface px-3 text-sm font-bold text-ui-text outline-none focus:border-ui-primary"
                >
                  {BUSINESS_PROFILE_KEYS.filter((key) => key !== 'custom').map((key) => {
                    const preset = BUSINESS_PROFILE_PRESETS[key];
                    return <option key={key} value={key}>{isAr ? preset.ar : preset.en}</option>;
                  })}
                </select>
              </div>

              <Input
                id="register-owner-name"
                label={isAr ? 'اسم صاحب الحساب' : 'Owner name'}
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                required
              />
              <Input
                id="register-email"
                label={isAr ? 'البريد الإلكتروني' : 'Email'}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
              <Input
                id="register-phone"
                label={isAr ? 'رقم الهاتف (اختياري)' : 'Phone (optional)'}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                inputMode="tel"
              />
              <Input
                id="register-password"
                label={isAr ? 'كلمة المرور' : 'Password'}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
              />

              <Button data-testid="register-submit" type="submit" size="lg" className="w-full" disabled={loading}>
                {loading
                  ? <Loader2 className="h-5 w-5 animate-spin" />
                  : (isAr ? 'ابدأ التجربة المجانية' : 'Start free trial')}
              </Button>
            </form>

            <p className="mt-6 text-center text-sm text-ui-muted">
              {isAr ? 'لديك حساب بالفعل؟ ' : 'Already have an account? '}
              <Link to={APP_ROUTES.login} className="font-black text-ui-accent hover:underline">
                {isAr ? 'تسجيل الدخول' : 'Sign in'}
              </Link>
            </p>
          </div>
        </div>
      </div>
    </DesignSurface>
  );
}
