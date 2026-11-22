export function qrError(error: unknown): string {
  const message = typeof error === 'object' && error && 'message' in error ? String(error.message) : '';
  const checkinErrors: Record<string, string> = {
    QR_PHONE_INVALID: 'أدخل رقم هاتف صحيحًا، مع كود البلد للأرقام خارج مصر.',
    QR_NAME_REQUIRED: 'اكتب اسمك من حرفين إلى ١٠٠ حرف.',
    QR_ADDRESS_REQUIRED: 'اكتب عنوان التوصيل بوضوح.',
    QR_PHOTO_REQUIRED: 'صوّر رقم الطاولة بكاميرا الهاتف أولًا.',
    QR_PHOTO_REVIEW_REQUIRED: 'يجب عرض صورة الطاولة وتأكيدها قبل قبول الطلب.',
    QR_FULFILLMENT_LOCKED: 'أُرسل هذا الطلب للمطعم. تواصل مع الفرع لتعديل نوعه.',
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

/** Public English copy for BUNKER's customer-facing QR flow. Preserve existing Arabic staff/other-branch messages. */
export function qrErrorEnglish(error: unknown): string {
  const message = typeof error === 'object' && error && 'message' in error ? String(error.message) : '';
  const map: Record<string,string> = {
    QR_DISABLED: 'Online ordering is temporarily unavailable at this branch. Please speak with our team.',
    QR_LINK_INVALID: 'This ordering link is not available. Please contact our team.',
    QR_TABLE_INVALID: 'Please choose an available table.',
    QR_TABLE_BUSY: 'This table is occupied. Please choose another table.',
    QR_PHONE_INVALID: 'Enter a valid phone number, including country code when needed.',
    QR_NAME_REQUIRED: 'Please enter your name (2–100 characters).',
    QR_ADDRESS_REQUIRED: 'Please enter your delivery address.',
    QR_PHOTO_REQUIRED: 'Please take a photo of your table number.',
    QR_PHOTO_REVIEW_REQUIRED: 'Our team must verify your table photo first.',
    QR_FULFILLMENT_LOCKED: 'This order has already been sent. Contact the restaurant to change its type.',
    QR_TABLE_LOCKED: 'Your table is linked to this visit. Ask our team to change it.',
    QR_PIN_REQUIRED: 'Enter the recovery code for your existing visit.',
    QR_PIN_INVALID: 'Invalid recovery code. You have three attempts.',
    QR_PIN_LOCKED: 'Recovery is locked after three attempts. Ask our team for a new code.',
    QR_CHECKIN_REQUIRED: 'Please check in with your phone number first.',
    QR_VISIT_CLOSED: 'This visit has ended. Start a new visit.',
    QR_VISIT_PENDING: 'Your first order needs staff approval.',
    QR_WAIT_FOR_APPROVAL: 'Please wait until your first order is approved.',
    QR_RETRY: 'Your table changed. Please try again.',
    QR_NO_ACTIVE_BILL: 'You can request the check once your order is approved.',
    QR_SESSION_EXPIRED: 'Your session expired. Please start a new visit.',
    QR_SESSION_CONFLICT: 'This order belongs to a different visit. Contact our team.',
    QR_PRICE_CHANGED: 'Prices have changed. Please refresh the menu before ordering.',
    QR_PRODUCT_UNAVAILABLE: 'An item is unavailable. Refresh the menu.',
    QR_RATE_LIMITED: 'Too many attempts. Please wait and try again.',
    QR_REQUEST_EXPIRED: 'This request has expired. Please submit it again.',
    QR_ORDER_REFRESH_REQUIRED: 'Your order has changed. Please reopen it.',
  };
  for(const [code,text] of Object.entries(map)) if(message.includes(code)) return text;
  return 'Unable to complete the action. Please try again or contact our team.';
}
