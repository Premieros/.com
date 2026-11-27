import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, PackagePlus, Plus, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/api';
import * as api from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast';
import { DesignSurface, DesignPageHeader, DesignPanel } from '@/components/design';
import { Button } from '@/components/Button';
import { Input, Select } from '@/components/Input';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useBranches } from '@/hooks/useBranches';
import { useCan } from '@/lib/permissions';
import { generateBarcode } from '@/lib/format';
import { useGuidedWorkflow } from '@/core/guard';
import { invalidatePosCatalogCache } from '@/core/offline/invalidatePosCatalogCache';
import { BusinessAttributesFields } from '@/features/shared/BusinessAttributesFields';
import type { Category, InventoryUnit } from '@/lib/types';
import { useOrganizationModules } from '@/core/modules/OrganizationModulesContext';

type ManufacturedComponent = { unit_id: string; quantity: number };
type RawComponent = { raw_material_id: string; quantity: number; wastage_percent: number };
type MeasurementUnit = { id: string; name: string; symbol?: string | null; code?: string | null };
type RawMaterial = {
  id: string;
  name: string;
  branch_id: string | null;
  is_active: boolean;
  default_cost?: number;
  unit_id: string | null;
  measurement_unit?: MeasurementUnit | null;
};

export function ProductSetupWizardPage() {
  const navigate = useNavigate();
  const { t, lang } = useLanguage();
  const { show } = useToast();
  const branchFilter = useBranchFilter();
  const { branches } = useBranches();
  const can = useCan();
  const { runtime } = useOrganizationModules();
  const { guidedContext, completePrerequisiteAndReturn } = useGuidedWorkflow();
  const isAr = lang === 'ar';
  const supportsRawComposition = runtime.capabilities.has('raw_materials') || runtime.capabilities.has('recipes');
  const supportsComponentGroups = runtime.capabilities.has('component_groups');
  const supportsComposition = supportsRawComposition || supportsComponentGroups;
  const itemLabel = runtime.terminology.item[isAr ? 'ar' : 'en'];

  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [loadingComponents, setLoadingComponents] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [manufacturedItems, setManufacturedItems] = useState<InventoryUnit[]>([]);
  const [rawMaterials, setRawMaterials] = useState<RawMaterial[]>([]);
  const [form, setForm] = useState({
    name: '',
    name_en: '',
    barcode: generateBarcode(),
    sku: '',
    category_id: '',
    branch_id: branchFilter || '',
    cost_price: 0,
    sale_price: 0,
    wholesale_price: 0,
    is_active: true,
  });
  const [businessAttributes, setBusinessAttributes] = useState<Record<string, unknown>>({});
  const [manufacturedComponents, setManufacturedComponents] = useState<ManufacturedComponent[]>([]);
  const [rawComponents, setRawComponents] = useState<RawComponent[]>([]);

  const branchId = branchFilter || form.branch_id || '';
  const selectedManufacturedIds = useMemo(() => new Set(manufacturedComponents.map((row) => row.unit_id).filter(Boolean)), [manufacturedComponents]);
  const selectedRawIds = useMemo(() => new Set(rawComponents.map((row) => row.raw_material_id).filter(Boolean)), [rawComponents]);
  const totalComponentCount = manufacturedComponents.length + rawComponents.length;
  const wizardSteps = useMemo(() => [
    { step: 1, label: isAr ? `بيانات ${itemLabel}` : itemLabel },
    ...(supportsComponentGroups ? [{ step: 2, label: isAr ? 'مجموعات المكونات' : 'Component groups' }] : []),
    ...(supportsRawComposition ? [{ step: 3, label: isAr ? 'الخامات' : 'Raw materials' }] : []),
    { step: 4, label: isAr ? 'مراجعة' : 'Review' },
  ], [isAr, itemLabel, supportsComponentGroups, supportsRawComposition]);
  const currentStepIndex = Math.max(0, wizardSteps.findIndex((item) => item.step === step));
  const previousStep = wizardSteps[Math.max(0, currentStepIndex - 1)]?.step ?? 1;
  const nextStep = wizardSteps[Math.min(wizardSteps.length - 1, currentStepIndex + 1)]?.step ?? 4;

  const rawUnitLabel = (material?: RawMaterial) => {
    const unit = material?.measurement_unit;
    if (!unit) return isAr ? 'وحدة غير محددة' : 'Unit not set';
    const short = unit.symbol || unit.code;
    return short && short !== unit.name ? `${unit.name} (${short})` : unit.name;
  };
  const rawMaterialLabel = (material: RawMaterial) => `${material.name} — ${rawUnitLabel(material)}`;

  useEffect(() => {
    if (branchFilter && form.branch_id !== branchFilter) {
      setForm((prev) => ({ ...prev, branch_id: branchFilter, category_id: '' }));
    }
  }, [branchFilter, form.branch_id]);

  useEffect(() => {
    let cancelled = false;
    setManufacturedComponents([]);
    setRawComponents([]);
    setCategories([]);
    setManufacturedItems([]);
    setRawMaterials([]);

    if (!branchId) return () => { cancelled = true; };

    void (async () => {
      setLoadingComponents(true);
      const [cats, manufactured, raws] = await Promise.all([
        supabase.from('categories').select('*').eq('branch_id', branchId).order('name'),
        supportsComponentGroups
          ? supabase.from('inventory_units').select('*').eq('branch_id', branchId).eq('unit_type', 'manufactured').eq('is_active', true).order('name')
          : Promise.resolve({ data: [], error: null }),
        supportsRawComposition
          ? supabase.from('raw_materials')
              .select('id,name,branch_id,is_active,default_cost,unit_id,measurement_unit:measurement_units!raw_materials_unit_id_fkey(id,name,symbol,code)')
              .eq('branch_id', branchId)
              .eq('is_active', true)
              .order('name')
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (cancelled) return;
      if (cats.error) show(cats.error.message, 'error');
      if (manufactured.error) show(manufactured.error.message, 'error');
      if (raws.error) show(raws.error.message, 'error');
      setCategories((cats.data as Category[]) || []);
      setManufacturedItems((manufactured.data as InventoryUnit[]) || []);
      setRawMaterials((raws.data as unknown as RawMaterial[]) || []);
      setLoadingComponents(false);
    })().catch((error) => {
      if (!cancelled) {
        show(error instanceof Error ? error.message : String(error), 'error');
        setLoadingComponents(false);
      }
    });

    return () => { cancelled = true; };
  }, [branchId, show, supportsComponentGroups, supportsRawComposition]);

  useEffect(() => {
    if (!supportsComponentGroups) setManufacturedComponents([]);
    if (!supportsRawComposition) setRawComponents([]);
    if (!wizardSteps.some((item) => item.step === step)) setStep(1);
  }, [step, supportsComponentGroups, supportsRawComposition, wizardSteps]);

  const addManufacturedComponent = () => setManufacturedComponents((prev) => [...prev, { unit_id: '', quantity: 1 }]);
  const updateManufacturedComponent = (index: number, patch: Partial<ManufacturedComponent>) => {
    setManufacturedComponents((prev) => prev.map((row, i) => i === index ? { ...row, ...patch } : row));
  };
  const removeManufacturedComponent = (index: number) => setManufacturedComponents((prev) => prev.filter((_, i) => i !== index));

  const addRawComponent = () => setRawComponents((prev) => [...prev, { raw_material_id: '', quantity: 1, wastage_percent: 0 }]);
  const updateRawComponent = (index: number, patch: Partial<RawComponent>) => {
    setRawComponents((prev) => prev.map((row, i) => i === index ? { ...row, ...patch } : row));
  };
  const removeRawComponent = (index: number) => setRawComponents((prev) => prev.filter((_, i) => i !== index));

  const validateStep = () => {
    if (step === 1 && (!form.name.trim() || !branchId)) {
      show(isAr ? 'أكمل اسم المنتج والفرع' : 'Complete the product name and branch', 'error');
      return false;
    }
    if (step === 2 && supportsComponentGroups) {
      if (manufacturedComponents.some((row) => !row.unit_id || row.quantity <= 0)) {
        show(isAr ? 'اختر مجموعة المكونات وحدد كمية صحيحة' : 'Select each component group and enter a valid quantity', 'error');
        return false;
      }
      if (selectedManufacturedIds.size !== manufacturedComponents.length) {
        show(isAr ? 'لا يمكن إضافة نفس مجموعة المكونات أكثر من مرة' : 'The same component group cannot be selected more than once', 'error');
        return false;
      }
      if (manufacturedComponents.some((row) => !manufacturedItems.some((item) => item.id === row.unit_id && item.branch_id === branchId && item.unit_type === 'manufactured'))) {
        show(isAr ? 'إحدى مجموعات المكونات لا تنتمي للفرع الحالي' : 'A component group does not belong to the current branch', 'error');
        return false;
      }
    }
    if (step === 3 && supportsRawComposition) {
      if (rawComponents.some((row) => !row.raw_material_id || row.quantity <= 0 || row.wastage_percent < 0)) {
        show(isAr ? 'اختر الخامة وحدد كمية صحيحة' : 'Select each raw material and enter a valid quantity', 'error');
        return false;
      }
      if (selectedRawIds.size !== rawComponents.length) {
        show(isAr ? 'لا يمكن إضافة نفس الخامة أكثر من مرة' : 'The same raw material cannot be selected more than once', 'error');
        return false;
      }
      if (rawComponents.some((row) => !rawMaterials.some((material) => material.id === row.raw_material_id && material.branch_id === branchId))) {
        show(isAr ? 'إحدى الخامات لا تنتمي للفرع الحالي' : 'A selected raw material does not belong to the current branch', 'error');
        return false;
      }
      if (rawComponents.some((row) => !rawMaterials.find((material) => material.id === row.raw_material_id)?.measurement_unit)) {
        show(isAr ? 'لا يمكن استخدام خامة بدون وحدة قياس. افتح الخامة وحدد وحدتها أولًا.' : 'A raw material without a measurement unit cannot be used. Set its unit first.', 'error');
        return false;
      }
    }
    return true;
  };

  const save = async () => {
    if (!can('products.create') || saving || !branchId) return;
    if (!validateStep()) return;
    if (supportsRawComposition && rawComponents.length > 0 && !can('recipes.manage')) {
      show(isAr ? 'لا تملك صلاحية إدارة الخامات المباشرة للمنتج.' : 'You do not have permission to manage direct product raw materials.', 'error');
      return;
    }

    setSaving(true);
    let createdProductId: string | null = null;
    try {
      const derivedProductType: 'ready' | 'manufactured' = supportsComposition && (rawComponents.length > 0 || manufacturedComponents.length > 0) ? 'manufactured' : 'ready';
      const { data, error: productError } = await api.catalog.createProduct({
        p_name: form.name.trim(),
        p_name_en: form.name_en.trim() || null,
        p_barcode: form.barcode || null,
        p_sku: form.sku.trim() || null,
        p_category_id: form.category_id || null,
        p_branch_id: branchId,
        p_cost_price: Number(form.cost_price) || 0,
        p_sale_price: Number(form.sale_price) || 0,
        p_wholesale_price: Number(form.wholesale_price) || 0,
        p_is_active: form.is_active,
        p_product_type: derivedProductType,
        p_unit_links: supportsComponentGroups && manufacturedComponents.length > 0
          ? manufacturedComponents.map((row) => ({ unit_id: row.unit_id, quantity: Number(row.quantity) }))
          : null,
      });
      if (productError || !data || data.success === false) throw productError || new Error(data?.error || 'error');
      createdProductId = data.product_id ?? null;
      if (!createdProductId) throw new Error(data?.error || 'error');

      const { error: attributesError } = await supabase
        .from('products')
        .update({ business_attributes: businessAttributes })
        .eq('id', createdProductId);
      if (attributesError) throw attributesError;

      if (supportsRawComposition && rawComponents.length > 0) {
        await api.catalog.saveProductDirectRawComponents({
          product_id: createdProductId,
          branch_id: branchId,
          product_name: form.name.trim(),
          items: rawComponents.map((row) => ({
            raw_material_id: row.raw_material_id,
            quantity: Number(row.quantity),
            wastage_percent: Number(row.wastage_percent) || 0,
          })),
        });
      }

      await invalidatePosCatalogCache();
      show(t('saveSuccess'), 'success');
      if (guidedContext?.missingStep.key.includes('product')) {
        setTimeout(() => { completePrerequisiteAndReturn(); }, 500);
      } else {
        navigate('/products');
      }
    } catch (error) {
      if (createdProductId) {
        await supabase.from('products').delete().eq('id', createdProductId);
      }
      show(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setSaving(false);
    }
  };

  const branchName = branches.find((branch) => branch.id === branchId)?.name || '';

  return (
    <DesignSurface testId="product-setup-wizard-page">
      <DesignPageHeader
        title={isAr ? `إضافة ${itemLabel}` : `Add ${itemLabel}`}
        subtitle={supportsComposition
          ? (isAr ? `أنشئ ${itemLabel} واربط مكوناته التشغيلية حسب نشاط المؤسسة.` : `Create the ${itemLabel} and link the operational composition required by this business.`)
          : (isAr ? `أدخل بيانات ${itemLabel} والحقول الخاصة بنشاط المؤسسة فقط.` : `Enter the ${itemLabel} data and business-specific fields only.`)}
        actions={<Button variant="outline" size="sm" onClick={() => navigate('/products')}><ChevronLeft className="w-4 h-4" />{isAr ? 'العودة' : 'Back'}</Button>}
      />
      <DesignPanel>
        <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-1">
          {wizardSteps.map(({ step: stepNumber, label }, index) => {
            const number = String(stepNumber);
            const active = stepNumber === step;
            const done = index < currentStepIndex;
            return (
              <div key={number} className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm whitespace-nowrap ${active ? 'bg-brand-600 text-white' : done ? 'bg-ui-success-soft text-ui-success' : 'bg-ui-page-alt text-ui-subtle'}`}>
                <span className="w-6 h-6 rounded-full flex items-center justify-center bg-white/20">{done ? <Check className="w-4 h-4" /> : number}</span>
                {label}
              </div>
            );
          })}
        </div>

        {step === 1 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input label={t('productName')} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
            <Input label={t('nameEn')} value={form.name_en} onChange={(event) => setForm({ ...form, name_en: event.target.value })} />
            <Input label={t('barcode')} value={form.barcode} onChange={(event) => setForm({ ...form, barcode: event.target.value })} />
            <Input label={t('sku')} value={form.sku} onChange={(event) => setForm({ ...form, sku: event.target.value })} />
            <Select label={t('category')} value={form.category_id} onChange={(event) => setForm({ ...form, category_id: event.target.value })}>
              <option value="">--</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </Select>
            {!branchFilter && (
              <Select label={t('branch')} value={form.branch_id} onChange={(event) => setForm((prev) => ({ ...prev, branch_id: event.target.value, category_id: '' }))}>
                <option value="">{isAr ? 'اختر الفرع' : 'Select branch'}</option>
                {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
              </Select>
            )}
            <Input label={t('costPrice')} type="number" step="0.01" value={form.cost_price || ''} onChange={(event) => setForm({ ...form, cost_price: Number(event.target.value) || 0 })} />
            <Input label={t('salePrice')} type="number" step="0.01" value={form.sale_price || ''} onChange={(event) => setForm({ ...form, sale_price: Number(event.target.value) || 0 })} />
            <Input label={t('wholesalePrice')} type="number" step="0.01" value={form.wholesale_price || ''} onChange={(event) => setForm({ ...form, wholesale_price: Number(event.target.value) || 0 })} />
            <div className="md:col-span-2">
              <BusinessAttributesFields entity="product" value={businessAttributes} onChange={setBusinessAttributes} />
            </div>
          </div>
        )}

        {supportsComponentGroups && step === 2 && (
          <div className="space-y-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div>
                <h3 className="font-bold">{isAr ? 'مجموعات المكونات المستخدمة في المنتج' : 'Component groups used by the product'}</h3>
                <p className="text-sm text-ui-subtle">{isAr ? `اختر فقط من مجموعات مكونات ${branchName || 'الفرع الحالي'}؛ لا توجد خطوة تصنيع ولا يتم إنشاء مجموعة من داخل المنتج.` : `Select only existing component groups in ${branchName || 'the current branch'}; there is no production step or inline group creation.`}</p>
              </div>
              <Button variant="outline" onClick={addManufacturedComponent} disabled={!branchId || loadingComponents || manufacturedItems.length === 0}>
                <Plus className="w-4 h-4" />{isAr ? 'إضافة مجموعة' : 'Add component group'}
              </Button>
            </div>
            {manufacturedItems.length === 0 && !loadingComponents && (
              <div className="rounded-xl border border-ui-border bg-ui-page-alt p-4 text-sm text-ui-subtle">
                {isAr ? 'لا توجد مجموعات مكونات في هذا الفرع. أنشئ المجموعة أولًا من شاشة مجموعات المكونات ثم ارجع لاختيارها هنا.' : 'No component groups exist in this branch. Create one first from Component Groups, then return here.'}
              </div>
            )}
            {manufacturedComponents.map((row, index) => (
              <div key={index} className="grid grid-cols-1 md:grid-cols-[1fr_160px_auto] gap-3 items-end rounded-xl border border-ui-border p-3">
                <Select label={isAr ? 'اختر مجموعة المكونات' : 'Select component group'} value={row.unit_id} onChange={(event) => updateManufacturedComponent(index, { unit_id: event.target.value })}>
                  <option value="">{isAr ? 'اختر من مجموعات المكونات الموجودة' : 'Choose an existing component group'}</option>
                  {manufacturedItems.map((item) => <option key={item.id} value={item.id} disabled={selectedManufacturedIds.has(item.id) && row.unit_id !== item.id}>{item.name}</option>)}
                </Select>
                <Input label={isAr ? 'الكمية المستخدمة' : 'Quantity used'} type="number" min="0.0001" step="0.0001" value={row.quantity} onChange={(event) => updateManufacturedComponent(index, { quantity: Number(event.target.value) || 0 })} />
                <Button variant="outline" size="sm" onClick={() => removeManufacturedComponent(index)}><Trash2 className="w-4 h-4" />{isAr ? 'حذف' : 'Remove'}</Button>
              </div>
            ))}
          </div>
        )}

        {supportsRawComposition && step === 3 && (
          <div className="space-y-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div>
                <h3 className="font-bold">{isAr ? 'الخامات المكوّنة للمنتج' : 'Product raw materials'}</h3>
                <p className="text-sm text-ui-subtle">{isAr ? `اختيار فقط من خامات ${branchName || 'الفرع الحالي'} بدون كتابة أو إنشاء خامة هنا. وحدة القياس تأتي من الخامة نفسها وتبقى ثابتة.` : `Select only existing raw materials in ${branchName || 'the current branch'}. Measurement units come from the raw material and remain fixed.`}</p>
              </div>
              <Button variant="outline" onClick={addRawComponent} disabled={!branchId || loadingComponents || rawMaterials.length === 0}>
                <Plus className="w-4 h-4" />{isAr ? 'إضافة خامة' : 'Add raw material'}
              </Button>
            </div>
            {rawMaterials.length === 0 && !loadingComponents && (
              <div className="rounded-xl border border-ui-border bg-ui-page-alt p-4 text-sm text-ui-subtle">
                {isAr ? 'لا توجد خامات في هذا الفرع. أنشئ الخامة أولًا من شاشة الخامات ثم ارجع لاختيارها هنا.' : 'No raw materials exist in this branch. Create them first from the raw-material screen, then return here.'}
              </div>
            )}
            {rawComponents.map((row, index) => {
              const selectedMaterial = rawMaterials.find((material) => material.id === row.raw_material_id);
              const unitLabel = selectedMaterial ? rawUnitLabel(selectedMaterial) : '';
              return (
                <div key={index} className="grid grid-cols-1 md:grid-cols-[1fr_170px_130px_auto] gap-3 items-end rounded-xl border border-ui-border p-3">
                  <Select label={isAr ? 'اختر الخامة' : 'Select raw material'} value={row.raw_material_id} onChange={(event) => updateRawComponent(index, { raw_material_id: event.target.value })}>
                    <option value="">{isAr ? 'اختر من الخامات الموجودة' : 'Choose an existing raw material'}</option>
                    {rawMaterials.map((material) => <option key={material.id} value={material.id} disabled={!material.measurement_unit || (selectedRawIds.has(material.id) && row.raw_material_id !== material.id)}>{rawMaterialLabel(material)}</option>)}
                  </Select>
                  <Input label={unitLabel ? `${isAr ? 'الكمية' : 'Quantity'} (${unitLabel})` : (isAr ? 'الكمية' : 'Quantity')} type="number" min="0.0001" step="0.0001" value={row.quantity} onChange={(event) => updateRawComponent(index, { quantity: Number(event.target.value) || 0 })} />
                  <Input label={isAr ? 'هالك %' : 'Waste %'} type="number" min="0" step="0.01" value={row.wastage_percent} onChange={(event) => updateRawComponent(index, { wastage_percent: Number(event.target.value) || 0 })} />
                  <Button variant="outline" size="sm" onClick={() => removeRawComponent(index)}><Trash2 className="w-4 h-4" />{isAr ? 'حذف' : 'Remove'}</Button>
                </div>
              );
            })}
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <div className="rounded-xl bg-brand-50 dark:bg-brand-900/10 border border-brand-200 dark:border-brand-800/40 p-5">
              <p className="text-lg font-bold">{form.name}</p>
              <p className="text-sm text-ui-subtle mt-1">{branchName}</p>
              <div className="grid md:grid-cols-2 gap-4 mt-4">
                {supportsComponentGroups && <div>
                  <p className="font-semibold mb-2">{isAr ? 'مجموعات المكونات المختارة' : 'Selected component groups'}</p>
                  {manufacturedComponents.length === 0 ? <p className="text-sm text-ui-subtle">—</p> : manufacturedComponents.map((row, index) => <div key={index} className="text-sm flex justify-between gap-3 py-1"><span>{manufacturedItems.find((item) => item.id === row.unit_id)?.name || row.unit_id}</span><span>× {row.quantity}</span></div>)}
                </div>}
                {supportsRawComposition && <div>
                  <p className="font-semibold mb-2">{isAr ? 'الخامات المختارة' : 'Selected raw materials'}</p>
                  {rawComponents.length === 0 ? <p className="text-sm text-ui-subtle">—</p> : rawComponents.map((row, index) => {
                    const material = rawMaterials.find((item) => item.id === row.raw_material_id);
                    return <div key={index} className="text-sm flex justify-between gap-3 py-1"><span>{material?.name || row.raw_material_id}</span><span>{row.quantity} {rawUnitLabel(material)} · {row.wastage_percent}%</span></div>;
                  })}
                </div>}
              </div>
            </div>
            <p className="text-sm text-ui-subtle">{supportsComposition
              ? (isAr ? `سيتم ربط ${totalComponentCount} مكوّن بـ ${itemLabel}.` : `${totalComponentCount} existing components will be linked to the ${itemLabel}.`)
              : (isAr ? `سيتم حفظ ${itemLabel} بدون دورة تصنيع أو مكونات غير مطلوبة لهذا النشاط.` : `The ${itemLabel} will be saved without manufacturing composition that this business does not use.`)}</p>
          </div>
        )}

        <div className="flex justify-between gap-2 mt-6 pt-4 border-t border-ui-border">
          <Button variant="secondary" onClick={() => setStep(previousStep)} disabled={currentStepIndex === 0 || saving}>
            <ChevronLeft className="w-4 h-4" />{isAr ? 'السابق' : 'Back'}
          </Button>
          {currentStepIndex < wizardSteps.length - 1 ? (
            <Button onClick={() => validateStep() && setStep(nextStep)} disabled={loadingComponents}>
              <ChevronRight className="w-4 h-4" />{isAr ? 'التالي' : 'Next'}
            </Button>
          ) : (
            <Button onClick={save} disabled={saving || !branchId}>
              <PackagePlus className="w-4 h-4" />{saving ? (isAr ? 'جارٍ الحفظ...' : 'Saving...') : (isAr ? `حفظ ${itemLabel}` : `Save ${itemLabel}`)}
            </Button>
          )}
        </div>
      </DesignPanel>
    </DesignSurface>
  );
}