-- Match the dedicated manual payment RPCs while preserving the existing
-- request types, tender methods, and client write restrictions.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.approval_requests
  DROP CONSTRAINT approval_requests_action_type_check,
  ADD CONSTRAINT approval_requests_action_type_check CHECK (
    action_type IN (
      'discount', 'reprint', 'void_order', 'cancel_sent_item', 'refund',
      'open_drawer', 'change_payment_method', 'force_close_shift',
      'split_order', 'merge_order', 'transfer_order'
    )
    OR (action_type = 'confirm_manual_payment' AND entity_type = 'payment' AND entity_id IS NULL)
  );

ALTER TABLE public.sale_payments
  DROP CONSTRAINT sale_payments_payment_method_check,
  ADD CONSTRAINT sale_payments_payment_method_check CHECK (
    payment_method IN ('cash', 'card', 'transfer')
    OR (
      payment_method IN ('instapay', 'bank_transfer')
      AND reference_number IS NOT NULL
      AND length(btrim(reference_number)) BETWEEN 3 AND 120
      AND confirmation_request_id IS NOT NULL
      AND confirmed_by IS NOT NULL
      AND confirmed_at IS NOT NULL
    )
  );
