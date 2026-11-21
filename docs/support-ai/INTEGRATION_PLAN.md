# Premier AI Support — خطة دمج الرد الآلي وضوابط الأمان

> **حالة التنفيذ الحالية: تصميم فقط، الإرسال الآلي غير مفعل.**  
> GitHub: `Premieros/.com` — قاعدة البيانات المقصودة `hvqlkapynjfjikqithvd` وليست قواعد الحسابات الأخرى المتصلة.
> لا تنشئ migrations أو تنشر Edge Functions على مشروع آخر. مطلوب ربط حساب Supabase الصحيح وفحص الجداول المباشرة قبل التنفيذ.

## الوضع الفعلي المؤكد من كود المشروع
- الواجهة: `src/components/CustomerSupportLauncher.tsx`، العميل يبدأ محادثة ويرسل رسائل. الواجهة تسحب الرسائل كل 8 ثوانٍ.
- الإدارة: `src/features/admin/pages/SupportInboxTab.tsx` تعرض المحادثات وترسل الرد وتغلق/تفتح المحادثة.
- API: `src/api/domains/support.ts` عبر RPC.
- قاعدة البيانات: migration `20261007161000_customer_support_chat.sql` يتضمن `support_conversations` و`support_messages` مع `sender_kind` الحالي `customer | support`. فتح المحادثة يُدرج إقرار استلام ثابتًا آليًا باسم support من نفس معرف المستخدم؛ **لا يجب الخلط بين هذا الإقرار وبين رد نموذج AI**.
- توجد `get_erp_agent_readiness_context_v2` لكنها مُخصصة لأدلة جاهزية ERP و`agent_execution_enabled=false`؛ لا تمنحها صلاحيات أو تخلطها مع دعم العملاء.
- لا يوجد `supabase/functions/` في المستودع الحالي؛ لا يوجد worker ذكاء اصطناعي للدعم متصل بهذه الواجهة.
- إعدادات/حالة النشر الحية لم تُتحقق من الحساب المتصل. التغييرات في GitHub لا تعني توفرها لدى العميل فورًا.

## سلوك الإصدار الأول (MVP)
1. **البداية:** إظهار «مساعد آلي» وليس «ممثل خدمة العملاء»، مع زر «تواصل مع موظف».
2. **تصنيف:** منخفض المخاطر (مساعدة عامة)، أو يتطلب مراجعة بشرية، أو محظور، بفلترة برمجية وتقييم الموديل.
3. **معرفة:** استرجاع مقالات معتمدة، بلغة العميل، نسخة النظام المنشور، ونطاق صلاحيات المستخدم.
4. **قرار:** لا ترسل دون مصدر موثوق ومخاطر منخفضة. توقف عن الرد الآلي في المحادثة بمجرد اختيار موظف أو تدخل موظف.
5. **حفظ:** كل قرار يتضمن إصدار سياسة النموذج ومقالات المصدر والتوقيت وحالة التصعيد؛ لا تسجل مفاتيح أو بيانات حساسة.
6. **مراقبة:** صندوق المشرف يظهر الردود الآلية مميزة عن البشرية مع إمكانية التصحيح والتصعيد.

## المعمارية الآمنة المقترحة

```text
CustomerSupportLauncher
    |
    | authenticated support RPC (existing)
    v
support_messages (Postgres, tenant/creator scoped)
    |
    +--> secure enqueue/outbox for customer messages only
             |
             v
       Server-side worker (Supabase Edge Function / trusted backend)
         - checks origin and message status, identity and tenant
         - loads only permitted APPROVED knowledge (release-specific)
         - strips secrets/PII; bounds input size, rate, output
         - calls configured model with SERVER secret
         - structured answer + deterministic policy validation
         - idempotent append as AI identity or queue human review
             |
             v
       support_messages / support_handoffs / audit
             |
             +--> customer UI + Super Admin inbox
```

**ممنوع:** استدعاء الموديل من `VITE_*` في المتصفح؛ حفظ مفاتيح API في المستودع أو صفحات GitHub Pages؛ منح الموديل صلاحيات service_role أو SQL؛ تنفيذ write commands. يُستخدم مفتاح الخادم خلف بيئة استضافة موثوقة فقط.

## تصميم بيانات مقترح (غير مطبق)
- `support_kb_articles`: `id`, `organization_scope`, `language`, `title`, `body`, `status` (draft/approved/retired), `release_id`, `min_permission`, `source_path`, `approved_by`, `approved_at`, `version`.
- `support_ai_runs`: `id`, `conversation_id`, `customer_message_id` (unique idempotency), `status`, `decision`, `policy_version`, `source_article_versions`, `safety_flags`, `created_at`, `completed_at`؛ لا تحتفظ بمحتوى حساس خام.
- `support_handoffs`: `conversation_id`, `requested_by`, `reason`, `status`, `assigned_to`, `created_at`؛ يجب منع تكرار التصعيد.
- ميزة تسمح بإطفاء الردود الآلية في أي وقت من لوحة المدير العام؛ افتراضيًا `enabled=false`.
- تحديث `support_messages` لتمييز رسائل `ai` بصورة صحيحة، مع معرف actor خدمة حقيقي أو تصميم attribution واضح غير منتحل للمستخدم. **لا تضع AI sender تحت user_id الخاص بالعميل**.
- يحتاج أي منح صلاحية/سياسة RLS/RPC إلى تدقيق منفصل من قاعدة الإنتاج؛ لا تعتمد اقتراح الأعمدة قبل تأكيد المخطط الحي.

## تمييز الإجابة عن الإجراءات
- المستوى 0: مقالات دعم معتمدة فقط، وطلبات تصعيد. **هذا هدف MVP.**
- المستوى 1: أدوات قراءة محددة (حالة اشتراك العميل ذاته مثلًا) بتفويض وصلاحية وaudit، ومخرجات محدودة؛ ليس ضمن MVP.
- المستوى 2: كتابة بيانات النظام ممنوعة على هذا المساعد، حتى لو توفر إصدار آخر لوكيل مهام مع موافقات مستقلة.

## ضوابط مهمة في الخلفية
1. **Identity / tenancy:** استنتج user_id وorganization_id من توكن verified ومن قاعدة البيانات، لا من نص العميل أو مدخلات الموديل. احترم التحقق من صلاحية الفرع.
2. **Knowledge access:** مرّر إلى الموديل فقط مقالات `approved` المطابقة للنسخة والدور. مصادر غير موثوقة لا تعطي تعليمات للموديل.
3. **Prompt injection:** الرسائل، صور الأخطاء والمستندات لا تنقل أي تعليمات أعلى من سياسة النظام؛ فلتر الطلبات بمحرك قابل للاختبار.
4. **Human control:** عند ظهور رد بشري أو طلب تحويل، علّق عامل الرد التلقائي على هذه المحادثة؛ لا تناقش الشكوى مع نموذج مرارًا.
5. **Operational:** retry/backoff، idempotency per message، timeout، rate limit per user/tenant، منع الرد على رد الآلة، عدم تعديل رسالة بشرية.
6. **Auditing:** احتفظ بسبب القرار وإصدارات المقالات دون أسرار؛ سياسة احتفاظ واضحة ومراجعة قبل إدخال بيانات العميل إلى المزود.
7. **Truthfulness:** لا تصف سياسة مالية/سعر/ميزة غير مثبتة، ولا تدّع حدثًا أو استعلامًا أو تشغيلًا غير منفذ.
8. **Fail closed:** عند غياب المفتاح أو اتصال النموذج أو قاعدة المعرفة المعتمدة يعود النظام إلى الدعم البشري الحالي، دون تعطيل استقبال البلاغات.

## خطة تنفيذ مراجَعة
- [ ] ربط Supabase الصحيح وقراءة الجداول/القيود/سياسات RLS الحالية للـ support دون تعديل.
- [ ] استخراج مقالات قاعدة معرفة مراجعة من نسخة الواجهة المنشورة؛ قبولها من المنتج/الدعم.
- [ ] إضافة migration forward-only وRPC مخصصة مقيّدة مع rollback ومراجعة CI.
- [ ] إنشاء العامل الآمن وتخزين مفتاح مزود النموذج في الخادم (لا `VITE_*`)، وضبط الميزانية والحدود.
- [ ] اقتراح الرد أولًا للموظف في الـ Inbox (human in the loop)، وجمع حالات الخلل.
- [ ] تشغيل الرد تلقائيًا للأسئلة المعروفة والمنخفضة المخاطر فقط بعد اختبارات `ACCEPTANCE_CASES.md`، مع مفتاح إيقاف.
- [ ] التحقق من إطلاق التطبيق إلى المستضيف الذي يستخدمه العملاء (GitHub Pages / Vercel كلٌّ بحسب الواقع).

## تعريف النجاح
- الرد الآلي يوضح هويته ويستشهد داخل النظام بمقالة معتمدة.
- لا يسرّب بيانات عميل آخر أو أسرارًا، ولا ينفذ mutations.
- لا يجيب عن حالة مالية غير موثقة أو برنامج/سعر غير معتمد.
- يتيح تصعيدًا بشريًا فعليًا قابلًا للتتبع.
- لا يضاعف الردود عند إعادة المحاولة أو تحديث العميل؛ يبقى نظام المحادثات اليدوي يعمل عند فشل النموذج.
