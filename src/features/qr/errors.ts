export function qrError(error: unknown): string {
  const message = typeof error === 'object' && error && 'message' in error ? String(error.message) : '';
  const checkinErrors: Record<string, string> = {
    QR_PHONE_INVALID: 'أدخل رقم هاتف صحيحًا، مع كود البلد للأرقام خارج مصر.',
    QR_NAME_REQUIRED: 'اكتب اسمك من حرفين إلى ١٠٠ حرف.',
    QR_ADDRESS_REQUIRED: 'اكتب عنوان التوصيل بوضوح.',
    QR_PHOTO_REQUIRED: 'صوّر رقم الطاولة بكاميرا الهاتف أولًا.',
    QR_PHOTO_REVIEW_REQUIRED: 'يجب عرض صورة الطاولة وتأكيدها قبل قبول الطلب.',
    QR_TABLE_LOCKED: 'الطاولة مرتبطة بالزيارة. تواصل مع الموظف لتغييرها.',
    QR_PIN_REQUIRED: 'لديك زيارة مفتوحة. ارجع لرقم الهاتف وأدخل رمز استرجاع الطلب.',
    QR_PIN_INVALID: 'رمز الاسترجاع غير صحيح. لديك ٣ محاولات فقط قبل القفل.',
    QR_PIN_LOCKED: 'توقف الاسترجاع بعد ٣ محاولات خاطئة. اطلب من الموظف رمزًا جديدًا.',
    QR_CHECKIN_REQUIRED: 'سجّل الدخول برقم هاتفك أولًا، أو أعد فتح رابط المنيو.',
    QR_VISIT_CLOSED: 'انتهت هذه الزيارة ولم يعد الدخول إليها متاحًا.',
    QR_VISIT_PENDING: 'تتاح الخدمة بعد اعتماد الموظف لطلبك الأول.',
    QR_WAIT_FOR_APPROVAL: 'طلبك الأول عند الموظف. انتظر اعتماده قبل إرسال أصناف إضافية.',
    QR_RETRY: 'تغيّرت الطاولة أثناء التحقق. حاول مجددًا.',
  };
  for (const [code, text] of Object.entries(checkinErrors)) if (message.includes(code)) return text;
  if (message.includes('QR_NO_ACTIVE_BILL')) return 'طلب الشيك متاح بعد اعتماد طلبك وفتح حسابك.';
  if (message.includes('QR_SESSION_EXPIRED')) return 'انتهت مدة متابعة هذه الزيارة. ابدأ زيارة جديدة.';
  if (message.includes('QR_SESSION_CONFLICT')) return 'لا يمكن ربط الطلب بزيارة مختلفة. تواصل مع الموظف.';
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
