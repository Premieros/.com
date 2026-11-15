/** Opens a print-ready card for an already-issued table ordering QR.
 * This never rotates or changes the token, so reprinting cannot invalidate a
 * QR previously placed on a table.
 */
export function printCustomerOrderQr({ image, link, tableName, brandName }: {
  image: string;
  link: string;
  tableName: string;
  brandName?: string;
}): boolean {
  if (!image.startsWith('data:image/png;base64,') || !/^https?:\/\//i.test(link)) {
    return false;
  }
  const popup = window.open('', '_blank');
  if (!popup) return false;
  popup.opener = null;

  const doc = popup.document;
  doc.title = 'طباعة رمز طلب العملاء';
  const meta = doc.createElement('meta');
  meta.setAttribute('charset', 'utf-8');
  doc.head.appendChild(meta);

  const style = doc.createElement('style');
  style.textContent = `
    @page { size: A5 portrait; margin: 10mm; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #fff; color: #111827; font-family: Tahoma, Arial, sans-serif; }
    .card { width: 100%; max-width: 145mm; margin: 0 auto; padding: 14mm 8mm;
      border: 2px solid #111827; border-radius: 8mm; text-align: center; }
    h1 { font-size: 24pt; line-height: 1.4; margin: 0 0 8mm; }
    h2 { font-size: 19pt; margin: 2mm 0 8mm; }
    img { width: 85mm; height: 85mm; max-width: 100%; image-rendering: auto; }
    p { font-size: 15pt; margin: 7mm 0 4mm; }
    small { display: block; font-size: 9pt; overflow-wrap: anywhere; direction: ltr; }
    @media screen { body { padding: 16px; } }
    @media print { .card { break-inside: avoid; } }
  `;
  doc.head.appendChild(style);

  const card = doc.createElement('main');
  card.className = 'card';
  card.dir = 'rtl';
  const heading = doc.createElement('h1');
  heading.textContent = brandName?.trim() || 'طلبات العملاء';
  const table = doc.createElement('h2');
  table.textContent = tableName;
  const qr = doc.createElement('img');
  qr.alt = 'رمز QR لطلب العملاء';
  const guide = doc.createElement('p');
  guide.textContent = 'امسح الرمز بكاميرا هاتفك لعرض المنيو وطلب الطعام';
  const address = doc.createElement('small');
  address.textContent = link;
  card.append(heading, table, qr, guide, address);
  doc.body.appendChild(card);

  qr.onload = () => { popup.focus(); popup.print(); };
  qr.onerror = () => { popup.close(); };
  qr.src = image;
  return true;
}
