import { useEffect, useState } from 'react';
import { qr } from '@/api/domains/qr';
import { supabase } from '@/api';
import { useRoles } from '@/context/RolesContext';
import type { QrSettings } from './service';
import { qrError } from './errors';
import { QrManagement } from './QrManagement';

export function CustomerOrderSettings({ branchId }: { branchId: string }) {
  const { rolesList } = useRoles();
  const [settings, setSettings] = useState<QrSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [readiness, setReadiness] = useState<{
    bunker: boolean; ready?: boolean; real_products?: number; demo_products?: number;
    active_tables?: number; active_stations?: number; active_warehouses?: number;
    authorized_staff?: number; products_missing_cost?: number;
    products_missing_kitchen_route?: number; products_missing_stock_or_recipe?: number; enabled?: boolean;
    requires_business_approval?: boolean;
  } | null>(null);
  const [readinessLoading, setReadinessLoading] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let alive = true;
    setSettings(null); setMessage('');
    if (!branchId) return;
    void qr.settings({ p_branch: branchId }).then(config => {
      if (!alive) return;
      if (config.error) setMessage(qrError(config.error));
      else setSettings(config.data);
    }).catch(failure => { if (alive) setMessage(qrError(failure)); });
    return () => { alive = false; };
  }, [branchId]);
  async function loadReadiness() {
    if (!branchId) return;
    setReadinessLoading(true);
    const { data, error } = await supabase.rpc('bunker_live_order_readiness', { p_branch: branchId });
    setReadinessLoading(false);
    if (!error && data && typeof data === 'object') setReadiness(data as typeof readiness);
  }
  useEffect(() => {
    let alive = true;
    setReadiness(null);
    if (!branchId) return;
    void supabase.rpc('bunker_live_order_readiness', { p_branch: branchId }).then(({data,error}) => {
      if (alive && !error && data && typeof data === 'object') setReadiness(data as typeof readiness);
    });
    return () => { alive = false; };
  }, [branchId]);
  async function save() {
    if (!settings) return;
    setBusy(true); setMessage('');
    try {
      const { error } = await qr.saveSettingsWithRecovery({
        p_branch: branchId, p_enabled: settings.enabled, p_appearance: settings.appearance,
        p_roles: settings.reviewer_roles, p_checkin: !!settings.checkin_enabled,
        p_recovery: !!settings.recovery_pin_enabled,
      });
      if (error) throw error;
      setMessage('تم حفظ إعدادات طلبات العملاء لهذا الفرع فقط.');
      void loadReadiness();
    } catch (failure) { const message = failure instanceof Error ? failure.message : String(failure); setMessage((message.includes('BUNKER_LIVE_NOT_READY') || message.includes('QR_DEMO_PRODUCTS_NOT_APPROVED')) ? 'لم تكتمل شروط تشغيل الطلبات: راجع اعتماد المنيو وربط المطبخ والمخزن والصلاحيات. التكلفة الصفرية والخامة غير المعرفة مسبقًا لا تمنع البيع وفق سياسة الخامة التلقائية.' : qrError(failure)); } finally { setBusy(false); }
  }
  const roles = rolesList.filter(r => r.is_active && r.role !== 'super_admin' && (!r.branch_id || r.branch_id === branchId) && r.permissions.includes('pos.order.edit'));
  return <section dir="rtl" className="space-y-5 rounded-2xl border border-ui-border bg-ui-surface p-5">
    <div><h2 className="text-xl font-bold">طلبات العملاء</h2><p className="mt-2 text-sm text-ui-subtle">هذه الإعدادات خاصة بالفرع المحدد بالأعلى. العميل يختار الطاولة، والموظف يعتمدها أو يختار بديلًا متاحًا.</p></div>
    {message && <p role="status" className="rounded border p-3">{message}</p>}
    {!settings ? <p>جارٍ تحميل إعدادات الفرع…</p> : <>
      {readiness?.bunker && <div data-testid="bunker-handoff-readiness" className="space-y-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-ui-text">
        <h3 className="font-bold">جاهزية التشغيل الفعلي لفرع BUNKER</h3>
        <p>{readiness.ready ? 'المتطلبات الفنية مكتملة، لكن يلزم اعتماد الإدارة وتجربة الطلب والمطبخ والدفع قبل التفعيل.' : 'الطلبات الحقيقية لم تُفعَّل بعد. راجع الربط التشغيلي والصلاحيات؛ التكلفة الصفرية أو غياب الخامة ليسا مانعَين للبيع. المعاينة تظل بدون تسجيل مبيعات.'}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {([
            ['المنتجات المنشورة',readiness.real_products ?? 0,(readiness.real_products ?? 0)>0 && (readiness.demo_products ?? 0)===0],
            ['أصناف تكلفتها صفر (تنبيه محاسبي لا يمنع البيع)',readiness.products_missing_cost ?? 0,true],
            ['ربط مطبخ غير مكتمل',readiness.products_missing_kitchen_route ?? 0,(readiness.products_missing_kitchen_route ?? 0)===0],
            ['أصناف بلا وصفة جاهزة (خامة تلقائية وقت البيع)',readiness.products_missing_stock_or_recipe ?? 0,true],
            ['مخازن نشطة',readiness.active_warehouses ?? 0,(readiness.active_warehouses ?? 0)>0],
            ['موظفون موثّقون ومصرح لهم',readiness.authorized_staff ?? 0,(readiness.authorized_staff ?? 0)>0],
            ['الطاولات النشطة',readiness.active_tables ?? 0,(readiness.active_tables ?? 0)>0],
          ] as [string,number,boolean][]).map(([label,count,ok])=><div key={label} className="flex items-center justify-between gap-2 rounded-lg border border-ui-border bg-ui-surface p-3"><span>{ok ? '✓' : '⚠'} {label}</span><strong>{count}</strong></div>)}
        </div>
        <p className="text-xs text-ui-muted">اعتماد القائمة والأسعار والوصفات، واختبار الكاشير والمطبخ والطابعة واسترجاع النسخة الاحتياطية يحتاج تأكيد مسؤول الفرع. لا تُنشأ مستخدمون أو أرصدة أو مبيعات تلقائيًا.</p>
        <p className="text-xs text-ui-muted">المسار: العميل يرسل الطلب ← صندوق طلبات العملاء ← قبول الموظف ← الكاشير ← المطبخ.</p>
        <button type="button" className="rounded-lg border border-ui-border px-3 py-2 font-semibold" disabled={readinessLoading || busy} onClick={() => void loadReadiness()}>{readinessLoading ? 'جارٍ التحقق…' : 'تحديث حالة الجاهزية'}</button>
      </div>}
      <label className="flex gap-2"><input type="checkbox" disabled={busy || (!!readiness?.bunker && !readiness.ready && !settings.enabled)} checked={settings.enabled} onChange={e => setSettings(s => s && ({ ...s, enabled: e.target.checked }))} />تفعيل استقبال طلبات العملاء</label>
      <label className="flex gap-2"><input type="checkbox" disabled={busy || !settings.checkin_enabled} checked={!!settings.recovery_pin_enabled} onChange={e => setSettings(s => s && ({ ...s, recovery_pin_enabled: e.target.checked }))} />طلب رمز استرداد عند فتح طلب من جهاز آخر</label>
      <p className="text-sm text-ui-subtle">معطل افتراضيًا. عند تعطيله لا نطلب الرمز، لكن لا يمكن نقل طلب نشط لجهاز آخر برقم الهاتف فقط. يستمر الطلب على الجهاز الأصلي أو بمساعدة الموظف. عند تعطيل الدخول بالهاتف يبقى اختيار الاسترداد محفوظًا، وسيعود عند إعادة تفعيل الدخول.</p>
      <label className="flex gap-2"><input type="checkbox" disabled={busy} checked={!!settings.checkin_enabled} onChange={e => setSettings(s => s && ({ ...s, checkin_enabled: e.target.checked }))} />تفعيل دخول العميل بالهاتف وصورة الطاولة</label><p className="text-sm text-ui-subtle">صورة الطاولة يراجعها الموظف؛ إغلاق الحساب ينهي دخول الزيارة. التوصيل متاح من خارج المكان.</p><div className="grid gap-4 sm:grid-cols-2">{([
        ['brand_name','اسم المنيو'], ['subtitle','وصف قصير أسفل الاسم'], ['logo_url','رابط الشعار (https)'], ['banner_text','نص البنر'], ['banner_image_url','رابط صورة البنر (https)'],
      ] as const).map(([key,label]) => <label key={key} className="space-y-2 text-sm"><span>{label}</span><input className="block w-full rounded-xl border border-ui-border bg-ui-bg p-3" maxLength={key.includes('url') ? 1500 : 160} type={key.includes('url') ? 'url' : 'text'} value={settings.appearance[key] || ''} disabled={busy} onChange={e => setSettings(s => s && ({ ...s, appearance: { ...s.appearance, [key]: e.target.value } }))} /></label>)}</div>
      <fieldset className="space-y-3 rounded-xl border border-ui-border p-4"><legend className="px-2 font-bold">من يعتمد طلبات العملاء؟</legend>
        <p className="text-sm text-ui-subtle">بدون تحديد: كل موظف لديه صلاحية تعديل طلبات البيع. عند التحديد: الأدوار المختارة فقط، مع احتفاظ المدير العام بالاعتماد. صلاحيات إنشاء الفاتورة والوصول للفرع مطلوبة دائمًا.</p>
        <div className="flex flex-wrap gap-4">{roles.map(r => <label key={r.role} className="flex gap-2"><input type="checkbox" disabled={busy} checked={settings.reviewer_roles.includes(r.role)} onChange={e => setSettings(s => s && ({ ...s, reviewer_roles: e.target.checked ? [...s.reviewer_roles,r.role] : s.reviewer_roles.filter(role => role !== r.role) }))} />{r.name_ar || r.role}</label>)}</div>
        {settings.reviewer_roles.length > 0 && <button className="text-sm underline" disabled={busy} onClick={() => setSettings(s => s && ({ ...s, reviewer_roles: [] }))}>السماح لكل من لديه صلاحية تعديل الطلبات</button>}
      </fieldset>
      <button className="rounded-xl bg-ui-primary px-5 py-3 text-white" disabled={busy} onClick={() => void save()}>{busy ? 'جارٍ الحفظ…' : 'حفظ إعدادات طلبات العملاء'}</button>
      <QrManagement key={branchId} branchId={branchId} brandName={settings.appearance.brand_name} onMenuUpdated={() => void loadReadiness()} />
    </>}
  </section>;
}
