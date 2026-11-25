# Premier — قائمة اعتماد الـ55 تطابقًا الحرفي وخطة معالجة الـ35 حالة المانعة

**الحالة: Evidence-only / REVIEW REQUIRED.** وثيقة مراجعة ضمن PR #155، وليست SQL قابلًا للتنفيذ. لا تُغيّر قاعدة الإنتاج أو سجل الهجرات.

المصدر الثابت: `docs/database/migration-history-audit-20261110/matrix.json`، وهو سجل 150 ملفًا مطابقًا لمصدر GitHub main `4542021dc1dc3ce20ccc20328b548e995c223c0a`. في هذه القائمة **55 حالة فقط** لديها مطابقة SHA-256 حرفية مع سجل إنتاج واحد. لا يُستنتج من ذلك اكتمال أثر الهجرة بعد تعديلات لاحقة، ولا تُطبَّق ملفات SQL مرة ثانية.

## قواعد ما قبل أي موافقة مستقبلية على إقرار سجل الهجرات

1. تأكد من هوية Supabase `hvqlkapynjfjikqithvd` وGitHub `Premieros/.com`، وأن HEAD والمصفوفة لم يتغيرا. إن تغيّرا، أعد توليد المقارنة؛ لا تعتمد هذه القائمة وحدها.
2. نفّذ **قراءة فقط** لكل اسم ملف وبصمة SHA-256 من `public.schema_migrations`؛ يجب ألا يكون أي اسم/نسخة مسجلًا مسبقًا ببصمة أخرى، ويجب أن يطابق ملف Git الأصلي.
3. افحص أن سجل `supabase_migrations.schema_migrations` ما زال يحتوي **المقابل الوحيد** والـSQL الأصلي بالبصمة المحددة؛ أي غموض أو اختلاف أو هجرة إضافية يُوقف الدفعة.
4. تأكد من عدم إعادة تشغيل DDL أو بيانات أعمال: أي إقرار مستقبلي هو **metadata-only** داخل `public.schema_migrations`، ولا يمس جداول المبيعات أو المخزون أو القيود أو سياسات RLS أو الدوال.
5. صمّم SQL منفصلًا محددًا ومغلقًا (fail-closed): نسخة احتياطية موثقة للـledger، شرط عدم التكرار، شرط تطابق عدد السجلات قبل وبعد، وحصر التغيير في هويات الملفات المصرّح بها. لا تُعمّم سكربت الإقرارات الثلاثة السابقة بلا تعديل.
6. اختبر طلب الإقرار كاملًا على PostgreSQL مؤقت **غير إنتاجي** بما فيه فشل إدراج في منتصف الدفعة، وتحقق من rollback الكامل؛ اختبر إعادة الطلب لمنع الإقرار المتكرر والاختلاف في البصمة.
7. يلزم **اعتماد صريح جديد لدفعة الـ55 بأسمائها** قبل أي كتابة في الإنتاج. لا تُدمج PR #155 أو تشغّل auto-merge أو deployment بهذا المستند.

## 55 ملفًا — تطابق حرفي مع قيد إنتاج وحيد

العمود الأخير هو بادئة بصمة SHA-256 للعرض فقط؛ **البصمة الكاملة المعتمدة في matrix.json**.

| # | الملف المحلي | نسخة سجل إنتاج Supabase | SHA-256 (بادئة) |
|---:|---|---|---|
| 1 | `20260928161500_dashboard_sales_snapshot.sql` | `20260929111943` | `e77e711f75593d80…` |
| 2 | `20260928170000_system_health_snapshot.sql` | `20260929111949` | `740b157b9491bfd0…` |
| 3 | `20260928231500_costing_linked_component_groups.sql` | `20261007144421` | `c9fd63c367879001…` |
| 4 | `20260928233000_costing_theoretical_recipe_source.sql` | `20261007144423` | `4e8a0c84684fd967…` |
| 5 | `20260930001000_treasury_business_day_chain_reconciliation.sql` | `20261007150227` | `d5de8e685f2f676b…` |
| 6 | `20260930004000_shift_refund_single_deduction.sql` | `20261007150220` | `a55d8078052db33f…` |
| 7 | `20260930173500_kds_served_order_incremental_resend.sql` | `20261007150123` | `5f3ba76409479325…` |
| 8 | `20261002204500_pos_sale_idempotency_guard.sql` | `20261007145835` | `6ccbf5f08af3c76b…` |
| 9 | `20261003030000_erp04_stock_count_accounting_posting.sql` | `20261007150012` | `da018cf8a861fd6c…` |
| 10 | `20261003093000_allow_negative_stock_server_policy.sql` | `20261003103213` | `97b32715f7c394a4…` |
| 11 | `20261003094000_harden_negative_stock_debt_tables.sql` | `20261003092937` | `a95bf9c025a1e22a…` |
| 12 | `20261003114500_fix_production_order_raw_warehouse.sql` | `20261003120340` | `d29ed428c9f1e76b…` |
| 13 | `20261003115500_restore_sale_finished_stock_routing.sql` | `20261003120345` | `3a264d337c0389f1…` |
| 14 | `20261003123000_erp05_waste_fifo_approval.sql` | `20261007150018` | `b73f2ba41e37457b…` |
| 15 | `20261006095108_kds_finish_empty_order.sql` | `20261007150128` | `9d00953ad813171e…` |
| 16 | `20261008120500_recursive_product_composition_cost.sql` | `20261008090819` | `6937dab04a45ca9b…` |
| 17 | `20261008122500_product_live_costs.sql` | `20261008090929` | `6832ad629feecc88…` |
| 18 | `20261011064018_phase5d_append_only_payment_reclassification.sql` | `20261011064018` | `290e6d8f1c6cd108…` |
| 19 | `20261011065554_phase5g_purchase_correction_insert_time_journal_dates.sql` | `20261011065554` | `b69de956bb7f8914…` |
| 20 | `20261011080408_phase4d_component_cost_evidence.sql` | `20261011080408` | `749c966d217be1eb…` |
| 21 | `20261011081037_phase4d_fail_closed_missing_component_cost.sql` | `20261011081037` | `38b5d35175a47a80…` |
| 22 | `20261011085158_phase5h_organization_coa_readiness.sql` | `20261011085158` | `f63b791e66da86f7…` |
| 23 | `20261011092600_phase5i_organization_account_shadow.sql` | `20261011092600` | `a0527253253cdea5…` |
| 24 | `20261011101007_phase5j_controlled_org_account_sync.sql` | `20261011101007` | `db70c77fb97a6b7c…` |
| 25 | `20261011104816_phase5k_org_account_workbench_read_api.sql` | `20261011104816` | `752f635617a2d34d…` |
| 26 | `20261011105332_phase5k_unmapped_existing_master_preview.sql` | `20261011105332` | `f263a6c8e1ce7106…` |
| 27 | `20261011113106_phase5l_org_journal_identity_bridge.sql` | `20261011113106` | `c8917c1b237da12a…` |
| 28 | `20261011113110_phase6_procurement_receipt_integrity.sql` | `20261011113110` | `1040476eec60e182…` |
| 29 | `20261011113114_phase8_event_outbox_phase9_agent_context.sql` | `20261011113114` | `832845f29702ccbe…` |
| 30 | `20261011130910_phase8b_verified_event_consumer.sql` | `20261011130910` | `e215bd76dea179eb…` |
| 31 | `20261012134314_purchase_return_fifo_shortage_guard.sql` | `20261012134314` | `d152633ab0b14ba2…` |
| 32 | `20261013060012_receipt_atomicity_fail_closed.sql` | `20261013060012` | `1bcde1a409bb3916…` |
| 33 | `20261022123000_guarded_inactive_organization_deletion.sql` | `20261022083851` | `00ac367692e7a090…` |
| 34 | `20261022154500_owner_tenant_branch_isolation.sql` | `20261022090902` | `c8edd55b0f99d001…` |
| 35 | `20261022170000_public_trial_signup_bootstrap_fix.sql` | `20261022094134` | `62e898ba07e4858a…` |
| 36 | `20261022171000_global_super_admin_detachment.sql` | `20261022094146` | `76e8bd349bdd8fea…` |
| 37 | `20261022190000_floor_plan_custom_area_management.sql` | `20261022095729` | `96b59a212f79dbe2…` |
| 38 | `20261022193000_full_organization_purge.sql` | `20261022102936` | `a4f073fcc3dae224…` |
| 39 | `20261022205000_fix_pos_bootstrap_trigger_and_purge_logging.sql` | `20261022110426` | `eb9291801e96610e…` |
| 40 | `20261022211000_full_org_purge_multi_branch_guards.sql` | `20261022110437` | `0bcf255a5d1919a0…` |
| 41 | `20261022232000_full_org_purge_immutable_evidence.sql` | `20261022114212` | `d3e03140f49dd531…` |
| 42 | `20261022235000_full_org_purge_sales_before_customers.sql` | `20261022115723` | `127167364ed62064…` |
| 43 | `20261022235900_full_tenant_purge_fifo_ledger_references.sql` | `20261022120420` | `d09d5976da346b73…` |
| 44 | `20261022235910_full_organization_deletion_rpc_timeout.sql` | `20261022124549` | `ad18819b0898b362…` |
| 45 | `20261023000500_async_org_delete_queue.sql` | `20261022131308` | `2d7a75684d6d4e07…` |
| 46 | `20261023013000_full_org_delete_stock_count_fk.sql` | `20261022154714` | `0d5a71df3eed18e6…` |
| 47 | `20261023232000_correct_unified_raw_engine_schema_and_replay.sql` | `20261023152041` | `ca3d2afe9e891d4b…` |
| 48 | `20261026233000_unify_ready_product_sale_stock_cost_and_lock.sql` | `20261026201549` | `12f17ac3e8b5bdb9…` |
| 49 | `20261027084000_unified_current_stock_position.sql` | `20261027053343` | `a39f89a8eb068dea…` |
| 50 | `20261027095500_manufactured_units_authorized_branch_visibility.sql` | `20261027073700` | `95e84aff5dcbd658…` |
| 51 | `20261027110322_raw_material_single_row_cached_costs.sql` | `20261027110322` | `09547feae1fe4415…` |
| 52 | `20261027143000_recipe_cost_context_from_cached_raw_prices.sql` | `20261027113242` | `bd498961d52a4932…` |
| 53 | `20261027144500_publish_completed_purchase_raw_cost_incrementally.sql` | `20261027113412` | `2bb3691325ff12d3…` |
| 54 | `20261027191000_enforce_financial_rpc_branch_authorization.sql` | `20261027182002` | `5d44186ccdb96697…` |
| 55 | `20261027194500_finance_treasury_and_reconciliation_branch_guards.sql` | `20261027182457` | `2b685e8738e42b0a…` |

## الحالة الـ56 — غموض مثبت، مستبعدة من أي إقرار تلقائي

`supabase/migrations/20261022185000_opening_balances_readonly_preview.sql` يطابق حرفيًا **قيدين** في سجل الإنتاج: `20261022161346` و `20261022162227`. لا يجوز اختراع قاعدة اختيار أحدهما أو حذف أحد القيدين؛ يلزم قرار توثيقي مستقل.

## 59 حالة ليست متطابقة حرفيًا

- **20** فرق في نهايات الأسطر/المسافات الخارجية فقط.
- **36** فرق في التعليقات الخارجية.
- **3** أشجار SQL متطابقة بعد تجاهل مواضع المصدر، وفق المصفوفة والمحلّل الموثقين.

هذه الفئات تُعد **مرشحة لمراجعة وصفية مستقلة** وليست مشمولة في دفعة الـ55. استخرج لكل حالة تقرير فرق كاملًا وراجع تعريفات النصوص/الامتيازات قبل طلب أي إقرار.

## 35 حالة مانعة — لا إقرار تلقائي ولا إعادة تنفيذ

| # | الملف | سبب التعليق / المطلوب |
|---:|---|---|
| 1 | `20260927095000_auto_business_day_close.sql` | `referenced_private_functions_absent_in_live_catalog` |
| 2 | `20260927133500_reassert_settlement_modifier_order_normalization.sql` | لا توجد مطابقة نصية/بنيوية معتمدة؛ المرشح بالاسم غير كافٍ |
| 3 | `20260927154500_organization_module_controls.sql` | لا توجد مطابقة نصية/بنيوية معتمدة؛ المرشح بالاسم غير كافٍ |
| 4 | `20260928153000_internal_trigger_execute_boundary.sql` | لا توجد مطابقة نصية/بنيوية معتمدة؛ المرشح بالاسم غير كافٍ |
| 5 | `20260929144000_organization_business_profiles.sql` | لا توجد مطابقة نصية/بنيوية معتمدة؛ المرشح بالاسم غير كافٍ |
| 6 | `20261009134308_phase4d_immutable_sale_cost_snapshots.sql` | لا توجد مطابقة نصية/بنيوية معتمدة؛ المرشح بالاسم غير كافٍ |
| 7 | `20261009140019_phase5a_fiscal_period_posting_metadata.sql` | لا توجد مطابقة نصية/بنيوية معتمدة؛ المرشح بالاسم غير كافٍ |
| 8 | `20261011064606_phase5e_append_only_fifo_sale_cogs.sql` | لا توجد مطابقة نصية/بنيوية معتمدة؛ المرشح بالاسم غير كافٍ |
| 9 | `20261011064956_phase5f_append_only_fifo_orphan_and_stock.sql` | لا توجد مطابقة نصية/بنيوية معتمدة؛ المرشح بالاسم غير كافٍ |
| 10 | `20261023150600_raw_published_price_asof_helper.sql` | `canonical_sql_parse_error` |
| 11 | `20261023150700_sale_snapshot_modifier_cost_asof_published_price.sql` | لا توجد مطابقة نصية/بنيوية معتمدة؛ المرشح بالاسم غير كافٍ |
| 12 | `20261023163500_refactor_kitchen_direct_ledger_reference.sql` | لا توجد مطابقة نصية/بنيوية معتمدة؛ المرشح بالاسم غير كافٍ |
| 13 | `20261023170000_sync_kitchen_staged_warehouse_balance.sql` | لا توجد مطابقة نصية/بنيوية معتمدة؛ المرشح بالاسم غير كافٍ |
| 14 | `20261023172500_reconcile_nine_verified_raw_branch_balance_cache_rows.sql` | لا توجد مطابقة نصية/بنيوية معتمدة؛ المرشح بالاسم غير كافٍ |
| 15 | `20261023211500_guard_direct_kitchen_material_replay.sql` | لا توجد مطابقة نصية/بنيوية معتمدة؛ المرشح بالاسم غير كافٍ |
| 16 | `20261023214500_kitchen_stock_precision_guard.sql` | لا توجد مطابقة نصية/بنيوية معتمدة؛ المرشح بالاسم غير كافٍ |
| 17 | `20261023233000_cutover_manufactured_inventory_unit_raw_consumption.sql` | لا توجد مطابقة نصية/بنيوية معتمدة؛ المرشح بالاسم غير كافٍ |
| 18 | `20261023234000_production_order_non_fifo_raw_and_waste.sql` | لا توجد مطابقة نصية/بنيوية معتمدة؛ المرشح بالاسم غير كافٍ |
| 19 | `20261023235000_stock_count_raw_negative_unified_movement.sql` | لا توجد مطابقة نصية/بنيوية معتمدة؛ المرشح بالاسم غير كافٍ |
| 20 | `20261023235500_raw_adjustment_single_warehouse_unified.sql` | لا توجد مطابقة نصية/بنيوية معتمدة؛ المرشح بالاسم غير كافٍ |
| 21 | `20261023235900_purchase_return_raw_document_warehouse_unified.sql` | لا توجد مطابقة نصية/بنيوية معتمدة؛ المرشح بالاسم غير كافٍ |
| 22 | `20261024000500_raw_warehouse_transfer_both_legs_unified.sql` | لا توجد مطابقة نصية/بنيوية معتمدة؛ المرشح بالاسم غير كافٍ |
| 23 | `20261024001500_sale_modifiers_raw_unified.sql` | لا توجد مطابقة نصية/بنيوية معتمدة؛ المرشح بالاسم غير كافٍ |
| 24 | `20261024002500_legacy_sale_unit_raw_unified.sql` | لا توجد مطابقة نصية/بنيوية معتمدة؛ المرشح بالاسم غير كافٍ |
| 25 | `20261024192500_product_fifo_cutover_readiness_gate.sql` | لا توجد مطابقة نصية/بنيوية معتمدة؛ المرشح بالاسم غير كافٍ |
| 26 | `20261024194500_product_non_fifo_batch_compatible_removal.sql` | لا توجد مطابقة نصية/بنيوية معتمدة؛ المرشح بالاسم غير كافٍ |
| 27 | `20261024210500_stock_count_product_removal_non_fifo.sql` | لا توجد مطابقة نصية/بنيوية معتمدة؛ المرشح بالاسم غير كافٍ |
| 28 | `20261024211000_purchase_return_product_removal_non_fifo.sql` | لا توجد مطابقة نصية/بنيوية معتمدة؛ المرشح بالاسم غير كافٍ |
| 29 | `20261024222000_sale_product_non_fifo.sql` | لا توجد مطابقة نصية/بنيوية معتمدة؛ المرشح بالاسم غير كافٍ |
| 30 | `20261024222500_transfer_product_non_fifo.sql` | لا توجد مطابقة نصية/بنيوية معتمدة؛ المرشح بالاسم غير كافٍ |
| 31 | `20261026190000_unified_stock_balances_read_contract.sql` | لا توجد مطابقة نصية/بنيوية معتمدة؛ المرشح بالاسم غير كافٍ |
| 32 | `20261026235000_unify_manufactured_unit_sale_catalog_cost.sql` | لا توجد مطابقة نصية/بنيوية معتمدة؛ المرشح بالاسم غير كافٍ |
| 33 | `20261027004000_unify_product_valuation_stock_cost.sql` | لا توجد مطابقة نصية/بنيوية معتمدة؛ المرشح بالاسم غير كافٍ |
| 34 | `20261105010000_harden_login_failure_and_user_security.sql` | لا توجد مطابقة نصية/بنيوية معتمدة؛ المرشح بالاسم غير كافٍ |
| 35 | `20261109143000_premier_kds_read_only_permissions.sql` | `expected_authenticated_revoke_not_present_live` |

### أولويات فنية لتلك الحالات

- **صلاحيات المطبخ:** `20261109143000_premier_kds_read_only_permissions.sql` يستهدف إلغاء `authenticated EXECUTE` على `complete_stale_kitchen_orders(uuid)`، وهو **لم يُثبَت مطبقًا** في آخر قراءة. يحتاج اختبار توافق واجهة KDS وخطة نشر منفصلة، لا معالجة ledger فحسب.
- **الإغلاق اليومي الآلي:** `20260927095000_auto_business_day_close.sql` يشير إلى دوال غير موجودة في الكتالوج الحالي. حدد ما إذا كان المسار متروكًا أم مطلوبًا قبل تطبيق أي شيء.
- **الفاصل النحوي التاريخي:** `20261023150600_raw_published_price_asof_helper.sql` ليس صالحًا لإعادة التشغيل مباشرة بلا معالجة CI المحددة؛ لا تُعدّل التاريخ الأصلي لمجرد إسكات الاختبارات.
- **بقية الـ32:** تحتاج إثباتًا أقوى من تطابق الاسم أو التوقيت: قارن تصريحات سجل الإنتاج، والآثار الحالية، وتعريفات الدوال/السياسات ذات الصلة، مع المحافظة على تاريخ التعديلات اللاحقة.

## معيار الإغلاق

لا يمكن وصف تاريخ هجرات Premier بأنه «متزامن تمامًا» إلا بعد أن تصبح الملفات الـ150 جميعها إما (أ) موثقة بإقرار آمن معتمد ومختبر، أو (ب) مصنفة صراحة كغير قابلة للإقرار مع قرار فني موثق ومسار بديل آمن. **عدم تسجيل SQL سابق في ledger لا يبرر إعادة تطبيقه.**

**لا تعديلات إنتاجية بموجب هذه الوثيقة.**
