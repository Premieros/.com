-- Run on disposable PostgreSQL fixture ONLY after the parent RLS
-- and child-line policy/direct-DML revoke candidate have been applied.
\set ON_ERROR_STOP on
DO $catalog$
BEGIN
  IF has_table_privilege('authenticated','public.stock_counts','INSERT')
    OR has_table_privilege('authenticated','public.stock_counts','UPDATE')
    OR has_table_privilege('authenticated','public.stock_counts','DELETE')
    OR has_table_privilege('authenticated','public.stock_count_items','INSERT')
    OR has_table_privilege('authenticated','public.stock_count_items','UPDATE')
    OR has_table_privilege('authenticated','public.stock_count_items','DELETE')
  THEN RAISE EXCEPTION 'DIRECT_STOCK_COUNT_DML_STILL_GRANTED'; END IF;
END $catalog$;

SET ROLE authenticated;
SET app.allowed_branch = '00000000-0000-0000-0000-000000000001';
SET app.test_permissions = 'inventory.view';
SET app.test_admin = 'no';

DO $branch_a$
BEGIN
 IF (SELECT count(*) FROM public.stock_counts)<>1
  OR (SELECT count(*) FROM public.stock_count_items)<>1 THEN
  RAISE EXCEPTION 'AUTHORIZED_STOCK_COUNT_LINES_A_NOT_VISIBLE'; END IF;
END $branch_a$;

SET app.test_permissions = '';
DO $no_permissions$
BEGIN
 IF (SELECT count(*) FROM public.stock_counts)<>0
  OR (SELECT count(*) FROM public.stock_count_items)<>0 THEN
   RAISE EXCEPTION 'UNPRIVILEGED_STOCK_COUNT_LINES_VISIBLE'; END IF;
END $no_permissions$;

SET app.test_permissions = 'inventory.view';
SET app.allowed_branch = '00000000-0000-0000-0000-000000000002';
DO $branch_b$
BEGIN
 IF (SELECT count(*) FROM public.stock_count_items)<>1 THEN
   RAISE EXCEPTION 'AUTHORIZED_STOCK_COUNT_LINES_B_NOT_VISIBLE'; END IF;
END $branch_b$;

SET app.test_admin = 'yes';
DO $platform_admin$
BEGIN
 IF (SELECT count(*) FROM public.stock_count_items)<>2 THEN
  RAISE EXCEPTION 'PLATFORM_ADMIN_STOCK_COUNT_LINES_NOT_VISIBLE'; END IF;
END $platform_admin$;

DO $direct_mutations$
BEGIN
 BEGIN
  INSERT INTO public.stock_count_items(id,stock_count_id)
  VALUES ('00000000-0000-0000-0000-000000000169',
   '00000000-0000-0000-0000-000000000142');
  RAISE EXCEPTION 'DIRECT_CHILD_INSERT_ALLOWED';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  UPDATE public.stock_count_items SET stock_count_id=stock_count_id
  WHERE id='00000000-0000-0000-0000-000000000162';
  RAISE EXCEPTION 'DIRECT_CHILD_UPDATE_ALLOWED';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  DELETE FROM public.stock_counts WHERE id='00000000-0000-0000-0000-000000000142';
  RAISE EXCEPTION 'DIRECT_STOCK_COUNT_DELETE_ALLOWED';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $direct_mutations$;

RESET ROLE;
SELECT 'STOCK_COUNT_LINES_RLS_AND_DIRECT_DML_DENIAL_PASSED' AS result;
