import { useMemo, useState } from 'react';
import { Check, Loader2, Plus } from 'lucide-react';
import { admin } from '@/api';
import { Button } from '@/components/Button';
import { Input, Select } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { ORGANIZATION_MODULES, ORGANIZATION_MODULE_KEYS, type OrganizationModuleKey } from '@/core/modules/module.config';
import {
  BUSINESS_PROFILE_KEYS,
  BUSINESS_PROFILE_PRESETS,
  type BusinessProfileKey,
} from '@/core/organizations/businessProfiles';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void | Promise<void>;
  ar: boolean;
}

export function OrganizationCreateWizard({ open, onClose, onCreated, ar }: Props) {
  const { show } = useToast();
  const [businessType, setBusinessType] = useState<BusinessProfileKey>('restaurant');
  const [enabledModules, setEnabledModules] = useState<OrganizationModuleKey[]>(
    BUSINESS_PROFILE_PRESETS.restaurant.enabledModules,
  );
  const [form, setForm] = useState({
    name: '',
    branchName: '',
    phone: '',
    address: '',
    currency: 'EGP',
    taxEnabled: true,
    taxRate: 14,
    ownerName: '',
    ownerEmail: '',
    ownerPassword: '',
  });
  const [saving, setSaving] = useState(false);

  const preset = BUSINESS_PROFILE_PRESETS[businessType];

  const selectedModuleSet = useMemo(() => new Set(enabledModules), [enabledModules]);

  const changeBusinessType = (next: BusinessProfileKey) => {
    const nextPreset = BUSINESS_PROFILE_PRESETS[next];
    setBusinessType(next);
    setEnabledModules([...nextPreset.enabledModules]);
    setForm((current) => ({
      ...current,
      currency: nextPreset.defaults.currency,
      taxEnabled: nextPreset.defaults.taxEnabled,
      taxRate: nextPreset.defaults.taxRate,
    }));
  };

  const toggleModule = (key: OrganizationModuleKey) => {
    setEnabledModules((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );
  };

  const reset = () => {
    setBusinessType('restaurant');
    setEnabledModules([...BUSINESS_PROFILE_PRESETS.restaurant.enabledModules]);
    setForm({
      name: '',
      branchName: '',
      phone: '',
      address: '',
      currency: 'EGP',
      taxEnabled: true,
      taxRate: 14,
      ownerName: '',
      ownerEmail: '',
      ownerPassword: '',
    });
  };

  const create = async () => {
    if (!form.name.trim() || !form.ownerName.trim() || !form.ownerEmail.trim() || form.ownerPassword.length < 6) {
      show(
        ar
          ? 'أكمل اسم المؤسسة وبيانات المالك، وكلمة المرور لا تقل عن 6 أحرف.'
          : 'Complete organization and owner details. Password must be at least 6 characters.',
        'error',
      );
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await admin.createOrganizationFromProfile({
        p_name: form.name.trim(),
        p_business_type: businessType,
        p_branch_name: form.branchName.trim() || form.name.trim(),
        p_enabled_modules: enabledModules,
        p_business_profile: {
          preset_version: 1,
          terminology: preset.terminology,
          capabilities: preset.capabilities,
          preset_key: preset.key,
        },
        p_owner_name: form.ownerName.trim(),
        p_owner_email: form.ownerEmail.trim().toLowerCase(),
        p_owner_password: form.ownerPassword,
        p_phone: form.phone.trim() || null,
        p_address: form.address.trim() || null,
        p_currency: form.currency.trim() || 'EGP',
        p_tax_enabled: form.taxEnabled,
        p_tax_rate: Number(form.taxRate) || 0,
      });

      if (error || !data?.success) {
        show(data?.detail || data?.error || error?.message || (ar ? 'فشل إنشاء المؤسسة' : 'Failed to create organization'), 'error');
        return;
      }

      show(
        ar
          ? 'تم إنشاء المؤسسة والفرع والمخزن والمالك وتطبيق حزمة النشاط بنجاح.'
          : 'Organization, first branch, warehouse, owner and business profile were created successfully.',
        'success',
      );
      reset();
      onClose();
      await onCreated();
    } catch (err) {
      show(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!saving) onClose();
      }}
      title={ar ? 'إضافة مؤسسة جديدة' : 'Create Organization'}
      size="xl"
    >
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label={ar ? 'اسم المؤسسة' : 'Organization name'}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
          <Input
            label={ar ? 'اسم أول فرع / موقع' : 'First branch / location'}
            value={form.branchName}
            onChange={(e) => setForm({ ...form, branchName: e.target.value })}
            placeholder={form.name}
          />
        </div>

        <Select
          label={ar ? 'نوع النشاط' : 'Business type'}
          value={businessType}
          onChange={(e) => changeBusinessType(e.target.value as BusinessProfileKey)}
        >
          {BUSINESS_PROFILE_KEYS.map((key) => {
            const item = BUSINESS_PROFILE_PRESETS[key];
            return (
              <option key={key} value={key}>
                {ar ? item.ar : item.en}
              </option>
            );
          })}
        </Select>

        <div className="rounded-xl border border-ui-border bg-ui-page-alt p-4">
          <div className="font-bold text-ui-text">{ar ? preset.ar : preset.en}</div>
          <p className="mt-1 text-xs text-ui-subtle">
            {ar ? preset.descriptionAr : preset.descriptionEn}
          </p>
          {preset.capabilities.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {preset.capabilities.map((capability) => (
                <span
                  key={capability}
                  className="rounded-full bg-ui-surface px-2.5 py-1 text-[11px] font-semibold text-ui-muted"
                >
                  {capability}
                </span>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-bold text-ui-text">
                {ar ? 'الموديولات التي ستُفعّل للمؤسسة' : 'Modules enabled for this organization'}
              </h4>
              <p className="text-xs text-ui-subtle">
                {ar ? 'يمكن تعديلها قبل الإنشاء أو لاحقًا من إعدادات المؤسسة.' : 'You can adjust them now or later from organization settings.'}
              </p>
            </div>
            <span className="text-xs font-semibold text-ui-subtle">
              {enabledModules.length}/{ORGANIZATION_MODULE_KEYS.length}
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {ORGANIZATION_MODULE_KEYS.map((key) => {
              const selected = selectedModuleSet.has(key);
              const label = ORGANIZATION_MODULES[key];
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleModule(key)}
                  className={`flex items-center justify-between rounded-xl border px-3 py-2 text-start text-sm transition ${
                    selected
                      ? 'border-brand-500 bg-brand-500/10 text-brand-700 dark:text-brand-300'
                      : 'border-ui-border bg-ui-surface text-ui-muted'
                  }`}
                >
                  <span>{ar ? label.ar : label.en}</span>
                  {selected ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4 opacity-50" />}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label={ar ? 'اسم المالك / المدير' : 'Owner / manager name'}
            value={form.ownerName}
            onChange={(e) => setForm({ ...form, ownerName: e.target.value })}
            required
          />
          <Input
            label={ar ? 'بريد المالك' : 'Owner email'}
            type="email"
            value={form.ownerEmail}
            onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })}
            required
          />
          <Input
            label={ar ? 'كلمة مرور المالك' : 'Owner password'}
            type="password"
            value={form.ownerPassword}
            onChange={(e) => setForm({ ...form, ownerPassword: e.target.value })}
            required
          />
          <Input
            label={ar ? 'الهاتف' : 'Phone'}
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
          <Input
            label={ar ? 'العنوان' : 'Address'}
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
          />
          <Input
            label={ar ? 'العملة' : 'Currency'}
            value={form.currency}
            onChange={(e) => setForm({ ...form, currency: e.target.value })}
          />
          <Select
            label={ar ? 'الضريبة' : 'Tax'}
            value={form.taxEnabled ? '1' : '0'}
            onChange={(e) => setForm({ ...form, taxEnabled: e.target.value === '1' })}
          >
            <option value="1">{ar ? 'مفعلة' : 'Enabled'}</option>
            <option value="0">{ar ? 'معطلة' : 'Disabled'}</option>
          </Select>
          <Input
            label={ar ? 'نسبة الضريبة %' : 'Tax rate %'}
            type="number"
            step="0.1"
            min="0"
            value={form.taxRate}
            onChange={(e) => setForm({ ...form, taxRate: Number(e.target.value) || 0 })}
          />
        </div>

        <div className="rounded-xl border border-ui-border bg-ui-page-alt p-3 text-xs text-ui-subtle">
          {ar
            ? 'عند الإنشاء سيتم تجهيز: المؤسسة، أول فرع، المخزن الرئيسي، إعدادات الفرع، الاشتراك التجريبي، حساب المالك، عضوية المؤسسة، وموديولات النشاط المختارة.'
            : 'Provisioning includes the organization, first branch, main warehouse, branch settings, trial subscription, owner account, organization membership and selected business modules.'}
        </div>

        <div className="flex justify-end gap-2 border-t border-ui-border pt-4">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {ar ? 'إلغاء' : 'Cancel'}
          </Button>
          <Button onClick={() => void create()} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {ar ? 'إنشاء المؤسسة وتجهيزها' : 'Create & provision'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
