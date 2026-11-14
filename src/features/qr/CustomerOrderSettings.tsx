import { useEffect, useState } from 'react';
import { supabase } from '@/api';
import { qr } from '@/api/domains/qr';
import { useRoles } from '@/context/RolesContext';
import type { DiningTable } from '@/lib/types';
import type { QrSettings } from './service';
import { qrError } from './errors';
import { QrManagement } from './QrManagement';

export function CustomerOrderSettings({ branchId }: { branchId: string }) {
  const { rolesList } = useRoles();
  const [settings, setSettings] = useState<QrSettings | null>(null);
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let alive = true;
    setSettings(null); setTables([]); setMessage('');
    if (!branchId) return;
    void Promise.all([qr.settings({ p_branch: branchId }), supabase.from('dining_tables').select('*').eq('branch_id', branchId).eq('is_active', true).order('name')]).then(([config, result]) => {
      if (!alive) return;
      if (config.error || result.error) setMessage(qrError(config.error || result.error));
      else { setSettings(config.data); setTables(result.data || []); }
    }).catch(failure => { if (alive) setMessage(qrError(failure)); });
    return () => { alive = false; };
  }, [branchId]);
  async function save() {
    if (!settings) return;
    setBusy(true); setMessage('');
    try {
      const { error } = await qr.saveSettings({ p_branch: branchId, p_enabled: settings.enabled, p_appearance: settings.appearance, p_roles: settings.reviewer_roles, p_checkin: !!settings.checkin_enabled });
      if (error) throw error;
      setMessage('تم حفظ إعدادات طلبات العملاء لهذا الفرع فقط.');
    } catch (failure) { setMessage(qrError(failure)); } finally { setBusy(false); }
  }
  const roles = rolesList.filter(r => r.is_active && r.role !== 'super_admin' && (!r.branch_id || r.branch_id === branchId) && r.permissions.includes('pos.order.edit'));
  return <section dir="rtl" className="space-y-5 rounded-2xl border border-ui-border bg-ui-surface p-5">
    <div><h2 className="text-xl font-bold">طلبات العملاء</h2><p className="mt-2 text-sm text-ui-subtle">هذه الإعدادات خاصة بالفرع المحدد بالأعلى. العميل يختار الطاولة، والموظف يعتمدها أو يختار بديلًا متاحًا.</p></div>
    {message && <p role="status" className="rounded border p-3">{message}</p>}
    {!settings ? <p>جارٍ تحميل إعدادات الفرع…</p> : <>
      <label className="flex gap-2"><input type="checkbox" disabled={busy} checked={settings.enabled} onChange={e => setSettings(s => s && ({ ...s, enabled: e.target.checked }))} />تفعيل استقبال طلبات العملاء</label>
      <label className="flex gap-2"><input type="checkbox" disabled={busy} checked={!!settings.checkin_enabled} onChange={e => setSettings(s => s && ({ ...s, checkin_enabled: e.target.checked }))} />الدخول بالهاتف ورمز استرجاع الطلب وصورة الطاولة</label><p className="text-sm text-ui-subtle">صورة الطاولة يراجعها الموظف؛ إغلاق الحساب ينهي دخول الزيارة. التوصيل متاح من خارج المكان.</p><div className="grid gap-4 sm:grid-cols-2">{([
        ['brand_name','اسم المنيو'], ['subtitle','وصف قصير أسفل الاسم'], ['logo_url','رابط الشعار (https)'], ['banner_text','نص البنر'], ['banner_image_url','رابط صورة البنر (https)'],
      ] as const).map(([key,label]) => <label key={key} className="space-y-2 text-sm"><span>{label}</span><input className="block w-full rounded-xl border border-ui-border bg-ui-bg p-3" maxLength={key.includes('url') ? 1500 : 160} type={key.includes('url') ? 'url' : 'text'} value={settings.appearance[key] || ''} disabled={busy} onChange={e => setSettings(s => s && ({ ...s, appearance: { ...s.appearance, [key]: e.target.value } }))} /></label>)}</div>
      <fieldset className="space-y-3 rounded-xl border border-ui-border p-4"><legend className="px-2 font-bold">من يعتمد طلبات العملاء؟</legend>
        <p className="text-sm text-ui-subtle">بدون تحديد: كل موظف لديه صلاحية تعديل طلبات البيع. عند التحديد: الأدوار المختارة فقط، مع احتفاظ المدير العام بالاعتماد. صلاحيات إنشاء الفاتورة والوصول للفرع مطلوبة دائمًا.</p>
        <div className="flex flex-wrap gap-4">{roles.map(r => <label key={r.role} className="flex gap-2"><input type="checkbox" disabled={busy} checked={settings.reviewer_roles.includes(r.role)} onChange={e => setSettings(s => s && ({ ...s, reviewer_roles: e.target.checked ? [...s.reviewer_roles,r.role] : s.reviewer_roles.filter(role => role !== r.role) }))} />{r.name_ar || r.role}</label>)}</div>
        {settings.reviewer_roles.length > 0 && <button className="text-sm underline" disabled={busy} onClick={() => setSettings(s => s && ({ ...s, reviewer_roles: [] }))}>السماح لكل من لديه صلاحية تعديل الطلبات</button>}
      </fieldset>
      <button className="rounded-xl bg-ui-primary px-5 py-3 text-white" disabled={busy} onClick={() => void save()}>{busy ? 'جارٍ الحفظ…' : 'حفظ إعدادات طلبات العملاء'}</button>
      <QrManagement key={branchId} branchId={branchId} tables={tables} />
    </>}
  </section>;
}
