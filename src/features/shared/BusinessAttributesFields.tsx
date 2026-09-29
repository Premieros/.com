import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/api';
import { Input, Select } from '@/components/Input';
import { useLanguage } from '@/context/LanguageContext';
import { useOrganizationModules } from '@/core/modules/OrganizationModulesContext';
import type { BusinessFieldDefinition } from '@/core/organizations/businessProfileRuntime';

type EntityType = 'product' | 'customer' | 'supplier';

interface Props {
  entity: EntityType;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}

export function BusinessAttributesFields({ entity, value, onChange }: Props) {
  const { lang } = useLanguage();
  const { organizationId } = useOrganizationModules();
  const [fields, setFields] = useState<BusinessFieldDefinition[]>([]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!organizationId) {
        setFields([]);
        return;
      }

      const { data, error } = await supabase
        .from('organizations')
        .select('business_profile')
        .eq('id', organizationId)
        .maybeSingle();

      if (cancelled) return;
      if (error) {
        setFields([]);
        return;
      }

      const profile = (data?.business_profile || {}) as {
        runtime_fields?: BusinessFieldDefinition[];
      };

      setFields((profile.runtime_fields || []).filter((field) => field.entity === entity));
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [entity, organizationId]);

  const visible = useMemo(() => fields, [fields]);

  if (visible.length === 0) return null;

  const set = (key: string, nextValue: unknown) => {
    onChange({ ...value, [key]: nextValue });
  };

  return (
    <div className="rounded-xl border border-ui-border bg-ui-page-alt/60 p-4">
      <div className="mb-3">
        <h4 className="text-sm font-bold text-ui-text">
          {lang === 'ar' ? 'بيانات خاصة بالنشاط' : 'Business-specific fields'}
        </h4>
        <p className="mt-1 text-xs text-ui-subtle">
          {lang === 'ar'
            ? 'تظهر هذه الحقول تلقائيًا حسب نوع المؤسسة.'
            : 'These fields are provided automatically by the organization business profile.'}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {visible.map((field) => {
          const label = lang === 'ar' ? field.ar : field.en;
          const current = value[field.key];

          if (field.type === 'boolean') {
            return (
              <Select
                key={field.key}
                label={label}
                value={current === true ? '1' : '0'}
                onChange={(e) => set(field.key, e.target.value === '1')}
              >
                <option value="0">{lang === 'ar' ? 'لا' : 'No'}</option>
                <option value="1">{lang === 'ar' ? 'نعم' : 'Yes'}</option>
              </Select>
            );
          }

          if (field.type === 'select') {
            return (
              <Select
                key={field.key}
                label={label}
                value={String(current ?? '')}
                onChange={(e) => set(field.key, e.target.value)}
                required={field.required}
              >
                <option value="">--</option>
                {(field.options || []).map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </Select>
            );
          }

          return (
            <Input
              key={field.key}
              label={label}
              type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
              value={current == null ? '' : String(current)}
              required={field.required}
              onChange={(e) => {
                if (field.type === 'number') {
                  set(field.key, e.target.value === '' ? null : Number(e.target.value));
                } else {
                  set(field.key, e.target.value);
                }
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
