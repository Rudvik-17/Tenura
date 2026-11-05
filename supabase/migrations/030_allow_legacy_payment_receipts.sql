-- ============================================================================
-- Migration 030: Allow Historical / Legacy Payment Receipts
-- Enables tenants and property owners to access verified PDF receipts for
-- seeded/historical payments with an explicit 'Historical Record' watermark.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.verify_payment_receipt_eligibility(
  p_payment_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.payments%ROWTYPE;
  v_tenant RECORD;
  v_caller uuid;
  v_tx_id text;
  v_net_amount numeric(12, 2);
  v_is_legacy boolean;
BEGIN
  v_caller := auth.uid();

  SELECT *
  INTO v_payment
  FROM public.payments
  WHERE id = p_payment_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'eligible', false,
      'reason', 'Payment obligation not found'
    );
  END IF;

  SELECT t.id, t.user_id, t.owner_id, t.full_name, t.unit_number, prop.name AS property_name
  INTO v_tenant
  FROM public.tenants t
  LEFT JOIN public.properties prop ON prop.id = t.property_id
  WHERE t.id = v_payment.tenant_id;

  IF NOT public.is_service_or_superuser() THEN
    IF v_caller IS NULL
       OR (v_caller IS DISTINCT FROM v_tenant.user_id AND v_caller IS DISTINCT FROM v_tenant.owner_id) THEN
      RETURN jsonb_build_object(
        'eligible', false,
        'reason', 'Unauthorized access to payment receipt'
      );
    END IF;
  ELSIF v_caller IS NOT NULL
        AND v_caller <> v_tenant.user_id
        AND v_caller <> v_tenant.owner_id THEN
    RETURN jsonb_build_object(
      'eligible', false,
      'reason', 'Unauthorized access to payment receipt'
    );
  END IF;

  -- Settled payments with confirmed provider/owner verification or legacy imported status can issue a paid receipt
  IF v_payment.status NOT IN ('paid', 'partially_refunded')
     OR v_payment.paid_at IS NULL
     OR v_payment.verification_status NOT IN ('verified_provider', 'verified_owner', 'legacy_unverified') THEN
    RETURN jsonb_build_object(
      'eligible', false,
      'status', v_payment.status,
      'verification_status', v_payment.verification_status,
      'reason', format('Paid receipt requires confirmed settlement (current status: %s, verification: %s)', v_payment.status, v_payment.verification_status)
    );
  END IF;

  v_tx_id := COALESCE(v_payment.razorpay_payment_id, v_payment.transaction_id, format('HIST-%s', substr(v_payment.id::text, 1, 8)));
  v_net_amount := v_payment.amount - COALESCE(v_payment.refunded_amount, 0);
  v_is_legacy := (v_payment.verification_status = 'legacy_unverified');

  RETURN jsonb_build_object(
    'eligible', true,
    'payment_id', v_payment.id,
    'id', v_payment.id,
    'status', v_payment.status,
    'verification_status', v_payment.verification_status,
    'is_legacy', v_is_legacy,
    'amount', v_payment.amount,
    'gross_amount', v_payment.amount,
    'refunded_amount', COALESCE(v_payment.refunded_amount, 0),
    'net_amount', v_net_amount,
    'paid_at', v_payment.paid_at,
    'due_date', v_payment.due_date,
    'payment_method', v_payment.payment_method,
    'transaction_id', v_tx_id,
    'razorpay_payment_id', v_payment.razorpay_payment_id,
    'razorpay_order_id', v_payment.razorpay_order_id,
    'utr_number', v_payment.utr_number,
    'tenant_name', v_tenant.full_name,
    'unit_number', v_tenant.unit_number,
    'property_name', v_tenant.property_name,
    'payment', jsonb_build_object(
      'id', v_payment.id,
      'payment_id', v_payment.id,
      'tenant_id', v_payment.tenant_id,
      'lease_id', v_payment.lease_id,
      'amount', v_payment.amount,
      'gross_amount', v_payment.amount,
      'refunded_amount', COALESCE(v_payment.refunded_amount, 0),
      'net_amount', v_net_amount,
      'due_date', v_payment.due_date,
      'paid_at', v_payment.paid_at,
      'status', v_payment.status,
      'verification_status', v_payment.verification_status,
      'is_legacy', v_is_legacy,
      'payment_method', v_payment.payment_method,
      'transaction_id', v_tx_id,
      'razorpay_payment_id', v_payment.razorpay_payment_id,
      'razorpay_order_id', v_payment.razorpay_order_id,
      'utr_number', v_payment.utr_number,
      'tenant_name', v_tenant.full_name,
      'unit_number', v_tenant.unit_number,
      'property_name', v_tenant.property_name
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.verify_payment_receipt_eligibility(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_payment_receipt_eligibility(uuid) TO authenticated, service_role;
