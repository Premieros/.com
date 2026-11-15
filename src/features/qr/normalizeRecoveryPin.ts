/** Accept Western, Arabic-Indic, Persian and full-width numerals without
 * changing leading zeros. The server still enforces exactly two ASCII digits. */
export function normalizeRecoveryPin(value: string): string {
  const digits = '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹０１２３４５６７８９';
  return Array.from(value.trim(), char => {
    const index = digits.indexOf(char);
    return index < 0 ? char : String(index % 10);
  }).join('').replace(/[^0-9]/g, '').slice(0, 2);
}
