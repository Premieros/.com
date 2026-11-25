DO $do$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_available_extensions
    WHERE name='pg_cron'
  ) THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

    EXECUTE $sql$
      SELECT cron.schedule(
        'auto-business-day-close',
        '* * * * *',
        'SELECT private.run_due_business_day_closes();'
      )
    $sql$;
  END IF;
END;
$do$;
