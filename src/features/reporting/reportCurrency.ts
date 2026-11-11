/**
 * Canonical currency for reports. Alias conversion changes presentation only:
 * values are never converted with an assumed exchange rate.
 * A blank branch override inherits the organization's configured currency.
 */
export function canonicalReportCurrency(value: string | null | undefined): string | null {
  const normalized = (value || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!normalized) return null;
  if (['EGP', 'L.E', 'L.E.', 'LE', 'E£', 'ج.م', 'جنيه', 'جنيه مصري'].includes(normalized)) return 'EGP';
  return normalized;
}

/** Never sum monetary amounts unless every selected branch has a known matching currency. */
export function sharedReportCurrency(values: ReadonlyArray<string | null | undefined>): string | null {
  if (!values.length) return null;
  const currencies = values.map(canonicalReportCurrency);
  return currencies[0] && currencies.every((currency) => currency === currencies[0]) ? currencies[0] : null;
}
