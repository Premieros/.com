import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarClock,
  CheckCircle2,
  CreditCard,
  Loader2,
  RefreshCw,
  Save,
  Search,
  Settings2,
  ShieldAlert,
  WalletCards,
} from 'lucide-react';
import { admin, supabase } from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast';
import { Button } from '@/components/Button';
import { Card } from '@/components/PageHeader';
import { Input, Select, Textarea } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { formatDate, formatDateTime } from '@/lib/format';
import { notifyOrganizationRuntimeChanged } from '@/core/modules/OrganizationModulesContext';

interface OrganizationRow {
  id: string;
  name: string;
  is_active: boolean;
}

interface PlanRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  is_active: boolean;
  is_public: boolean;
  display_order: number;
}

interface PlanPriceRow {
  id: string;
  plan_id: string;
  billing_cycle: string;
  price: number;
  currency: string;
  is_active: boolean;
}

interface SubscriptionRow {
  id: string;
  tenant_id: string;
  plan_id: string;
  status: string;
  trial_started_at: string | null;
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  auto_renew: boolean;
  updated_at: string;
}

interface SubscriptionSettings {
  id: boolean;
  instapay_id: string | null;
  beneficiary_name: string | null;
  qr_code_url: string | null;
  instructions_ar: string | null;
  instructions_en: string | null;
  trial_days: number;
  warning_days: number;
  grace_days: number;
  require_receipt: boolean;
  allow_monthly: boolean;
  allow_yearly: boolean;
  updated_at: string;
}

interface TenantSubscriptionView {
  organization: OrganizationRow;
  subscription: SubscriptionRow | null;
  plan: PlanRow | null;
}

type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'suspended' | 'cancelled' | 'expired';

function toLocalInput(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

function toIsoOrNull(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function SubscriptionManagementTab() {
  const { lang } = useLanguage();
  const { show } = useToast();
  const ar = lang === 'ar';

  const [organizations, setOrganizations] = useState<OrganizationRow[]>([]);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [prices, setPrices] = useState<PlanPriceRow[]>([]);
  const [subscriptions, setSubscriptions] = useState<SubscriptionRow[]>([]);
  const [settings, setSettings] = useState<SubscriptionSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingPriceId, setSavingPriceId] = useState<string | null>(null);
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');

  const [editingTenant, setEditingTenant] = useState<TenantSubscriptionView | null>(null);
  const [editingPlanId, setEditingPlanId] = useState('');
  const [editingStatus, setEditingStatus] = useState<SubscriptionStatus>('trialing');
  const [editingTrialEnd, setEditingTrialEnd] = useState('');
  const [editingPeriodEnd, setEditingPeriodEnd] = useState('');
  const [savingSubscription, setSavingSubscription] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [orgRes, planRes, priceRes, subRes, settingsRes] = await Promise.all([
        supabase.from('organizations').select('id,name,is_active').order('name'),
        supabase.from('plans').select('id,name,slug,description,is_active,is_public,display_order').order('display_order'),
        supabase.from('plan_prices').select('id,plan_id,billing_cycle,price,currency,is_active').order('billing_cycle'),
        supabase.from('subscriptions').select('id,tenant_id,plan_id,status,trial_started_at,trial_ends_at,current_period_start,current_period_end,auto_renew,updated_at').order('updated_at', { ascending: false }),
        admin.getSubscriptionSettings(),
      ]);

      if (orgRes.error) throw orgRes.error;
      if (planRes.error) throw planRes.error;
      if (priceRes.error) throw priceRes.error;
      if (subRes.error) throw subRes.error;
      if (settingsRes.error) throw settingsRes.error;

      const nextPrices = ((priceRes.data || []) as Array<Omit<PlanPriceRow, 'price'> & { price: number | string }>).map((row) => ({
        ...row,
        price: Number(row.price || 0),
      }));

      setOrganizations((orgRes.data || []) as OrganizationRow[]);
      setPlans((planRes.data || []) as PlanRow[]);
      setPrices(nextPrices);
      setSubscriptions((subRes.data || []) as SubscriptionRow[]);
      setSettings(settingsRes.data as SubscriptionSettings);
      setPriceDrafts(Object.fromEntries(nextPrices.map((row) => [row.id, String(row.price)])));
    } catch (error) {
      console.error(error);
      show(ar ? 'تعذر تحميل بيانات الاشتراكات' : 'Failed to load subscription data', 'error');
    } finally {
      setLoading(false);
    }
  }, [ar, show]);

  useEffect(() => {
    void load();
  }, [load]);

  const planMap = useMemo(() => new Map(plans.map((plan) => [plan.id, plan])), [plans]);
  const subscriptionMap = useMemo(() => new Map(subscriptions.map((sub) => [sub.tenant_id, sub])), [subscriptions]);

  const rows = useMemo<TenantSubscriptionView[]>(() => (
    organizations
      .map((organization) => {
        const subscription = subscriptionMap.get(organization.id) || null;
        return {
          organization,
          subscription,
          plan: subscription ? planMap.get(subscription.plan_id) || null : null,
        };
      })
      .filter((row) => {
        const q = search.trim().toLowerCase();
        if (!q) return true;
        return row.organization.name.toLowerCase().includes(q)
          || (row.plan?.name || '').toLowerCase().includes(q)
          || (row.subscription?.status || '').toLowerCase().includes(q);
      })
  ), [organizations, planMap, search, subscriptionMap]);

  const summary = useMemo(() => ({
    total: organizations.length,
    trialing: subscriptions.filter((s) => s.status === 'trialing').length,
    active: subscriptions.filter((s) => s.status === 'active').length,
    restricted: subscriptions.filter((s) => ['past_due', 'suspended', 'cancelled', 'expired'].includes(s.status)).length
      + Math.max(organizations.length - subscriptions.length, 0),
  }), [organizations.length, subscriptions]);

  const openSubscriptionEditor = (row: TenantSubscriptionView) => {
    const freePlan = plans.find((plan) => plan.slug === 'free') || plans[0];
    const sub = row.subscription;
    setEditingTenant(row);
    setEditingPlanId(sub?.plan_id || freePlan?.id || '');
    setEditingStatus((sub?.status as SubscriptionStatus) || 'trialing');
    setEditingTrialEnd(toLocalInput(sub?.trial_ends_at || null));
    setEditingPeriodEnd(toLocalInput(sub?.current_period_end || null));
  };

  const saveSubscription = async () => {
    if (!editingTenant || !editingPlanId) return;
    setSavingSubscription(true);
    try {
      const { data, error } = await admin.changeTenantSubscription({
        p_tenant_id: editingTenant.organization.id,
        p_plan_id: editingPlanId,
        p_status: editingStatus,
        p_current_period_end: toIsoOrNull(editingPeriodEnd),
        p_trial_ends_at: toIsoOrNull(editingTrialEnd),
      });
      if (error || data?.success === false) {
        throw error || new Error(data?.error || 'UPDATE_FAILED');
      }

      notifyOrganizationRuntimeChanged();
      show(ar ? 'تم تحديث اشتراك المؤسسة وانعكس على فروعها' : 'Organization subscription updated for all branches', 'success');
      setEditingTenant(null);
      await load();
    } catch (error) {
      console.error(error);
      show(ar ? 'فشل تحديث الاشتراك' : 'Failed to update subscription', 'error');
    } finally {
      setSavingSubscription(false);
    }
  };

  const saveSettings = async () => {
    if (!settings) return;
    setSavingSettings(true);
    try {
      const { data, error } = await admin.updateSubscriptionSettings({
        p_instapay_id: settings.instapay_id || '',
        p_beneficiary_name: settings.beneficiary_name || '',
        p_qr_code_url: settings.qr_code_url || '',
        p_instructions_ar: settings.instructions_ar || '',
        p_instructions_en: settings.instructions_en || '',
        p_trial_days: Number(settings.trial_days || 0),
        p_warning_days: Number(settings.warning_days || 0),
        p_grace_days: Number(settings.grace_days || 0),
        p_require_receipt: Boolean(settings.require_receipt),
        p_allow_monthly: Boolean(settings.allow_monthly),
        p_allow_yearly: Boolean(settings.allow_yearly),
      });

      if (error || data?.success === false) throw error || new Error(data?.error || 'UPDATE_FAILED');
      show(ar ? 'تم حفظ إعدادات الاشتراكات' : 'Subscription settings saved', 'success');
      await load();
    } catch (error) {
      console.error(error);
      show(ar ? 'فشل حفظ إعدادات الاشتراكات' : 'Failed to save subscription settings', 'error');
    } finally {
      setSavingSettings(false);
    }
  };

  const savePrice = async (price: PlanPriceRow) => {
    const next = Number(priceDrafts[price.id]);
    if (!Number.isFinite(next) || next < 0) {
      show(ar ? 'السعر غير صحيح' : 'Invalid price', 'error');
      return;
    }

    setSavingPriceId(price.id);
    try {
      const { error } = await supabase
        .from('plan_prices')
        .update({ price: next, updated_at: new Date().toISOString() })
        .eq('id', price.id);

      if (error) throw error;
      show(ar ? 'تم تحديث سعر الخطة' : 'Plan price updated', 'success');
      await load();
    } catch (error) {
      console.error(error);
      show(ar ? 'فشل تحديث السعر' : 'Failed to update plan price', 'error');
    } finally {
      setSavingPriceId(null);
    }
  };

  const statusLabel = (status: string | null) => {
    switch (status) {
      case 'trialing': return ar ? 'تجريبي' : 'Trial';
      case 'active': return ar ? 'نشط' : 'Active';
      case 'past_due': return ar ? 'متأخر السداد' : 'Past due';
      case 'suspended': return ar ? 'موقوف' : 'Suspended';
      case 'cancelled': return ar ? 'ملغي' : 'Cancelled';
      case 'expired': return ar ? 'منتهي' : 'Expired';
      default: return ar ? 'بدون اشتراك' : 'No subscription';
    }
  };

  const statusClass = (status: string | null) => {
    if (status === 'active') return 'bg-ui-success-soft text-ui-success';
    if (status === 'trialing') return 'bg-brand-500/10 text-brand-600';
    if (status === 'past_due') return 'bg-ui-warning-soft text-ui-warning';
    return 'bg-ui-danger-soft text-ui-danger';
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: ar ? 'إجمالي المؤسسات' : 'Organizations', value: summary.total, icon: <WalletCards className="h-5 w-5 text-brand-600" /> },
          { label: ar ? 'تجربة مجانية' : 'Free trials', value: summary.trialing, icon: <CalendarClock className="h-5 w-5 text-brand-600" /> },
          { label: ar ? 'اشتراكات نشطة' : 'Active subscriptions', value: summary.active, icon: <CheckCircle2 className="h-5 w-5 text-ui-success" /> },
          { label: ar ? 'مقيدة / بدون اشتراك' : 'Restricted / none', value: summary.restricted, icon: <ShieldAlert className="h-5 w-5 text-ui-danger" /> },
        ].map((item) => (
          <Card key={item.label} className="flex items-center gap-3 p-4">
            <div className="rounded-xl bg-ui-page-alt p-2.5">{item.icon}</div>
            <div>
              <p className="text-xs text-ui-subtle">{item.label}</p>
              <p className="text-xl font-black text-ui-text">{item.value}</p>
            </div>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-ui-border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-base font-black text-ui-text">
              {ar ? 'اشتراكات المؤسسات' : 'Organization Subscriptions'}
            </h3>
            <p className="text-xs text-ui-subtle">
              {ar ? 'إدارة الخطة، الحالة، التجربة وتواريخ الانتهاء لكل مؤسسة.' : 'Manage plan, status, trial, and expiry dates for every organization.'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative min-w-[240px]">
              <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ui-subtle" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={ar ? 'بحث عن مؤسسة أو خطة...' : 'Search organization or plan...'}
                className="h-10 w-full rounded-xl border border-ui-border bg-ui-surface ps-9 pe-3 text-sm font-semibold text-ui-text outline-none focus:border-brand-500"
              />
            </div>
            <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              {ar ? 'تحديث' : 'Refresh'}
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs sm:text-sm">
            <thead className="border-b border-ui-border bg-ui-page-alt text-ui-muted">
              <tr>
                <th className="p-3 text-start font-semibold">{ar ? 'المؤسسة' : 'Organization'}</th>
                <th className="p-3 text-start font-semibold">{ar ? 'الخطة' : 'Plan'}</th>
                <th className="p-3 text-center font-semibold">{ar ? 'الحالة' : 'Status'}</th>
                <th className="p-3 text-center font-semibold">{ar ? 'نهاية التجربة' : 'Trial ends'}</th>
                <th className="p-3 text-center font-semibold">{ar ? 'نهاية الفترة' : 'Period ends'}</th>
                <th className="p-3 text-end font-semibold">{ar ? 'الإجراء' : 'Action'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ui-border">
              {rows.map((row) => (
                <tr key={row.organization.id} className="hover:bg-ui-page-alt/50">
                  <td className="p-3">
                    <div className="font-black text-ui-text">{row.organization.name}</div>
                    <div className="mt-1 text-[11px] text-ui-subtle">
                      {row.organization.is_active ? (ar ? 'المؤسسة نشطة' : 'Organization active') : (ar ? 'المؤسسة معطلة' : 'Organization disabled')}
                    </div>
                  </td>
                  <td className="p-3 font-bold text-ui-text">{row.plan?.name || '-'}</td>
                  <td className="p-3 text-center">
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${statusClass(row.subscription?.status || null)}`}>
                      {statusLabel(row.subscription?.status || null)}
                    </span>
                  </td>
                  <td className="p-3 text-center text-ui-muted">
                    {row.subscription?.trial_ends_at ? formatDate(row.subscription.trial_ends_at, lang) : '-'}
                  </td>
                  <td className="p-3 text-center text-ui-muted">
                    {row.subscription?.current_period_end ? formatDate(row.subscription.current_period_end, lang) : '-'}
                  </td>
                  <td className="p-3 text-end">
                    <Button size="sm" variant="outline" onClick={() => openSubscriptionEditor(row)}>
                      <Settings2 className="h-4 w-4" />
                      {ar ? 'إدارة' : 'Manage'}
                    </Button>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-sm font-bold text-ui-subtle">
                    {loading ? (ar ? 'جاري التحميل...' : 'Loading...') : (ar ? 'لا توجد نتائج.' : 'No results.')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="space-y-5 p-5">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-brand-500/10 p-2.5 text-brand-600">
              <CreditCard className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-black text-ui-text">{ar ? 'الخطط والأسعار' : 'Plans & Pricing'}</h3>
              <p className="text-xs text-ui-subtle">{ar ? 'تعديل أسعار الفوترة الشهرية والسنوية.' : 'Edit monthly and yearly billing prices.'}</p>
            </div>
          </div>

          <div className="space-y-3">
            {plans.map((plan) => {
              const planPrices = prices.filter((price) => price.plan_id === plan.id);
              return (
                <div key={plan.id} className="rounded-2xl border border-ui-border p-4">
                  <div className="mb-3">
                    <div className="font-black text-ui-text">{plan.name}</div>
                    <div className="text-[11px] text-ui-subtle">{plan.description || plan.slug}</div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {planPrices.map((price) => (
                      <div key={price.id} className="rounded-xl bg-ui-page-alt p-3">
                        <div className="mb-2 text-[11px] font-bold text-ui-muted">
                          {price.billing_cycle === 'yearly' ? (ar ? 'سنوي' : 'Yearly') : (ar ? 'شهري' : 'Monthly')} · {price.currency}
                        </div>
                        <div className="flex gap-2">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={priceDrafts[price.id] ?? String(price.price)}
                            onChange={(event) => setPriceDrafts((current) => ({ ...current, [price.id]: event.target.value }))}
                            className="h-9 min-w-0 flex-1 rounded-lg border border-ui-border bg-ui-surface px-2 text-sm font-black text-ui-text"
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={savingPriceId === price.id}
                            onClick={() => void savePrice(price)}
                          >
                            {savingPriceId === price.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                          </Button>
                        </div>
                      </div>
                    ))}
                    {!planPrices.length && (
                      <div className="text-xs font-semibold text-ui-subtle">{ar ? 'لا يوجد سعر مسجل.' : 'No price configured.'}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card className="space-y-5 p-5">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-brand-500/10 p-2.5 text-brand-600">
              <Settings2 className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-black text-ui-text">{ar ? 'إعدادات الاشتراكات' : 'Subscription Settings'}</h3>
              <p className="text-xs text-ui-subtle">
                {ar ? 'مدة التجربة والتنبيهات وطرق تحصيل قيمة الاشتراك.' : 'Trial duration, warnings, billing periods, and collection details.'}
              </p>
            </div>
          </div>

          {settings ? (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <Input
                  type="number"
                  min={0}
                  max={365}
                  label={ar ? 'أيام التجربة' : 'Trial days'}
                  value={String(settings.trial_days)}
                  onChange={(event) => setSettings({ ...settings, trial_days: Number(event.target.value) })}
                />
                <Input
                  type="number"
                  min={0}
                  max={90}
                  label={ar ? 'أيام التحذير' : 'Warning days'}
                  value={String(settings.warning_days)}
                  onChange={(event) => setSettings({ ...settings, warning_days: Number(event.target.value) })}
                />
                <Input
                  type="number"
                  min={0}
                  max={90}
                  label={ar ? 'أيام السماح' : 'Grace days'}
                  value={String(settings.grace_days)}
                  onChange={(event) => setSettings({ ...settings, grace_days: Number(event.target.value) })}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label="InstaPay"
                  value={settings.instapay_id || ''}
                  onChange={(event) => setSettings({ ...settings, instapay_id: event.target.value })}
                  placeholder="name@instapay"
                />
                <Input
                  label={ar ? 'اسم المستفيد' : 'Beneficiary name'}
                  value={settings.beneficiary_name || ''}
                  onChange={(event) => setSettings({ ...settings, beneficiary_name: event.target.value })}
                />
              </div>

              <Input
                label={ar ? 'رابط QR (اختياري)' : 'QR code URL (optional)'}
                value={settings.qr_code_url || ''}
                onChange={(event) => setSettings({ ...settings, qr_code_url: event.target.value })}
              />

              <div className="grid gap-3 sm:grid-cols-2">
                <Textarea
                  label={ar ? 'تعليمات الدفع بالعربية' : 'Arabic payment instructions'}
                  rows={3}
                  value={settings.instructions_ar || ''}
                  onChange={(event) => setSettings({ ...settings, instructions_ar: event.target.value })}
                />
                <Textarea
                  label={ar ? 'تعليمات الدفع بالإنجليزية' : 'English payment instructions'}
                  rows={3}
                  value={settings.instructions_en || ''}
                  onChange={(event) => setSettings({ ...settings, instructions_en: event.target.value })}
                />
              </div>

              <div className="grid gap-2 sm:grid-cols-3">
                {[
                  ['allow_monthly', ar ? 'السماح بالشهري' : 'Allow monthly'],
                  ['allow_yearly', ar ? 'السماح بالسنوي' : 'Allow yearly'],
                  ['require_receipt', ar ? 'إيصال الدفع مطلوب' : 'Require receipt'],
                ].map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 rounded-xl border border-ui-border bg-ui-page-alt p-3 text-xs font-bold text-ui-text">
                    <input
                      type="checkbox"
                      checked={Boolean(settings[key as keyof SubscriptionSettings])}
                      onChange={(event) => setSettings({ ...settings, [key]: event.target.checked })}
                    />
                    {label}
                  </label>
                ))}
              </div>

              <div className="flex items-center justify-between border-t border-ui-border pt-4">
                <div className="text-[11px] text-ui-subtle">
                  {ar ? 'آخر تحديث:' : 'Last updated:'} {formatDateTime(settings.updated_at, lang)}
                </div>
                <Button onClick={() => void saveSettings()} disabled={savingSettings}>
                  {savingSettings ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {ar ? 'حفظ الإعدادات' : 'Save settings'}
                </Button>
              </div>
            </>
          ) : (
            <div className="p-8 text-center text-sm font-bold text-ui-subtle">
              {loading ? (ar ? 'جاري التحميل...' : 'Loading...') : (ar ? 'تعذر تحميل الإعدادات.' : 'Settings unavailable.')}
            </div>
          )}
        </Card>
      </div>

      {editingTenant && (
        <Modal
          isOpen={Boolean(editingTenant)}
          onClose={() => setEditingTenant(null)}
          title={ar ? `إدارة اشتراك — ${editingTenant.organization.name}` : `Manage Subscription — ${editingTenant.organization.name}`}
        >
          <div className="space-y-4">
            <div className="rounded-xl border border-ui-border bg-ui-page-alt p-3 text-xs font-semibold text-ui-muted">
              {ar
                ? 'تغيير الحالة أو التاريخ هنا يطبق مباشرة على اشتراك المؤسسة بالكامل.'
                : 'Changes here apply directly to the organization-wide subscription.'}
            </div>

            <Select
              label={ar ? 'الخطة' : 'Plan'}
              value={editingPlanId}
              onChange={(event) => setEditingPlanId(event.target.value)}
              options={plans.filter((plan) => plan.is_active).map((plan) => ({ value: plan.id, label: plan.name }))}
            />

            <Select
              label={ar ? 'حالة الاشتراك' : 'Subscription status'}
              value={editingStatus}
              onChange={(event) => setEditingStatus(event.target.value as SubscriptionStatus)}
              options={[
                { value: 'trialing', label: ar ? 'تجربة مجانية' : 'Trialing' },
                { value: 'active', label: ar ? 'نشط' : 'Active' },
                { value: 'past_due', label: ar ? 'متأخر السداد' : 'Past due' },
                { value: 'suspended', label: ar ? 'موقوف' : 'Suspended' },
                { value: 'cancelled', label: ar ? 'ملغي' : 'Cancelled' },
                { value: 'expired', label: ar ? 'منتهي' : 'Expired' },
              ]}
            />

            <Input
              type="datetime-local"
              label={ar ? 'نهاية الفترة التجريبية' : 'Trial ends at'}
              value={editingTrialEnd}
              onChange={(event) => setEditingTrialEnd(event.target.value)}
            />

            <Input
              type="datetime-local"
              label={ar ? 'نهاية فترة الاشتراك' : 'Current period ends at'}
              value={editingPeriodEnd}
              onChange={(event) => setEditingPeriodEnd(event.target.value)}
            />

            <div className="flex justify-end gap-2 border-t border-ui-border pt-4">
              <Button variant="outline" onClick={() => setEditingTenant(null)}>
                {ar ? 'إلغاء' : 'Cancel'}
              </Button>
              <Button onClick={() => void saveSubscription()} disabled={savingSubscription || !editingPlanId}>
                {savingSubscription ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {ar ? 'حفظ الاشتراك' : 'Save subscription'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
