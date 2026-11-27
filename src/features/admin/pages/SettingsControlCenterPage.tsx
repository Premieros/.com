import { useEffect, useState, useCallback } from 'react';
import {
  Palette,
  Languages,
  Store,
  Users,
  ShieldAlert,
  Sparkles,
  Save,
  Loader2,
  CalendarClock,
  Percent,
  LockKeyhole,
  Unlock,
  Boxes,
  CheckCircle2,
  AlertTriangle,
  Landmark,
  Smartphone,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useTheme } from '@/context/ThemeContext';
import { useAuth } from '@/context/AuthContext';
import { useSettings } from '@/context/SettingsContext';
import { useBranches } from '@/hooks/useBranches';
import { useToast } from '@/components/Toast';
import { Card, PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/Button';
import { Input, Select, Textarea } from '@/components/Input';
import { logAudit } from '@/lib/audit';
import { findUiTheme, UI_THEMES } from '@/lib/themes';
import type { BranchSettings } from '@/lib/types';
import { APP_ROUTES } from '@/core/navigation/routes';

type SettingsTab = 'branch_profile' | 'tax' | 'business_day' | 'inventory' | 'payments' | 'branch_staff' | 'appearance' | 'language';

interface UserRow {
  id: string;
  full_name: string;
  email: string;
  role: string;
  is_active: boolean;
}

export function SettingsControlCenterPage() {
  const { user } = useAuth();
  const { t, lang, setLang, languageLocked, lockLanguagePreference, unlockLanguagePreference } = useLanguage();
  const { theme, setTheme, setUiTheme } = useTheme();
  const { settings, branchSettingsMap, saveBranchSettings } = useSettings();
  const { branches } = useBranches();
  const { show } = useToast();
  const isAr = lang === 'ar';

  const isSuperAdmin = user?.role === 'super_admin';

  const [active, setActive] = useState<SettingsTab>('branch_profile');
  const [saving, setSaving] = useState(false);

  const myBranchId = user?.branch_id || (branches[0]?.id ?? '');
  const [selectedBranchId, setSelectedBranchId] = useState<string>(myBranchId);
  const [branchForm, setBranchForm] = useState<Partial<BranchSettings>>({});

  const [branchStaff, setBranchStaff] = useState<UserRow[]>([]);
  const [loadingStaff, setLoadingStaff] = useState(false);

  const targetBranchId = selectedBranchId || myBranchId;
  useEffect(() => {
    if (targetBranchId) {
      const row = branchSettingsMap[targetBranchId] || null;
      setBranchForm({
        branch_id: targetBranchId,
        receipt_header: row?.receipt_header ?? '',
        receipt_footer: row?.receipt_footer ?? '',
        logo_url: row?.logo_url ?? '',
        tax_rate: row?.tax_rate ?? null,
        tax_enabled: row?.tax_enabled ?? null,
        currency: row?.currency ?? '',
        low_stock_threshold: row?.low_stock_threshold ?? null,
        allow_negative_stock: row?.allow_negative_stock,
        business_day_mode: row?.business_day_mode ?? 'fixed_time',
        business_day_start: row?.business_day_start ?? '00:00',
        business_day_end: row?.business_day_end ?? '00:00',
        auto_close_shift_at_day_end: row?.auto_close_shift_at_day_end ?? false,
        manual_transfer_enabled: row?.manual_transfer_enabled ?? false,
        instapay_handle: row?.instapay_handle ?? '',
        bank_transfer_details: row?.bank_transfer_details ?? '',
      });
    }
  }, [targetBranchId, branchSettingsMap]);

  const loadBranchStaff = useCallback(async () => {
    if (!targetBranchId) return;
    setLoadingStaff(true);
    const { data, error } = await supabase
      .from('users')
      .select('id, full_name, email, role, is_active')
      .eq('branch_id', targetBranchId)
      .order('full_name');
    setLoadingStaff(false);
    if (!error && data) {
      setBranchStaff(data as UserRow[]);
    }
  }, [targetBranchId]);

  useEffect(() => {
    if (active === 'branch_staff') void loadBranchStaff();
  }, [active, loadBranchStaff]);

  const pickTheme = (key: string) => {
    const p = findUiTheme(key);
    if (!p) return;
    setUiTheme(key);
    setTheme(p.mode);
  };

  const saveBranchSpecific = async () => {
    if (!targetBranchId) return;
    setSaving(true);
    const patch: Partial<BranchSettings> = {
      receipt_header: branchForm.receipt_header || null,
      receipt_footer: branchForm.receipt_footer || null,
      logo_url: branchForm.logo_url || null,
      tax_rate: branchForm.tax_rate != null && !Number.isNaN(branchForm.tax_rate) ? branchForm.tax_rate : null,
      tax_enabled: branchForm.tax_enabled ?? null,
      currency: branchForm.currency || null,
      low_stock_threshold:
        branchForm.low_stock_threshold != null && !Number.isNaN(branchForm.low_stock_threshold)
          ? branchForm.low_stock_threshold
          : null,
      allow_negative_stock: branchForm.allow_negative_stock,
      business_day_mode: branchForm.business_day_mode || 'fixed_time',
      business_day_start: branchForm.business_day_start || '00:00',
      business_day_end: branchForm.business_day_end || '00:00',
      auto_close_shift_at_day_end: branchForm.auto_close_shift_at_day_end ?? false,
      manual_transfer_enabled: branchForm.manual_transfer_enabled ?? false,
      instapay_handle: branchForm.instapay_handle?.trim() || null,
      bank_transfer_details: branchForm.bank_transfer_details?.trim() || null,
    };
    const ok = await saveBranchSettings(targetBranchId, patch);
    if (ok) {
      await logAudit('update', 'branch_settings', targetBranchId);
      show(isAr ? 'تم حفظ إعدادات الفرع بنجاح' : 'Branch settings saved successfully', 'success');
    } else {
      show(isAr ? 'فشل حفظ إعدادات الفرع' : 'Failed to save branch settings', 'error');
    }
    setSaving(false);
  };

  const SECTIONS: { key: SettingsTab; label: string; icon: React.ReactNode }[] = [
    { key: 'branch_profile', label: isAr ? 'بيانات الفرع والطباعة' : 'Branch Profile & Receipts', icon: <Store className="w-4 h-4" /> },
    { key: 'tax', label: isAr ? 'الضريبة' : 'Tax', icon: <Percent className="w-4 h-4" /> },
    { key: 'business_day', label: isAr ? 'اليوم المالي والشفتات' : 'Business Day & Shifts', icon: <CalendarClock className="w-4 h-4" /> },
    { key: 'inventory', label: isAr ? 'المخزون والبيع بالسالب' : 'Inventory & Negative Stock', icon: <Boxes className="w-4 h-4" /> },
    { key: 'payments', label: isAr ? 'InstaPay والتحويل البنكي' : 'InstaPay & Bank Transfer', icon: <Landmark className="w-4 h-4" /> },
    { key: 'branch_staff', label: isAr ? 'طاقم عمل الفرع' : 'Branch Staff', icon: <Users className="w-4 h-4" /> },
    { key: 'appearance', label: isAr ? 'المظهر والثيم' : 'Appearance & Theme', icon: <Palette className="w-4 h-4" /> },
    { key: 'language', label: isAr ? 'اللغة والتوطين' : 'Language', icon: <Languages className="w-4 h-4" /> },
  ];

  return (
    <div className="space-y-6">
      {isSuperAdmin && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl bg-gradient-to-r from-brand-600/15 via-indigo-600/10 to-transparent border border-brand-500/30">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white shadow-sm">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div>
              <p className="font-bold text-sm text-ui-text">
                {isAr ? 'أنت مسجل بصلاحية المدير العام (Super Admin)' : 'You are logged in as Super Admin'}
              </p>
              <p className="text-xs text-ui-subtle">
                {isAr
                  ? 'لإدارة إعدادات المنشأة المركزية، المنظمات، والصلاحيات الكاملة، تفضل بزيارة لوحة المدير العام'
                  : 'Manage master enterprise settings, tenant organizations, and the full RBAC matrix in the Super Admin hub'}
              </p>
            </div>
          </div>
          <Link to={APP_ROUTES.superAdmin}>
            <Button size="sm" className="whitespace-nowrap">
              <Sparkles className="w-4 h-4" />
              <span>{isAr ? 'لوحة تحكم المدير العام' : 'Super Admin Hub'}</span>
            </Button>
          </Link>
        </div>
      )}

      <PageHeader
        title={t('settings')}
        subtitle={isAr ? 'إدارة وتخصيص إعدادات الفرع، الإيصالات، والمظهر' : 'Manage branch configurations, receipts, and appearance'}
        actions={branches.length > 1 ? (
          <div className="w-52 shrink-0">
            <Select
              value={selectedBranchId}
              onChange={(e) => setSelectedBranchId(e.target.value)}
              aria-label={isAr ? 'الفرع النشط للإعدادات' : 'Settings branch'}
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {isAr ? b.name : b.name_en || b.name}
                </option>
              ))}
            </Select>
          </div>
        ) : undefined}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4 md:gap-6">
        <div data-testid="settings-section-rail" className="flex gap-2 overflow-x-auto overscroll-x-contain pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:col-span-1 md:block md:space-y-1 md:overflow-visible md:pb-0">
          {SECTIONS.map((sec) => (
            <button
              key={sec.key}
              onClick={() => setActive(sec.key)}
              className={`flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition text-start md:w-full md:gap-3 md:py-3 ${
                active === sec.key
                  ? 'bg-brand-600 text-white shadow-sm shadow-brand-500/20'
                  : 'bg-ui-surface hover:bg-ui-page-alt text-ui-muted hover:text-ui-text border border-ui-border/50'
              }`}
            >
              {sec.icon}
              <span>{sec.label}</span>
            </button>
          ))}
        </div>

        <div className="md:col-span-3 space-y-6">
          {active === 'branch_profile' && (
            <Card className="space-y-6 p-4 sm:p-6">
              <div>
                <h2 className="text-lg font-bold text-ui-text">{isAr ? 'بيانات وطباعة إيصالات الفرع' : 'Branch Profile & Receipts'}</h2>
                <p className="text-xs text-ui-subtle">{isAr ? 'تخصيص الإيصالات والطباعة الحرارية الخاصة بهذا الفرع' : 'Customize receipt texts and thermal layout for this branch'}</p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label={isAr ? 'شعار خاص بهذا الفرع (رابط صورة)' : 'Branch Logo Image URL'}
                  value={branchForm.logo_url || ''}
                  onChange={(e) => setBranchForm({ ...branchForm, logo_url: e.target.value })}
                  placeholder="https://..."
                />
                <div className="sm:col-span-2">
                  <Textarea
                    label={isAr ? 'ترويسة إيصال الفرع (Header)' : 'Branch Receipt Header'}
                    rows={2}
                    value={branchForm.receipt_header || ''}
                    onChange={(e) => setBranchForm({ ...branchForm, receipt_header: e.target.value })}
                  />
                </div>
                <div className="sm:col-span-2">
                  <Textarea
                    label={isAr ? 'تذييل إيصال الفرع (Footer)' : 'Branch Receipt Footer'}
                    rows={2}
                    value={branchForm.receipt_footer || ''}
                    onChange={(e) => setBranchForm({ ...branchForm, receipt_footer: e.target.value })}
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-ui-border flex justify-end">
                <Button onClick={saveBranchSpecific} disabled={saving}>
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  <span>{isAr ? 'حفظ إعدادات الفرع' : 'Save Branch Profile'}</span>
                </Button>
              </div>
            </Card>
          )}

          {active === 'tax' && (
            <Card className="space-y-6 p-4 sm:p-6">
              <div>
                <h2 className="text-lg font-bold text-ui-text">{isAr ? 'إعدادات ضريبة الفرع' : 'Branch Tax Settings'}</h2>
                <p className="text-xs text-ui-subtle">
                  {isAr
                    ? 'حدد بوضوح هل الفرع يرث إعداد المنشأة أم يملك حالة ونسبة ضريبة مستقلة.'
                    : 'Choose whether this branch inherits the enterprise tax defaults or uses its own tax status and rate.'}
                </p>
              </div>

              <div className="rounded-xl border border-ui-border bg-ui-page-alt p-3 text-xs text-ui-muted">
                {isAr ? 'الإعداد الافتراضي للمنشأة: ' : 'Enterprise default: '}
                <span className="font-black text-ui-text">
                  {settings?.tax_enabled ? (isAr ? 'مفعلة' : 'Enabled') : (isAr ? 'معطلة' : 'Disabled')}
                  {' · '}
                  {Number(settings?.tax_rate || 0)}%
                </span>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Select
                  label={isAr ? 'حالة ضريبة الفرع' : 'Branch Tax Status'}
                  value={branchForm.tax_enabled == null ? 'inherit' : branchForm.tax_enabled ? 'enabled' : 'disabled'}
                  onChange={(e) => setBranchForm({
                    ...branchForm,
                    tax_enabled: e.target.value === 'inherit' ? null : e.target.value === 'enabled',
                  })}
                >
                  <option value="inherit">{isAr ? 'استخدام الإعداد الافتراضي للمنشأة' : 'Inherit enterprise default'}</option>
                  <option value="enabled">{isAr ? 'مفعلة لهذا الفرع' : 'Enabled for this branch'}</option>
                  <option value="disabled">{isAr ? 'معطلة لهذا الفرع' : 'Disabled for this branch'}</option>
                </Select>
                <Input
                  label={isAr ? 'نسبة ضريبة الفرع (%)' : 'Branch Tax Rate (%)'}
                  type="number"
                  min="0"
                  step="0.1"
                  value={branchForm.tax_rate ?? ''}
                  onChange={(e) => setBranchForm({
                    ...branchForm,
                    tax_rate: e.target.value === '' ? null : Number(e.target.value),
                  })}
                  placeholder={isAr ? 'فارغ = استخدام النسبة الافتراضية' : 'Blank = inherit default rate'}
                />
              </div>

              <p className="text-xs font-semibold text-ui-subtle">
                {isAr
                  ? 'عند اختيار «استخدام الإعداد الافتراضي» للحالة وترك النسبة فارغة، يتبع الفرع إعداد المنشأة بالكامل.'
                  : 'To fully inherit enterprise tax behavior, select “Inherit enterprise default” and leave the branch tax rate blank.'}
              </p>

              <div className="pt-4 border-t border-ui-border flex justify-end">
                <Button onClick={saveBranchSpecific} disabled={saving}>
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  <span>{isAr ? 'حفظ إعدادات الضريبة' : 'Save Tax Settings'}</span>
                </Button>
              </div>
            </Card>
          )}

          {active === 'business_day' && (
            <Card className="space-y-6 p-4 sm:p-6">
              <div>
                <h2 className="text-lg font-bold text-ui-text">{isAr ? 'تعريف بداية ونهاية اليوم المالي' : 'Business Day Boundaries'}</h2>
                <p className="text-xs text-ui-subtle">
                  {isAr
                    ? 'اختر هل اليومية تعتمد على أوقات ثابتة، أم تبدأ من أول شفت بعد وقت بداية محدد وتنتهي عند إغلاق آخر شفت لذلك اليوم.'
                    : 'Choose fixed business hours, or span the day from the first opened shift through the last closed shift.'}
                </p>
              </div>

              <div className="space-y-4">
                <Select
                  label={isAr ? 'طريقة تحديد اليوم المالي' : 'Business Day Mode'}
                  value={branchForm.business_day_mode || 'fixed_time'}
                  onChange={(e) => setBranchForm({
                    ...branchForm,
                    business_day_mode: e.target.value as BranchSettings['business_day_mode'],
                  })}
                >
                  <option value="fixed_time">{isAr ? 'وقت بداية ونهاية ثابت' : 'Fixed start / end time'}</option>
                  <option value="shift_span">{isAr ? 'من أول شفت بعد وقت البداية إلى آخر شفت مغلق' : 'First shift after cutoff → last closed shift'}</option>
                </Select>

                {(branchForm.business_day_mode || 'fixed_time') === 'fixed_time' ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Input
                      type="time"
                      label={isAr ? 'وقت بداية اليوم' : 'Day Start Time'}
                      value={branchForm.business_day_start || '00:00'}
                      onChange={(e) => setBranchForm({ ...branchForm, business_day_start: e.target.value })}
                    />
                    <Input
                      type="time"
                      label={isAr ? 'وقت نهاية اليوم' : 'Day End Time'}
                      value={branchForm.business_day_end || '00:00'}
                      onChange={(e) => setBranchForm({ ...branchForm, business_day_end: e.target.value })}
                    />
                  </div>
                ) : (
                  <div className="space-y-3">
                    <Input
                      type="time"
                      label={isAr ? 'وقت بداية احتساب اليوم' : 'Business Day Cutoff'}
                      value={branchForm.business_day_start || '09:00'}
                      onChange={(e) => setBranchForm({ ...branchForm, business_day_start: e.target.value })}
                    />
                    <div className="rounded-xl border border-ui-border bg-ui-page-alt p-4 text-sm text-ui-muted">
                      {isAr
                        ? 'مثال: إذا كان وقت البداية 09:00، يبدأ اليوم من أول شفت يُفتح بعد 09:00، وينتهي عند إغلاق آخر شفت بدأ قبل 09:00 من اليوم التالي—even لو أغلق 04:00 فجرًا. أي مشتريات أو مصروفات قبل أول شفت لا تدخل في اليومية.'
                        : 'Example: with a 09:00 cutoff, the business day starts at the first shift opened after 09:00 and ends when the last shift that started before the next 09:00 closes, even at 04:00. Purchases and expenses before the first shift are excluded.'}
                    </div>
                  </div>
                )}

                <label className="flex items-start gap-3 rounded-xl border border-ui-border p-4">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4"
                    checked={Boolean(branchForm.auto_close_shift_at_day_end)}
                    onChange={(e) => setBranchForm({ ...branchForm, auto_close_shift_at_day_end: e.target.checked })}
                  />
                  <span>
                    <span className="block font-semibold text-ui-text">
                      {isAr ? 'إغلاق الشفت تلقائيًا عند نهاية اليوم المالي' : 'Auto-close shift at business-day end'}
                    </span>
                    <span className="mt-1 block text-sm text-ui-muted">
                      {isAr
                        ? 'يعمل فقط إذا لم توجد أي طلبات مفتوحة أو معلقة. إذا وُجدت طلبات، يبقى الشفت مفتوحًا حتى يغلقها المستخدم.'
                        : 'Runs only when no open or held orders remain. Otherwise the shift stays open until the user resolves all orders.'}
                    </span>
                  </span>
                </label>

                <div className="rounded-xl border border-ui-border p-4 text-sm">
                  <p className="font-semibold text-ui-text">
                    {isAr ? 'قاعدة الشفت المفتوح' : 'Open Shift Rule'}
                  </p>
                  <p className="mt-1 text-ui-muted">
                    {isAr
                      ? 'مسموح بشفت واحد مفتوح فقط لكل فرع. جميع مستخدمي نقطة البيع يعملون داخل نفس شفت الفرع، ويظهر كل مستخدم بتفاصيل عملياته في تقرير الإغلاق.'
                      : 'Only one open shift is allowed per branch. POS users share that branch shift, while closing reports keep per-user activity details.'}
                  </p>
                </div>
              </div>

              <div className="pt-4 border-t border-ui-border flex justify-end">
                <Button onClick={saveBranchSpecific} disabled={saving}>
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  <span>{isAr ? 'حفظ إعدادات اليوم المالي' : 'Save Business Day Settings'}</span>
                </Button>
              </div>
            </Card>
          )}

          {active === 'inventory' && (
            <Card className="space-y-6 p-4 sm:p-6">
              <div>
                <h2 className="text-lg font-bold text-ui-text">
                  {isAr ? 'إعدادات المخزون وسياسة البيع بالسالب' : 'Inventory & Negative Stock Policy'}
                </h2>
                <p className="text-xs text-ui-subtle">
                  {isAr
                    ? 'التحكم في السماح أو منع بيع المنتجات عند وصول الرصيد المتاح إلى الصفر أو أقل'
                    : 'Control whether products can be sold when available stock reaches zero or less'}
                </p>
              </div>

              {/* Effective Status Badge */}
              {(() => {
                const globalSetting = settings?.allow_negative_stock ?? false;
                const branchOverride = branchForm.allow_negative_stock;
                const isEffectiveAllowed = branchOverride !== undefined ? branchOverride : globalSetting;
                const isInherited = branchOverride === undefined;

                return (
                  <div
                    className={`p-4 rounded-xl border flex items-start gap-3 ${
                      isEffectiveAllowed
                        ? 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400'
                        : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400'
                    }`}
                  >
                    {isEffectiveAllowed ? (
                      <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                    ) : (
                      <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
                    )}
                    <div className="text-xs leading-relaxed">
                      <p className="font-bold text-sm mb-1">
                        {isAr
                          ? isEffectiveAllowed
                            ? 'البيع بالسالب: مسموح حالياً لهذا الفرع'
                            : 'البيع بالسالب: غير مسموح (محظور) لهذا الفرع'
                          : isEffectiveAllowed
                            ? 'Negative Stock: Currently ALLOWED for this branch'
                            : 'Negative Stock: Currently DISALLOWED (Strictly Blocked)'}
                      </p>
                      <p className="opacity-90">
                        {isAr
                          ? isInherited
                            ? `(موروث من سياسة المنشأة المركزية: ${globalSetting ? 'مسموح' : 'غير مسموح'})`
                            : '(مخصص بشكل صريح لهذا الفرع)'
                          : isInherited
                            ? `(Inherited from company default policy: ${globalSetting ? 'Allowed' : 'Disallowed'})`
                            : '(Explicitly overridden for this branch)'}
                      </p>
                    </div>
                  </div>
                );
              })()}

              <div className="space-y-4">
                <label className="text-sm font-bold text-ui-text block">
                  {isAr ? 'سياسة البيع بالسالب لهذا الفرع:' : 'Negative Stock Policy for this Branch:'}
                </label>

                <div className="grid gap-3 sm:grid-cols-3">
                  <button
                    type="button"
                    onClick={() => setBranchForm({ ...branchForm, allow_negative_stock: undefined })}
                    className={`p-4 rounded-xl border text-start transition flex flex-col justify-between gap-2 ${
                      branchForm.allow_negative_stock === undefined
                        ? 'border-brand-500 bg-brand-500/10 text-ui-text'
                        : 'border-ui-border bg-ui-page hover:bg-ui-page-alt text-ui-muted'
                    }`}
                  >
                    <div>
                      <p className="text-xs font-bold text-ui-text">
                        {isAr ? 'وراثة إعداد المنشأة' : 'Inherit Company Default'}
                      </p>
                      <p className="text-[11px] text-ui-subtle mt-1">
                        {isAr
                          ? `استخدام سياسة المنشأة المركزية (${settings?.allow_negative_stock ? 'مسموح' : 'غير مسموح'})`
                          : `Follow enterprise master setting (${settings?.allow_negative_stock ? 'Allowed' : 'Disallowed'})`}
                      </p>
                    </div>
                    <span className="text-[10px] font-semibold text-brand-600">
                      {branchForm.allow_negative_stock === undefined ? (isAr ? '✓ الإعداد الحالي' : '✓ Selected') : ''}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setBranchForm({ ...branchForm, allow_negative_stock: false })}
                    className={`p-4 rounded-xl border text-start transition flex flex-col justify-between gap-2 ${
                      branchForm.allow_negative_stock === false
                        ? 'border-emerald-500 bg-emerald-500/10 text-ui-text'
                        : 'border-ui-border bg-ui-page hover:bg-ui-page-alt text-ui-muted'
                    }`}
                  >
                    <div>
                      <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                        {isAr ? 'منع البيع بالسالب (موصى به)' : 'Disallow Negative Stock'}
                      </p>
                      <p className="text-[11px] text-ui-subtle mt-1">
                        {isAr
                          ? 'يمنع إتمام البيع نهائياً إذا كانت الكمية المتاحة محلياً ستصبح أقل من صفر'
                          : 'Block sales if available stock will drop below zero'}
                      </p>
                    </div>
                    <span className="text-[10px] font-semibold text-emerald-600">
                      {branchForm.allow_negative_stock === false ? (isAr ? '✓ الإعداد الحالي' : '✓ Selected') : ''}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setBranchForm({ ...branchForm, allow_negative_stock: true })}
                    className={`p-4 rounded-xl border text-start transition flex flex-col justify-between gap-2 ${
                      branchForm.allow_negative_stock === true
                        ? 'border-amber-500 bg-amber-500/10 text-ui-text'
                        : 'border-ui-border bg-ui-page hover:bg-ui-page-alt text-ui-muted'
                    }`}
                  >
                    <div>
                      <p className="text-xs font-bold text-amber-600 dark:text-amber-400">
                        {isAr ? 'السماح بالبيع بالسالب' : 'Allow Negative Stock'}
                      </p>
                      <p className="text-[11px] text-ui-subtle mt-1">
                        {isAr
                          ? 'يسمح بالبيع وتسجيل الرصيد السالب وحركة المخزون بدقة أونلاين وأوفلاين'
                          : 'Permit selling with negative balance and audit movement'}
                      </p>
                    </div>
                    <span className="text-[10px] font-semibold text-amber-600">
                      {branchForm.allow_negative_stock === true ? (isAr ? '✓ الإعداد الحالي' : '✓ Selected') : ''}
                    </span>
                  </button>
                </div>
              </div>

              <div className="pt-4 border-t border-ui-border grid gap-4 sm:grid-cols-2">
                <Input
                  label={isAr ? 'حد تنبيه انخفاض المخزون للفرع' : 'Branch Low Stock Alert Threshold'}
                  type="number"
                  value={branchForm.low_stock_threshold ?? ''}
                  onChange={(e) =>
                    setBranchForm({
                      ...branchForm,
                      low_stock_threshold: e.target.value === '' ? null : Number(e.target.value),
                    })
                  }
                  placeholder={String(settings?.low_stock_threshold ?? 5)}
                />
              </div>

              <div className="rounded-xl border border-ui-border bg-ui-page-alt p-4 space-y-2">
                <p className="text-xs font-bold text-ui-text">
                  {isAr ? 'كيف يتم التحقق واحتساب المخزون المتاح؟' : 'How available stock is validated:'}
                </p>
                <ul className="text-[11px] text-ui-subtle list-disc list-inside space-y-1">
                  <li>
                    {isAr
                      ? 'الرصيد المتاح = آخر رصيد معروف للمخزون − الحركات المحلية غير المتزامنة − المبيعات المحلية غير المتزامنة في صندوق الانتظار (Sales Outbox).'
                      : 'Available Stock = Last known snapshot − Unsynced local movements − Pending outbox sales in queue.'}
                  </li>
                  <li>
                    {isAr
                      ? 'يعمل الفحص على مستوى الواجهة (UI) وعلى مستوى منطق الأعمال (Business Logic) في نفس الوقت.'
                      : 'Enforcement runs in both the user interface and business logic simultaneously.'}
                  </li>
                  <li>
                    {isAr
                      ? 'يعمل بكامل الكفاءة سواء كانت نقطة البيع متصلة بالإنترنت (Online) أو غير متصلة (Offline).'
                      : 'Works identically in both Online and Offline cashier modes.'}
                  </li>
                </ul>
              </div>

              <div className="pt-4 border-t border-ui-border flex justify-end">
                <Button onClick={saveBranchSpecific} disabled={saving}>
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  <span>{isAr ? 'حفظ إعدادات المخزون' : 'Save Inventory Settings'}</span>
                </Button>
              </div>
            </Card>
          )}

          {active === 'payments' && (
            <Card className="space-y-6 p-4 sm:p-6">
              <div>
                <h2 className="text-lg font-bold text-ui-text">
                  {isAr ? 'التحويلات اليدوية وInstaPay' : 'Manual Transfers & InstaPay'}
                </h2>
                <p className="text-xs text-ui-subtle">
                  {isAr
                    ? 'اعرض بيانات التحويل للكاشير، ولا يُعتمد الدفع إلا بعد موافقة مدير من مركز الموافقات.'
                    : 'Show transfer details to the cashier and require manager approval before the sale is treated as paid.'}
                </p>
              </div>

              <label className="flex items-start gap-3 rounded-2xl border border-ui-border bg-ui-page-alt p-4">
                <input
                  type="checkbox"
                  checked={Boolean(branchForm.manual_transfer_enabled)}
                  onChange={(e) => setBranchForm({ ...branchForm, manual_transfer_enabled: e.target.checked })}
                  className="mt-1 h-4 w-4"
                />
                <div>
                  <p className="text-sm font-black text-ui-text">
                    {isAr ? 'تفعيل InstaPay والتحويل البنكي في نقطة البيع' : 'Enable InstaPay and bank transfer in POS'}
                  </p>
                  <p className="mt-1 text-xs font-medium text-ui-muted">
                    {isAr
                      ? 'كل عملية تتطلب مرجع تحويل وموافقة مدير قبل إتمام البيع.'
                      : 'Every transaction requires a transfer reference and manager approval before checkout.'}
                  </p>
                </div>
              </label>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-2 rounded-2xl border border-ui-border bg-ui-surface-raised p-4">
                  <div className="flex items-center gap-2">
                    <Smartphone className="h-5 w-5 text-ui-accent" />
                    <p className="text-sm font-black text-ui-text">InstaPay</p>
                  </div>
                  <Input
                    label={isAr ? 'عنوان InstaPay / رقم التحويل' : 'InstaPay address / transfer number'}
                    value={branchForm.instapay_handle || ''}
                    onChange={(e) => setBranchForm({ ...branchForm, instapay_handle: e.target.value })}
                    placeholder="name@instapay"
                  />
                  <p className="text-[11px] font-medium text-ui-subtle">
                    {isAr ? 'سيظهر هذا النص للكاشير والعميل عند اختيار InstaPay.' : 'Shown to the cashier/customer when InstaPay is selected.'}
                  </p>
                </div>

                <div className="space-y-2 rounded-2xl border border-ui-border bg-ui-surface-raised p-4">
                  <div className="flex items-center gap-2">
                    <Landmark className="h-5 w-5 text-ui-accent" />
                    <p className="text-sm font-black text-ui-text">
                      {isAr ? 'التحويل البنكي' : 'Bank transfer'}
                    </p>
                  </div>
                  <Textarea
                    label={isAr ? 'بيانات الحساب البنكي' : 'Bank account details'}
                    value={branchForm.bank_transfer_details || ''}
                    onChange={(e) => setBranchForm({ ...branchForm, bank_transfer_details: e.target.value })}
                    placeholder={isAr ? 'اسم البنك، اسم المستفيد، رقم الحساب أو IBAN' : 'Bank, beneficiary, account number or IBAN'}
                    rows={4}
                  />
                </div>
              </div>

              <div className="rounded-2xl border border-ui-warning/30 bg-ui-warning/10 p-4 text-xs font-bold text-ui-warning">
                {isAr
                  ? 'لا يسجل النظام التحويل كدفعة مؤكدة بمجرد إدخال الرقم المرجعي. يجب أن يوافق مدير مخول من مركز الموافقات، وبعدها فقط يتم ترحيل المبلغ إلى حساب البنك محاسبيًا.'
                  : 'Entering a reference never marks the payment as confirmed. An authorized manager must approve it first; only then is the bank collection posted.'}
              </div>

              <div className="flex justify-end border-t border-ui-border pt-4">
                <Button onClick={saveBranchSpecific} disabled={saving}>
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  <span>{isAr ? 'حفظ إعدادات الدفع' : 'Save Payment Settings'}</span>
                </Button>
              </div>
            </Card>
          )}

          {active === 'branch_staff' && (
            <Card className="space-y-4 p-4 sm:p-6">
              <div>
                <h2 className="text-lg font-bold text-ui-text">{isAr ? 'طاقم عمل الفرع' : 'Branch Staff'}</h2>
                <p className="text-xs text-ui-subtle">{isAr ? 'الموظفون المعينون للعمل في هذا الفرع' : 'Team members assigned to this branch location'}</p>
              </div>

              {loadingStaff ? (
                <div className="flex justify-center p-8">
                  <Loader2 className="w-6 h-6 animate-spin text-brand-500" />
                </div>
              ) : branchStaff.length === 0 ? (
                <p className="text-sm text-ui-subtle italic py-4">{isAr ? 'لا يوجد موظفون مسجلون على هذا الفرع حالياً' : 'No staff assigned'}</p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-ui-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-ui-border bg-ui-page-alt text-start">
                        <th className="p-3 font-semibold text-ui-subtle">{isAr ? 'الاسم' : 'Name'}</th>
                        <th className="p-3 font-semibold text-ui-subtle">{isAr ? 'البريد الإلكتروني' : 'Email'}</th>
                        <th className="p-3 font-semibold text-ui-subtle">{isAr ? 'الدور الوظيفي' : 'Role'}</th>
                        <th className="p-3 font-semibold text-ui-subtle">{isAr ? 'الحالة' : 'Status'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {branchStaff.map((s) => (
                        <tr key={s.id} className="border-b border-ui-border/50 hover:bg-ui-page-alt/50">
                          <td className="p-3 font-bold text-ui-text">{s.full_name || '-'}</td>
                          <td className="p-3 text-xs text-ui-subtle font-mono">{s.email}</td>
                          <td className="p-3">
                            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-brand-500/10 text-brand-600">
                              {s.role}
                            </span>
                          </td>
                          <td className="p-3">
                            <span
                              className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                                s.is_active ? 'bg-ui-success-soft text-ui-success' : 'bg-ui-danger-soft text-ui-danger'
                              }`}
                            >
                              {s.is_active ? (isAr ? 'نشط' : 'Active') : (isAr ? 'معطل' : 'Disabled')}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}

          {active === 'appearance' && (
            <Card className="space-y-6 p-4 sm:p-6">
              <div>
                <h2 className="text-lg font-bold text-ui-text">{isAr ? 'المظهر وسمات الواجهة' : 'Appearance & Themes'}</h2>
                <p className="text-xs text-ui-subtle">{isAr ? 'اختر السمة واللون المفضل لواجهة الاستخدام' : 'Select your preferred visual style and theme mode'}</p>
              </div>

              <div>
                <p className="text-xs font-bold text-ui-text mb-2">{isAr ? 'وضع الإضاءة:' : 'Theme Mode:'}</p>
                <div className="flex gap-2">
                  <Button
                    variant={theme === 'light' ? 'primary' : 'outline'}
                    size="sm"
                    onClick={() => setTheme('light')}
                  >
                    {isAr ? 'الوضع النهاري (Light)' : 'Light'}
                  </Button>
                  <Button
                    variant={theme === 'dark' ? 'primary' : 'outline'}
                    size="sm"
                    onClick={() => setTheme('dark')}
                  >
                    {isAr ? 'الوضع الليلي (Dark)' : 'Dark'}
                  </Button>
                </div>
              </div>

              <div>
                <p className="text-xs font-bold text-ui-text mb-2">{isAr ? 'سمات الواجهة المصممة بعناية:' : 'Curated Themes:'}</p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {UI_THEMES.map((th) => (
                    <button
                      key={th.key}
                      onClick={() => pickTheme(th.key)}
                      className="p-3 rounded-xl border border-ui-border bg-ui-page hover:border-brand-500/50 flex items-center justify-between text-start transition"
                    >
                      <span className="text-xs font-bold text-ui-text">{isAr ? th.ar : th.en}</span>
                      <span className="text-[10px] text-ui-subtle px-1.5 py-0.5 rounded bg-ui-surface">
                        {th.mode}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </Card>
          )}

          {active === 'language' && (
            <Card className="space-y-4 p-4 sm:p-6">
              <div>
                <h2 className="text-lg font-bold text-ui-text">{isAr ? 'لغة واجهة الاستخدام' : 'Language & Localization'}</h2>
                <p className="text-xs text-ui-subtle">{isAr ? 'اختر اللغة المفضلة للنظام' : 'Select interface language'}</p>
              </div>

              <div className="flex flex-wrap gap-3 pt-2">
                <Button
                  variant={lang === 'ar' ? 'primary' : 'outline'}
                  onClick={() => setLang('ar')}
                  className="w-32"
                >
                  العربية
                </Button>
                <Button
                  variant={lang === 'en' ? 'primary' : 'outline'}
                  onClick={() => setLang('en')}
                  className="w-32"
                >
                  English
                </Button>
              </div>

              <div data-testid="language-preference-lock" className="flex flex-col gap-3 rounded-xl border border-ui-border bg-ui-page-alt p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-black text-ui-text">
                    {languageLocked ? (isAr ? 'اللغة مثبتة على هذا الجهاز' : 'Language is locked on this device') : (isAr ? 'اللغة غير مثبتة' : 'Language is not locked')}
                  </p>
                  <p className="mt-1 text-xs font-semibold text-ui-subtle">
                    {isAr
                      ? 'عند التثبيت لن تغيّر إعدادات النظام العامة اللغة التي اخترتها على هذا الجهاز.'
                      : 'When locked, system defaults will not override the language you selected on this device.'}
                  </p>
                </div>
                <Button
                  type="button"
                  variant={languageLocked ? 'outline' : 'primary'}
                  onClick={() => {
                    if (languageLocked) {
                      unlockLanguagePreference();
                      show(isAr ? 'تم إلغاء تثبيت اللغة' : 'Language lock removed', 'success');
                    } else {
                      lockLanguagePreference();
                      show(isAr ? 'تم تثبيت اللغة الحالية' : 'Current language locked', 'success');
                    }
                  }}
                  data-testid="language-lock-button"
                  className="shrink-0"
                >
                  {languageLocked ? <Unlock className="h-4 w-4" /> : <LockKeyhole className="h-4 w-4" />}
                  {languageLocked ? (isAr ? 'إلغاء التثبيت' : 'Unlock language') : (isAr ? 'تثبيت اللغة' : 'Lock language')}
                </Button>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}