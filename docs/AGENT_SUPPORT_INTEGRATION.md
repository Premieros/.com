# ربط مساعد AGENT بنظام Premier (.com)

هذا التكامل اختياري ومغلق افتراضيًا. لا يغيّر قاعدة بيانات Premier ولا تسجيل دخوله، ولا يرسل رموز Supabase أو بيانات POS تلقائيًا إلى AGENT.

## كيف يعمل
- يستخدم `CustomerSupportLauncher` نافذة Premier البشرية الموجودة افتراضيًا.
- عند تفعيل المتغيرات أدناه، تظهر **نافذة AGENT محلية داخل React** بدل نافذة Premier، وليس الاثنتان معًا.
- عند فشل اتصال AGENT، يظهر خيار العودة إلى الدعم البشري.
- لا يتم تحميل أي JavaScript خارجي من AGENT داخل لوحة Premier. ترسل الواجهة فقط سؤال الزائر ورمز جلسته الخاص بشات AGENT.
- لا يتصل AGENT بقاعدة بيانات Premier `hvqlkapynjfjikqithvd`؛ قاعدة AGENT منفصلة `gldlgdycgneadbqftcrj`.

## التفعيل بعد اختبار AGENT

### 1) من لوحة AGENT
1. تأكد من ترحيل `20261103_support_ai_multproject.sql`، ثم طبّق `20261103_support_public_limits.sql` **على قاعدة AGENT فقط** بعد أخذ نسخة احتياطية واختبار staging.
2. تحقق من إعداد خادم AGENT: `SUPABASE_SERVICE_ROLE_KEY` مخزن على الخادم فقط، موفر AI مناسب، وسياسات الأمان وحدود الاستخدام.
3. اضبط `SUPPORT_PUBLIC_CHAT_ENABLED=true` **على نشر AGENT الآمن فقط** بعد الاختبار. القيمة الافتراضية تعطيل.
4. من `/support` اختر المشروع الصحيح، أضف قاعدة المعرفة، ثم أضف **HTTPS origin المطابق تمامًا لنطاق Premier المُستخدم** (مثال `https://your-premier-domain.com` دون مسارات أو `/` ختامية).
5. انسخ `Widget Key` ذو 48 خانة من إعداد الموقع.

### 2) من إعدادات نشر Premier (.com)
اضبط المتغيرات في بيئة Premier (مثل Vercel → Environment Variables):

```env
VITE_AGENT_SUPPORT_ENABLED=true
VITE_AGENT_SUPPORT_ORIGIN=https://YOUR-AGENT-DEPLOYMENT-HOST
VITE_AGENT_SUPPORT_WIDGET_KEY=YOUR_48_CHARACTER_PUBLIC_WIDGET_KEY
```

`VITE_AGENT_SUPPORT_ORIGIN` هو **أصل موقع AGENT** HTTPS فقط، من دون `/support` أو مسار، مثل نطاق AGENT الثابت الذي تديره. لا تستخدم نطاقًا مختلفًا كل مرة؛ يجب أن تسمح سياسة الموقع في AGENT بالـ origin الفعلي لنشر Premier.

أعِد بناء Premier بعد تغيير المتغيرات: Vite يستبدل `VITE_*` أثناء البناء وليس وقت تشغيل المتصفح.

### 3) اختبارات ما قبل النشر
1. تأكد أن مستخدم Premier المسجّل يرى **زر دعم واحدًا** فقط.
2. أرسل سؤالًا موجودًا في قاعدة معرفة المشروع، وتأكد من الرد.
3. جرّب السؤال من نطاق آخر غير مصرح: يجب رفضه.
4. عطّل `SUPPORT_PUBLIC_CHAT_ENABLED` في AGENT وتأكد أن نافذة Premier تعرض خيار **الدعم البشري** عند فشل الإرسال.
5. تحقق من أن العملاء والفواتير وبيانات المصادقة في Premier لا تُرسل أبدًا ضمن طلبات AGENT.
6. نفّذ اختبارات الحدّ من الطلبات وعزل المشاريع قبل تفعيل نظام الزوار الفعلي.

## إيقاف الربط
عيّن `VITE_AGENT_SUPPORT_ENABLED=false` في Premier ثم أعِد بناء الموقع. ستعود نافذة الدعم البشرية السابقة دون حذف محادثاتها.

## حدود التكامل
- يعمل داخل تطبيق Premier للمستخدمين المسجلين باستثناء `super_admin`؛ لم يتم جعله شاتًا عامًا لزوار موقع تسويقي منفصل.
- رسائل AGENT تخزن في قاعدة AGENT عندما ينجح تفعيل واجهاتها العامة، وليس في جداول دعم Premier الأصلية.
- لا تضع أي مفتاح سري مثل `SUPABASE_SERVICE_ROLE_KEY` أو رموز مزود AI في متغيرات `VITE_*`.
- استخدام مفتاح عام هنا متوقع؛ حماية الربط تعتمد على قائمة `allowed_origin` والتحقق من الجلسات وحدود الطلبات على خادم AGENT.
