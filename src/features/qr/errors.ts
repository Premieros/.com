export function qrError(error: unknown): string {
  const message = typeof error === 'object' && error && 'message' in error ? String(error.message) : '';
  if (message.includes('QR_TABLE_BUSY')) return 'الطاولة أصبحت مشغولة. اختر طاولة متاحة ثم اعتمد الطلب.';
  if (message.includes('QR_TABLE_INVALID')) return 'اختر طاولة متاحة من نفس الفرع.';
  if (message.includes('QR_DISABLED')) return 'طلبات العملاء متوقفة مؤقتًا لهذا الفرع. يرجى التواصل مع الموظف.';
  if (message.includes('QR_PERMISSION_DENIED')) return 'ليس لديك صلاحية اعتماد الطلب أو تعديل إعدادات هذا الفرع.';
  if (message.includes('QR_PRICE_CHANGED')) return 'تغير السعر. حدّث المنيو وأرسل طلبًا جديدًا / Price changed; refresh the menu.';
  if (message.includes('QR_ORDER_REFRESH_REQUIRED')) return 'وصلت أصناف QR جديدة. أعد فتح الطلب قبل الحفظ / Reopen the order before saving.';
  if (message.includes('QR_ORDER_OPERATOR_REQUIRED')) return 'يجب قبول الطلب بواسطة مسؤول فاتورة الطاولة / The table order operator must accept.';
  if (message.includes('QR_RATE_LIMITED')) return 'طلبات كثيرة؛ يرجى الانتظار والتواصل مع الموظف / Please wait or contact staff.';
  if (message.includes('QR_LINK_INVALID')) return 'رابط الطاولة غير متاح / Table link unavailable.';
  if (message.includes('QR_PRODUCT_UNAVAILABLE')) return 'صنف غير متاح؛ حدّث المنيو / An item is unavailable; refresh the menu.';
  if (message.includes('QR_TABLE_SESSION_CHANGED') || message.includes('QR_REQUEST_EXPIRED')) return 'تغيرت جلسة الطاولة أو انتهت مهلة الطلب؛ ارفضه واطلب إرساله مجددًا / Reject this request and ask the guest to submit again.';
  return 'تعذر إتمام العملية. يمكنك المحاولة مرة أخرى أو التواصل مع الموظف / Please retry or contact staff.';
}
