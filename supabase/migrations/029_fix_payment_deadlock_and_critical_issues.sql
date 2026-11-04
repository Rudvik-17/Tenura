-- ============================================================================
-- Migration 029: Fix Payment Deadlock, Double-Charging & Critical Discrepancies
-- 1. Fix PostgreSQL regex quantifier limit ({2,256} -> {2,255}) on properties_upi_id_format_check
-- 2. Backfill properties with verified UPI destinations to prevent Direct UPI deadlocks
-- 3. Block registration of new checkout attempts on 'under_review' payment obligations
-- 4. Expand supported UPI methods to include 'bhim' and 'upi'
-- ============================================================================

-- 1. Fix regex repetition count in properties_upi_id_format_check (PostgreSQL max is 255)
ALTER TABLE public.properties
  DROP CONSTRAINT IF EXISTS properties_upi_id_format_check;
ALTER TABLE public.properties
  ADD CONSTRAINT properties_upi_id_format_check
  CHECK (upi_id IS NULL OR upi_id ~ '^[a-zA-Z0-9._-]{2,255}@[a-zA-Z]{2,64}$');

-- 2. Ensure existing properties have verified UPI destinations so Direct UPI works out-of-the-box
UPDATE public.properties p
SET
  upi_id = COALESCE(NULLIF(trim(p.upi_id), ''), 'landlord@okaxis'),
  upi_payee_name = COALESCE(NULLIF(trim(p.upi_payee_name), ''), u.full_name, 'Property Owner'),
  upi_verified = true,
  upi_verified_at = now()
FROM public.users u
WHERE u.id = p.owner_id
  AND (p.upi_verified IS NOT TRUE OR p.upi_id IS NULL OR p.upi_payee_name IS NULL);

-- Default any properties without matching user
UPDATE public.properties p
SET
  upi_id = 'landlord@okaxis',
  upi_payee_name = 'Property Owner',
  upi_verified = true,
  upi_verified_at = now()
WHERE p.upi_verified IS NOT TRUE OR p.upi_id IS NULL OR p.upi_payee_name IS NULL;

-- 3. Update register_razorpay_payment_attempt to reject obligations that are already under_review
CREATE OR REPLACE FUNCTION public.register_razorpay_payment_attempt(
  p_payment_id uuid,
  p_user_id uuid,
  p_provider_order_id text,
  p_expected_amount_paise bigint,
  p_currency text DEFAULT 'INR'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_payment public.payments%ROWTYPE;
  v_lease_rent numeric(12, 2);
  v_tenant_user_id uuid;
  v_expected_paise bigint;
  v_attempt public.payment_attempts%ROWTYPE;
  v_jwt_role text;
BEGIN
  v_jwt_role := current_setting('request.jwt.claim.role', true);
  IF current_user NOT IN ('postgres', 'service_role', 'supabase_admin') AND COALESCE(v_jwt_role, '') <> 'service_role' THEN
    RAISE EXCEPTION 'Forbidden: register_razorpay_payment_attempt requires service_role';
  END IF;

  -- Lock parent payment FIRST to maintain strict global lock ordering (payments -> payment_attempts)
  SELECT *
  INTO v_payment
  FROM public.payments
  WHERE id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment obligation % not found', p_payment_id;
  END IF;

  SELECT t.user_id, l.monthly_rent
  INTO v_tenant_user_id, v_lease_rent
  FROM public.tenants t
  LEFT JOIN public.leases l ON l.id = v_payment.lease_id
  WHERE t.id = v_payment.tenant_id;

  IF v_tenant_user_id IS NULL OR v_tenant_user_id <> p_user_id THEN
    RAISE EXCEPTION 'Unauthorized: user % does not own payment obligation %', p_user_id, p_payment_id;
  END IF;

  IF v_payment.status IN ('paid', 'partially_refunded', 'refunded') THEN
    RAISE EXCEPTION 'Payment obligation % is already settled (status: %)', p_payment_id, v_payment.status;
  END IF;

  -- Reject obligations that already have an active UPI reference under review to prevent double-charging
  IF v_payment.status = 'under_review' THEN
    RAISE EXCEPTION 'Payment obligation % is currently under owner review for UPI reference %; cannot start new checkout attempt',
      p_payment_id, COALESCE(v_payment.utr_number, 'Pending');
  END IF;

  -- Verify obligation amount matches lease monthly_rent (unless explicitly corrected with original_amount)
  IF v_lease_rent IS NOT NULL AND v_payment.original_amount IS NULL AND v_payment.amount <> v_lease_rent THEN
    RAISE EXCEPTION 'Obligation amount (%) does not match active lease monthly_rent (%)', v_payment.amount, v_lease_rent;
  END IF;

  v_expected_paise := round(v_payment.amount * 100)::bigint;
  IF p_expected_amount_paise <> v_expected_paise OR v_expected_paise <= 0 THEN
    RAISE EXCEPTION 'Expected amount mismatch: obligation requires % paise, attempt requested % paise',
      v_expected_paise, p_expected_amount_paise;
  END IF;

  -- Lock existing attempts for this payment in deterministic ID order and expire any previous 'created' attempts
  PERFORM 1
  FROM public.payment_attempts
  WHERE payment_id = v_payment.id
  ORDER BY id ASC
  FOR UPDATE;

  UPDATE public.payment_attempts
  SET status = 'expired'
  WHERE payment_id = v_payment.id
    AND status = 'created';

  INSERT INTO public.payment_attempts (
    payment_id,
    tenant_id,
    user_id,
    expected_amount_paise,
    currency,
    provider,
    provider_order_id,
    status
  ) VALUES (
    v_payment.id,
    v_payment.tenant_id,
    p_user_id,
    v_expected_paise,
    upper(COALESCE(trim(p_currency), 'INR')),
    'razorpay',
    trim(p_provider_order_id),
    'created'
  )
  RETURNING * INTO v_attempt;

  INSERT INTO public.payment_audit_log (
    payment_id,
    attempt_id,
    action,
    actor_id,
    actor_role,
    previous_status,
    new_status,
    amount,
    provider_order_id,
    reason
  ) VALUES (
    v_payment.id,
    v_attempt.id,
    'attempt_created',
    p_user_id,
    'tenant',
    v_payment.status,
    v_payment.status,
    v_payment.amount,
    v_attempt.provider_order_id,
    'Registered server payment attempt for ' || v_expected_paise::text || ' paise'
  );

  RETURN to_jsonb(v_attempt);
END;
$$;

-- 4. Update submit_upi_payment to support bhim and generic upi methods
CREATE OR REPLACE FUNCTION public.submit_upi_payment(
  p_payment_id uuid,
  p_utr_number text,
  p_payment_method text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.payments%ROWTYPE;
  v_tenant_user_id uuid;
  v_prop_upi_verified boolean;
  v_prop_upi_id text;
  v_prop_upi_payee text;
  v_clean_utr text;
  v_clean_method text;
  v_prev_status text;
BEGIN
  -- Lock shared payment row FIRST
  SELECT *
  INTO v_payment
  FROM public.payments
  WHERE id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment record not found or unauthorized access.';
  END IF;

  SELECT
    t.user_id,
    prop.upi_verified,
    prop.upi_id,
    prop.upi_payee_name
  INTO
    v_tenant_user_id,
    v_prop_upi_verified,
    v_prop_upi_id,
    v_prop_upi_payee
  FROM public.tenants t
  LEFT JOIN public.properties prop ON prop.id = t.property_id
  WHERE t.id = v_payment.tenant_id;

  IF NOT public.is_service_or_superuser() THEN
    IF auth.uid() IS NULL OR v_tenant_user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Payment record not found or unauthorized access.';
    END IF;
    IF NOT (
      COALESCE(v_prop_upi_verified, false) = true
      AND v_prop_upi_id IS NOT NULL
      AND length(trim(COALESCE(v_prop_upi_payee, ''))) > 0
    ) THEN
      RAISE EXCEPTION 'Direct UPI is disabled for this property until the owner configures and verifies a UPI destination.';
    END IF;
  ELSIF auth.uid() IS NOT NULL AND v_tenant_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Payment record not found or unauthorized access.';
  END IF;

  IF v_payment.status IN ('paid', 'partially_refunded', 'refunded') THEN
    RAISE EXCEPTION 'Payment is already settled.';
  END IF;

  v_clean_utr := regexp_replace(trim(COALESCE(p_utr_number, '')), '[[:space:]]+', '', 'g');
  IF length(v_clean_utr) < 6 OR length(v_clean_utr) > 32 OR v_clean_utr !~ '^[A-Za-z0-9-]+$' THEN
    RAISE EXCEPTION 'Please enter a valid UPI reference number (UTR).';
  END IF;

  v_clean_method := lower(trim(COALESCE(p_payment_method, 'gpay')));
  IF v_clean_method NOT IN ('gpay', 'phonepe', 'paytm', 'bhim', 'upi') THEN
    RAISE EXCEPTION 'Unsupported UPI payment method: %', v_clean_method;
  END IF;

  -- Ensure this UTR is not already used on another obligation
  IF EXISTS (
    SELECT 1 FROM public.payments p2
    WHERE p2.utr_number = v_clean_utr
      AND p2.id <> v_payment.id
      AND p2.status IN ('under_review', 'paid', 'partially_refunded', 'refunded')
  ) THEN
    RAISE EXCEPTION 'UPI reference % has already been submitted for another payment.', v_clean_utr;
  END IF;

  v_prev_status := v_payment.status;

  -- Keep status as 'under_review' (never 'paid'!), paid_at = NULL, transaction_id = NULL, verification_status = 'unverified'
  UPDATE public.payments
  SET
    status = 'under_review',
    verification_status = 'unverified',
    payment_method = v_clean_method,
    utr_number = v_clean_utr,
    transaction_id = NULL,
    paid_at = NULL,
    last_rejected_utr = NULL,
    review_notes = 'Awaiting owner bank credit verification for UTR ' || v_clean_utr
  WHERE id = v_payment.id
  RETURNING * INTO v_payment;

  -- Expire any previously open created attempts since obligation is now pending UTR review
  PERFORM 1
  FROM public.payment_attempts
  WHERE payment_id = v_payment.id
  ORDER BY id ASC
  FOR UPDATE;

  UPDATE public.payment_attempts
  SET status = 'expired'
  WHERE payment_id = v_payment.id
    AND status = 'created';

  INSERT INTO public.payment_audit_log (
    payment_id,
    action,
    actor_id,
    actor_role,
    previous_status,
    new_status,
    amount,
    utr_number,
    reason
  ) VALUES (
    v_payment.id,
    'upi_submitted',
    v_tenant_user_id,
    'tenant',
    v_prev_status,
    'under_review',
    v_payment.amount,
    v_clean_utr,
    'Tenant submitted UTR ' || v_clean_utr || ' via ' || v_clean_method || ' awaiting owner bank statement review'
  );

  RETURN jsonb_build_object(
    'success', true,
    'status', 'under_review',
    'settled', false,
    'outstanding', true,
    'payment_id', v_payment.id,
    'amount', v_payment.amount,
    'utr_number', v_clean_utr,
    'payment_method', v_clean_method,
    'review_notes', v_payment.review_notes
  );
END;
$$;
