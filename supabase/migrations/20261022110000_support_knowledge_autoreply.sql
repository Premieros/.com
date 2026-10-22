-- Premier Support: read-only, documented FAQ auto-replies. No model/API secret, no ERP writes.
-- Canonical project: hvqlkapynjfjikqithvd. Rollout enabled per explicit platform-owner request.
-- Existing human support chat, acknowledgements, RPC access, and message history are preserved.

ALTER TABLE public.support_messages
  ALTER COLUMN sender_user_id DROP NOT NULL;
ALTER TABLE public.support_messages
  ADD COLUMN IF NOT EXISTS is_ai boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS in_reply_to uuid REFERENCES public.support_messages(id) ON DELETE SET NULL;

ALTER TABLE public.support_messages
  ADD CONSTRAINT support_message_actor_attribution_check
  CHECK ((is_ai AND sender_kind = 'support' AND sender_user_id IS NULL)
      OR (NOT is_ai AND sender_user_id IS NOT NULL));

CREATE UNIQUE INDEX IF NOT EXISTS support_one_ai_reply_per_message
  ON public.support_messages(in_reply_to) WHERE is_ai AND in_reply_to IS NOT NULL;

ALTER TABLE public.support_conversations
  ADD COLUMN IF NOT EXISTS ai_handoff boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.support_ai_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled boolean NOT NULL DEFAULT false,
  mode text NOT NULL DEFAULT 'verified_faq' CHECK (mode = 'verified_faq'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.support_ai_settings(singleton, enabled, mode)
VALUES (true, true, 'verified_faq')
ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.support_ai_articles (
  id text PRIMARY KEY,
  phrases text[] NOT NULL,
  reply_ar text NOT NULL,
  reply_en text NOT NULL,
  approved boolean NOT NULL DEFAULT false,
  priority integer NOT NULL DEFAULT 100,
  source text NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.support_ai_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_ai_articles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.support_ai_settings, public.support_ai_articles FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.support_ai_settings, public.support_ai_articles TO service_role;

INSERT INTO public.support_ai_articles(id,phrases,reply_ar,reply_en,approved,priority,source)
VALUES
('nav-pos', ARRAY['نقطة البيع','الكاشير','pos'], 'يمكنك فتح «نقطة البيع» من القائمة إذا كان لحسابك حق الوصول. إذا لم تظهر، اطلب من مسؤول مؤسستك مراجعة الصلاحيات. هل تريد إرشادًا عامًا أم تواجه رسالة خطأ؟', 'Open POS from the menu if your account has permission. If it is missing, ask your organization admin to check your access. Are you looking for general guidance or seeing an error?',true,10,'src/app/routes.tsx:APP_ROUTES.pos'),
('nav-inventory', ARRAY['مركز المخزون','المخزون','inventory'], 'افتح «مركز المخزون» من القائمة إذا كانت صلاحيتك تسمح. لعرض التفاصيل اختر شاشة المخزون أو دفتر الحركات. لا أستطيع تأكيد الأرصدة الفعلية من هذه المحادثة.', 'Open the Inventory Center if you have access, then select inventory or inventory ledger. I cannot verify actual balances in this chat.',true,20,'src/app/routes.tsx:APP_ROUTES.inventoryCenter'),
('nav-warehouse', ARRAY['المخازن','المخزن','warehouse'], 'يمكنك الوصول إلى «المخازن» من مركز المخزون إذا كان دورك يسمح بذلك. لا أستطيع إجراء تحويلات أو تعديل كميات من المحادثة.', 'Warehouses are available through Inventory Center if your role allows it. I cannot perform stock transfers or change quantities here.',true,30,'src/app/routes.tsx:APP_ROUTES.warehouses'),
('nav-purchases', ARRAY['المشتريات','الموردين','procurement','purchases'], 'يمكنك فتح «مركز المشتريات» من القائمة إذا كنت مخولًا. اختر المشتريات أو طلبات الشراء أو الاستلام حسب العملية المطلوبة. لا أستطيع تأكيد استلام أو رصيد مورد من المحادثة.', 'Open Procurement Center if authorized, then choose purchases, purchase requests, or receiving. I cannot confirm receipts or supplier balances from chat.',true,40,'src/app/routes.tsx:APP_ROUTES.procurementCenter'),
('nav-reports', ARRAY['التقارير','reports'], 'يمكنك فتح «التقارير» من القائمة إذا كانت لديك الصلاحية. الأرقام المالية الفعلية تحتاج مراجعتها داخل النظام بواسطة مستخدم مخوّل.', 'Open Reports from the menu if you have permission. Actual financial figures must be reviewed in the system by an authorized user.',true,50,'src/app/routes.tsx:APP_ROUTES.reports'),
('nav-products', ARRAY['المنتجات','product'], 'يمكنك فتح «المنتجات» من القائمة إذا كان لحسابك إذن العرض. لا أغيّر الأسعار أو الوصفات من محادثة الدعم.', 'Open Products from the menu if you have access. I do not change prices or recipes from support chat.',true,60,'src/app/routes.tsx:APP_ROUTES.products'),
('nav-kitchen', ARRAY['المطبخ','kitchen'], 'يمكنك فتح «شاشة المطبخ» إن توفرت لك صلاحية العرض. إذا كانت الطلبات لا تظهر كما تتوقع، صف رسالة الخطأ أو اسم الشاشة ليراجعها فريق الدعم.', 'Open Kitchen Display if authorized. If orders are missing, describe the screen or error so human support can investigate.',true,70,'src/app/routes.tsx:APP_ROUTES.kitchenDisplay')
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.support_ai_decide(p_text text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = 'public', 'pg_temp'
AS $function$
DECLARE
  v_text text := lower(btrim(coalesce(p_text,'')));
  v_ar boolean;
  v_article public.support_ai_articles%ROWTYPE;
BEGIN
  v_ar := v_text ~ '[ء-ي]';
  IF length(v_text) = 0 THEN
    RETURN jsonb_build_object('action','handoff','reason','empty_message','reply',
      CASE WHEN v_ar THEN 'الرجاء توضيح استفسارك لفريق الدعم.' ELSE 'Please describe your question for support.' END);
  END IF;

  -- Fail closed on requests involving payments, security, account data, errors or a human agent.
  IF v_text ~* '(موظف|بشري|شخص حقيقي|شكوى|فشل|عطل|مشكلة|خطأ|خطا|فاتور|دفع|مبلغ|فلوس|خصم|مرتجع|استرجاع|رصيد|تكلف|حذف|امسح|تعديل|تغيير|تحويل|صلاح|اشتراك|سعر|أسعار|رقم حساب|بيانات|شخصية|سرية|كلمة سر|باسورد|اختراق|احتيال|خسار|فلوسي|حسابات|قيد|يومية|تسوية|جرد|فرق|فروقات|رصيد|support agent|human|person|refund|invoice|payment|billing|financial|balance|cost|delete|access denied|permission|password|account|price|subscription|error|bug|issue|failed|charge|duplicate|stock count)' THEN
    RETURN jsonb_build_object('action','handoff','reason','sensitive_or_human','reply',
      CASE WHEN v_ar
        THEN '🤖 أنا مساعد Premier الآلي. هذه الحالة تحتاج مراجعة موظف الدعم، لذلك لن أخمّن أو أعدّل بياناتك. يمكنك كتابة اسم الشاشة والفرع ووصف الخطأ دون كلمات مرور أو بيانات دفع؛ ستبقى المحادثة متاحة لفريق الدعم.'
        ELSE '🤖 I am Premier automated support. This needs human review, so I will not guess or change your data. Please describe the screen, branch and error without passwords or payment details; the conversation remains available to support.' END);
  END IF;

  IF v_text IN ('اهلا','أهلا','مرحبا','مرحباً','السلام عليكم','hi','hello','hey') THEN
    RETURN jsonb_build_object('action','answer','article_id','greeting','reply',
      CASE WHEN v_ar
        THEN '🤖 أهلًا بك! أنا مساعد Premier الآلي. أستطيع إرشادك إلى صفحات النظام الموثقة، وأحوّل المسائل المالية والحساسة لموظف الدعم. ما الشاشة التي تريد المساعدة فيها؟'
        ELSE '🤖 Hello! I am Premier automated support. I can guide you through verified system screens and refer sensitive issues to human support. Which area do you need help with?' END);
  END IF;

  SELECT a.* INTO v_article
  FROM public.support_ai_articles a
  WHERE a.approved
    AND EXISTS (SELECT 1 FROM unnest(a.phrases) phrase WHERE strpos(v_text, lower(phrase)) > 0)
  ORDER BY a.priority, a.id LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object('action','answer','article_id',v_article.id,'reply',
      '🤖 ' || CASE WHEN v_ar THEN v_article.reply_ar ELSE v_article.reply_en END);
  END IF;

  RETURN jsonb_build_object('action','handoff','reason','no_approved_answer','reply',
    CASE WHEN v_ar
      THEN '🤖 أنا مساعد Premier الآلي. لا أملك إجابة مؤكدة لهذا السؤال من دليل النظام المعتمد؛ سأترك المحادثة مفتوحة ليراجعها موظف الدعم. يرجى توضيح اسم الشاشة أو المشكلة دون مشاركة أسرار.'
      ELSE '🤖 I am Premier automated support. I have no verified answer for this from the approved knowledge base; I will leave the chat open for human support. Please describe the screen or issue without sharing secrets.' END);
END;
$function$;

CREATE OR REPLACE FUNCTION public.support_ai_process_message()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $function$
DECLARE
  v_enabled boolean;
  v_status text;
  v_handoff boolean;
  v_created_by uuid;
  v_decision jsonb;
BEGIN
  IF NEW.sender_kind = 'support' AND NOT NEW.is_ai THEN
    SELECT c.created_by INTO v_created_by
    FROM public.support_conversations c WHERE c.id = NEW.conversation_id;
    -- Ignore existing automated acknowledgement (attributed historically to customer).
    IF NEW.sender_user_id IS DISTINCT FROM v_created_by THEN
      UPDATE public.support_conversations
      SET ai_handoff = true
      WHERE id = NEW.conversation_id AND NOT ai_handoff;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.sender_kind <> 'customer' THEN RETURN NEW; END IF;

  SELECT c.status,c.ai_handoff INTO v_status,v_handoff
  FROM public.support_conversations c WHERE c.id = NEW.conversation_id FOR UPDATE;
  IF v_status IS DISTINCT FROM 'open' OR coalesce(v_handoff,true) THEN RETURN NEW; END IF;
  SELECT s.enabled INTO v_enabled FROM public.support_ai_settings s WHERE s.singleton = true;
  IF NOT coalesce(v_enabled,false) THEN RETURN NEW; END IF;

  v_decision := public.support_ai_decide(NEW.body);
  IF v_decision->>'action' = 'handoff' THEN
    UPDATE public.support_conversations SET ai_handoff = true
    WHERE id = NEW.conversation_id;
  END IF;

  INSERT INTO public.support_messages
    (conversation_id,sender_user_id,sender_kind,body,is_ai,in_reply_to)
  VALUES (NEW.conversation_id,NULL,'support',left(v_decision->>'reply',4000),true,NEW.id)
  ON CONFLICT DO NOTHING;

  UPDATE public.support_conversations
  SET last_message_at = clock_timestamp(),updated_at = clock_timestamp()
  WHERE id = NEW.conversation_id;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'support_ai_process_message failed, preserving customer message: %', SQLSTATE;
  RETURN NEW;
END;
$function$;

-- Disable automatic follow-ups as soon as a human support member replies.
CREATE TRIGGER support_ai_human_takeover
AFTER INSERT ON public.support_messages
FOR EACH ROW WHEN (NEW.sender_kind = 'support' AND NOT NEW.is_ai)
EXECUTE FUNCTION public.support_ai_process_message();

-- Deferred: the legacy fixed acknowledgement is stored before the AI FAQ answer.
CREATE CONSTRAINT TRIGGER support_ai_deferred_customer_reply
AFTER INSERT ON public.support_messages DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW WHEN (NEW.sender_kind = 'customer')
EXECUTE FUNCTION public.support_ai_process_message();

CREATE OR REPLACE FUNCTION public.support_ai_status()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $function$
DECLARE v_enabled boolean; v_count bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_super_admin() THEN
    RETURN jsonb_build_object('success',false,'error','SUPER_ADMIN_REQUIRED');
  END IF;
  SELECT enabled INTO v_enabled FROM public.support_ai_settings WHERE singleton;
  SELECT count(*) INTO v_count FROM public.support_ai_articles WHERE approved;
  RETURN jsonb_build_object('success',true,'enabled',coalesce(v_enabled,false),
                            'mode','verified_faq','approved_articles',v_count);
END;
$function$;

CREATE OR REPLACE FUNCTION public.support_ai_set_enabled(p_enabled boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_super_admin() THEN
    RETURN jsonb_build_object('success',false,'error','SUPER_ADMIN_REQUIRED');
  END IF;
  IF p_enabled IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','INVALID_ENABLED_VALUE');
  END IF;
  UPDATE public.support_ai_settings SET enabled = p_enabled, updated_at=now() WHERE singleton;
  RETURN jsonb_build_object('success',true,'enabled',p_enabled,'mode','verified_faq');
END;
$function$;

REVOKE ALL ON FUNCTION public.support_ai_decide(text),
                       public.support_ai_process_message(),
                       public.support_ai_status(),
                       public.support_ai_set_enabled(boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.support_ai_status(),
                          public.support_ai_set_enabled(boolean)
  TO authenticated, service_role;

COMMENT ON TABLE public.support_ai_articles IS
  'Verified, bounded and read-only FAQ. AI provider/model generation is NOT enabled.';
COMMENT ON TABLE public.support_ai_settings IS
  'Kill switch for narrow automatic knowledge-base responses. Default is on after this migration.';