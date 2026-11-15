-- Customer-order QR check-in creates a private guest identity, but the public
-- Customers screen reads public.customers. Materialize only *new* guest contacts
-- as explicitly unverified CRM entries. Never adopt, update, or financially
-- link an existing account based on an unverified phone number.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '45s';

CREATE OR REPLACE FUNCTION qr_private.customer_phone_key(p_phone text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  WITH digits AS (
    SELECT regexp_replace(
      translate(coalesce(p_phone,''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789'),
      '[^0-9]', '', 'g') AS d
  )
  SELECT CASE
    WHEN d LIKE '00%' THEN substring(d FROM 3)
    WHEN d ~ '^01[0-9]{9}$' THEN '20' || substring(d FROM 2)
    ELSE d
  END FROM digits;
$$;
REVOKE ALL ON FUNCTION qr_private.customer_phone_key(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION qr_private.register_guest_in_crm()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  -- The caller gets no general insert permission on public.customers.
  -- Existing customer/employee accounts must not be modified or merged.
  IF EXISTS (
    SELECT 1 FROM public.customers c
    WHERE c.branch_id = NEW.branch_id
      AND qr_private.customer_phone_key(c.phone) = qr_private.customer_phone_key(NEW.phone)
  ) THEN RETURN NEW; END IF;

  INSERT INTO public.customers (
    branch_id, name, phone, customer_type, balance, business_attributes
  ) VALUES (
    NEW.branch_id, NEW.name, NEW.phone, 'customer', 0,
    jsonb_build_object(
      'registration_source', 'customer_order_qr',
      'phone_verified', false,
      'qr_guest_profile_id', NEW.id::text
    )
  );
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION qr_private.register_guest_in_crm() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS qr_register_guest_in_crm ON qr_private.customer_profiles;
CREATE TRIGGER qr_register_guest_in_crm
AFTER INSERT ON qr_private.customer_profiles
FOR EACH ROW EXECUTE FUNCTION qr_private.register_guest_in_crm();

-- Repair profiles created before the trigger. Skip any existing CRM phone
-- identity in the same branch, including employees; do not change balances.
INSERT INTO public.customers (
  branch_id, name, phone, customer_type, balance, business_attributes
)
SELECT p.branch_id, p.name, p.phone, 'customer', 0,
  jsonb_build_object(
    'registration_source', 'customer_order_qr',
    'phone_verified', false,
    'qr_guest_profile_id', p.id::text
  )
FROM qr_private.customer_profiles p
WHERE NOT EXISTS (
  SELECT 1 FROM public.customers c
  WHERE c.branch_id = p.branch_id
    AND qr_private.customer_phone_key(c.phone) = qr_private.customer_phone_key(p.phone)
);
