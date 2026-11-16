/** Tax integrations implemented in Premier's policy layer.
 * Catalog entries describe available integration foundations, not live ETA /
 * ZATCA registrations, enabled submissions, credentials or certification.
 */
export interface TaxIntegrationCatalogItem {
  id: 'eta-einvoice' | 'eta-ereceipt' | 'zatca-standard' | 'zatca-simplified';
  authority: 'ETA' | 'ZATCA';
  countryCode: 'EG' | 'SA';
  ar: string;
  en: string;
  purposeAr: string;
  purposeEn: string;
}

export const TAX_INTEGRATION_CATALOG: readonly TaxIntegrationCatalogItem[] = [
  {
    id: 'eta-einvoice', authority: 'ETA', countryCode: 'EG',
    ar: 'الفاتورة الإلكترونية المصرية', en: 'Egyptian eInvoice',
    purposeAr: 'فواتير الأعمال وإشعارات الخصم والإضافة وفق متطلبات المنظومة.',
    purposeEn: 'Business electronic invoices and associated credit/debit notes.',
  },
  {
    id: 'eta-ereceipt', authority: 'ETA', countryCode: 'EG',
    ar: 'الإيصال الإلكتروني المصري', en: 'Egyptian eReceipt',
    purposeAr: 'إيصالات مبيعات التجزئة ونقاط البيع وربط الأجهزة والفروع.',
    purposeEn: 'Retail and POS eReceipts with branch and device onboarding.',
  },
  {
    id: 'zatca-standard', authority: 'ZATCA', countryCode: 'SA',
    ar: 'الفاتورة الضريبية القياسية السعودية', en: 'Saudi standard tax invoice',
    purposeAr: 'مسار التخليص للفواتير القياسية قبل اعتمادها.',
    purposeEn: 'Standard invoices requiring the clearance workflow.',
  },
  {
    id: 'zatca-simplified', authority: 'ZATCA', countryCode: 'SA',
    ar: 'الفاتورة الضريبية المبسطة السعودية', en: 'Saudi simplified tax invoice',
    purposeAr: 'مسار الإبلاغ عن الفواتير المبسطة بعد الإصدار.',
    purposeEn: 'Post-issuance reporting for simplified invoices.',
  },
] as const;

/** Never infer legal country from currency, phone, UI language or branch name.
 * The current Branch schema does not carry a verified country field.
 */
export function listTaxIntegrationsForBranch(
  branchId: string,
  allowedBranchIds: readonly string[],
): readonly TaxIntegrationCatalogItem[] {
  if (!branchId || !allowedBranchIds.includes(branchId)) return [];
  return TAX_INTEGRATION_CATALOG;
}
