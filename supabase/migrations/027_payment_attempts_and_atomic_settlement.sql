-- =========================================================
-- Migration 027: Bind Razorpay Settlement to Trusted Server-Owned Payment Attempts
-- =========================================================

-- 1. Create server-owned payment_attempts table
CREATE TABLE IF NOT EXISTS public.payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  expected_amount_paise bigint NOT NULL CHECK (expected_amount_paise > 0),
  currency text NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  provider text NOT NULL DEFAULT 'razorpay' CHECK (provider IN ('razorpay')),
  provider_order_id text NOT NULL UNIQUE,
  provider_payment_id text UNIQUE,
  provider_signature text,
  status text NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'captured', 'consumed', 'failed', 'expired')),
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Automated updated_at trigger for payment_attempts
CREATE OR REPLACE FUNCTION public.set_payment_attempts_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_attempts_updated_at ON public.payment_attempts;
CREATE TRIGGER trg_payment_attempts_updated_at
  BEFORE UPDATE ON public.payment_attempts
  FOR EACH ROW EXECUTE FUNCTION public.set_payment_attempts_updated_at();

-- B-Tree indexes for foreign keys and lookup columns
CREATE INDEX IF NOT EXISTS idx_payment_attempts_payment_id ON public.payment_attempts(payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_tenant_id ON public.payment_attempts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_user_id ON public.payment_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_status ON public.payment_attempts(status);

-- 2. Enable RLS and lock down mutations on payment_attempts to server-only (service_role)
ALTER TABLE public.payment_attempts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.payment_attempts FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.payment_attempts FROM authenticated;
GRANT SELECT ON public.payment_attempts TO authenticated;

DROP POLICY IF EXISTS "Tenants view own payment attempts" ON public.payment_attempts;
CREATE POLICY "Tenants view own payment attempts" ON public.payment_attempts
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Owners view tenant payment attempts" ON public.payment_attempts;
CREATE POLICY "Owners view tenant payment attempts" ON public.payment_attempts
  FOR SELECT TO authenticated
  USING (
    tenant_id IN (SELECT id FROM public.tenants WHERE owner_id = (SELECT auth.uid()))
  );

-- 3. Enforce uniqueness of provider IDs on public.payments
-- Historical duplicate or ambiguous references are preserved in public.payment_reconciliation_conflicts (Migration 028)
-- rather than silently clearing provider columns.

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_unique_razorpay_payment_id
  ON public.payments(razorpay_payment_id)
  WHERE razorpay_payment_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_unique_razorpay_order_id
  ON public.payments(razorpay_order_id)
  WHERE razorpay_order_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_unique_transaction_id
  ON public.payments(transaction_id)
  WHERE transaction_id IS NOT NULL;

-- 4. Guard public.transactions against duplicate income on replay
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_unique_payment_id
  ON public.transactions(payment_id)
  WHERE payment_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.handle_payment_paid_transaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_property_id uuid;
  v_tenant_name text;
BEGIN
  -- Only execute when status transitions to 'paid'
  IF NEW.status = 'paid' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'paid') THEN
    SELECT t.property_id, t.full_name
    INTO v_property_id, v_tenant_name
    FROM public.tenants t
    WHERE t.id = NEW.tenant_id;

    IF v_property_id IS NOT NULL THEN
      INSERT INTO public.transactions (
        property_id,
        payment_id,
        type,
        category,
        amount,
        description,
        date
      ) VALUES (
        v_property_id,
        NEW.id,
        'rent',
        'residential',
        NEW.amount,
        'Rent payment from ' || COALESCE(v_tenant_name, 'Tenant'),
        COALESCE(NEW.paid_at::date, CURRENT_DATE)
      )
      ON CONFLICT (payment_id) WHERE payment_id IS NOT NULL DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- 5. Atomic server-side RPC to consume a verified Razorpay payment attempt once
CREATE OR REPLACE FUNCTION public.consume_razorpay_payment_attempt(
  p_provider_order_id text,
  p_provider_payment_id text,
  p_provider_signature text DEFAULT NULL,
  p_verified_amount_paise bigint DEFAULT NULL,
  p_verified_currency text DEFAULT 'INR',
  p_caller_user_id uuid DEFAULT NULL,
  p_target_payment_id uuid DEFAULT NULL,
  p_paid_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_attempt public.payment_attempts%ROWTYPE;
  v_payment public.payments%ROWTYPE;
  v_lookup_payment_id uuid;
  v_payment_amount_paise bigint;
  v_settled_at timestamptz;
  v_jwt_role text;
BEGIN
  v_jwt_role := current_setting('request.jwt.claim.role', true);
  IF current_user NOT IN ('postgres', 'service_role', 'supabase_admin') AND COALESCE(v_jwt_role, '') <> 'service_role' THEN
    RAISE EXCEPTION 'Forbidden: consume_razorpay_payment_attempt requires service_role';
  END IF;

  IF p_provider_order_id IS NULL OR length(trim(p_provider_order_id)) = 0 THEN
    RAISE EXCEPTION 'Missing provider_order_id';
  END IF;

  IF p_provider_payment_id IS NULL OR length(trim(p_provider_payment_id)) = 0 THEN
    RAISE EXCEPTION 'Missing provider_payment_id';
  END IF;

  -- Lookup parent payment_id first without locking child attempt rows
  SELECT payment_id
  INTO v_lookup_payment_id
  FROM public.payment_attempts
  WHERE provider_order_id = trim(p_provider_order_id);

  IF v_lookup_payment_id IS NULL THEN
    RAISE EXCEPTION 'Trusted payment attempt not found for order %', p_provider_order_id;
  END IF;

  -- Lock the shared payment row FIRST to prevent deadlocks across concurrent attempts/callbacks
  SELECT *
  INTO v_payment
  FROM public.payments
  WHERE id = v_lookup_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target payment obligation % not found', v_lookup_payment_id;
  END IF;

  -- Lock all attempts for this payment in deterministic ID order, then read target attempt
  PERFORM 1
  FROM public.payment_attempts
  WHERE payment_id = v_payment.id
  ORDER BY id ASC
  FOR UPDATE;

  SELECT *
  INTO v_attempt
  FROM public.payment_attempts
  WHERE provider_order_id = trim(p_provider_order_id);

  -- Verify caller ownership if invoked on behalf of an authenticated user
  IF p_caller_user_id IS NOT NULL AND v_attempt.user_id <> p_caller_user_id THEN
    RAISE EXCEPTION 'Unauthorized: payment attempt belongs to another tenant';
  END IF;

  -- Reject cross-obligation settlement attempts (A cannot settle B)
  IF p_target_payment_id IS NOT NULL AND v_attempt.payment_id <> p_target_payment_id THEN
    RAISE EXCEPTION 'Obligation mismatch: order % is bound to payment %, not %',
      p_provider_order_id, v_attempt.payment_id, p_target_payment_id;
  END IF;

  -- Verify captured provider amount and currency against expected obligation
  IF p_verified_amount_paise IS NULL OR p_verified_amount_paise <> v_attempt.expected_amount_paise THEN
    RAISE EXCEPTION 'Amount mismatch: expected % paise, provider reported % paise',
      v_attempt.expected_amount_paise, COALESCE(p_verified_amount_paise, -1);
  END IF;

  IF upper(COALESCE(trim(p_verified_currency), '')) <> upper(v_attempt.currency) THEN
    RAISE EXCEPTION 'Currency mismatch: expected %, provider reported %',
      v_attempt.currency, COALESCE(p_verified_currency, 'NULL');
  END IF;

  IF v_payment.tenant_id <> v_attempt.tenant_id THEN
    RAISE EXCEPTION 'Tenant mismatch between payment attempt and rent obligation';
  END IF;

  v_payment_amount_paise := round(v_payment.amount * 100)::bigint;
  IF v_payment_amount_paise <> v_attempt.expected_amount_paise THEN
    RAISE EXCEPTION 'Payment obligation amount (% paise) does not match attempt (% paise)',
      v_payment_amount_paise, v_attempt.expected_amount_paise;
  END IF;

  -- Idempotent replay check: if this exact attempt + provider_payment_id was already consumed,
  -- return existing settlement metadata without altering timestamps or duplicating ledger rows.
  IF v_attempt.status = 'consumed' THEN
    IF v_attempt.provider_payment_id = trim(p_provider_payment_id) THEN
      RETURN jsonb_build_object(
        'success', true,
        'idempotent_replay', true,
        'attempt_id', v_attempt.id,
        'payment_id', v_payment.id,
        'tenant_id', v_payment.tenant_id,
        'amount', v_payment.amount,
        'paid_at', v_payment.paid_at,
        'razorpay_order_id', v_payment.razorpay_order_id,
        'razorpay_payment_id', v_payment.razorpay_payment_id
      );
    ELSE
      RAISE EXCEPTION 'Payment attempt for order % has already been consumed by payment %',
        p_provider_order_id, v_attempt.provider_payment_id;
    END IF;
  END IF;

  -- Ensure provider_payment_id has never been used by any other attempt or obligation
  IF EXISTS (
    SELECT 1 FROM public.payment_attempts
    WHERE provider_payment_id = trim(p_provider_payment_id)
      AND id <> v_attempt.id
  ) OR EXISTS (
    SELECT 1 FROM public.payments
    WHERE (razorpay_payment_id = trim(p_provider_payment_id) OR transaction_id = trim(p_provider_payment_id))
      AND id <> v_payment.id
  ) THEN
    RAISE EXCEPTION 'Provider payment ID % has already been used', p_provider_payment_id;
  END IF;

  -- Check if target payment was already marked paid
  IF v_payment.status = 'paid' THEN
    IF v_payment.razorpay_payment_id = trim(p_provider_payment_id)
       AND v_payment.razorpay_order_id = trim(p_provider_order_id) THEN
      UPDATE public.payment_attempts
      SET
        status = 'consumed',
        provider_payment_id = trim(p_provider_payment_id),
        provider_signature = COALESCE(p_provider_signature, provider_signature),
        consumed_at = COALESCE(consumed_at, v_payment.paid_at, now())
      WHERE id = v_attempt.id;

      RETURN jsonb_build_object(
        'success', true,
        'idempotent_replay', true,
        'attempt_id', v_attempt.id,
        'payment_id', v_payment.id,
        'tenant_id', v_payment.tenant_id,
        'amount', v_payment.amount,
        'paid_at', v_payment.paid_at,
        'razorpay_order_id', v_payment.razorpay_order_id,
        'razorpay_payment_id', v_payment.razorpay_payment_id
      );
    ELSE
      RAISE EXCEPTION 'Payment obligation % is already settled', v_payment.id;
    END IF;
  END IF;

  v_settled_at := COALESCE(v_payment.paid_at, p_paid_at, now());

  -- Atomically consume the attempt
  UPDATE public.payment_attempts
  SET
    status = 'consumed',
    provider_payment_id = trim(p_provider_payment_id),
    provider_signature = COALESCE(p_provider_signature, provider_signature),
    consumed_at = COALESCE(consumed_at, v_settled_at)
  WHERE id = v_attempt.id;

  -- Expire any other still-open attempts for the same rent obligation
  UPDATE public.payment_attempts
  SET status = 'expired'
  WHERE payment_id = v_payment.id
    AND id <> v_attempt.id
    AND status IN ('created', 'captured');

  -- Settle the payment obligation once
  UPDATE public.payments
  SET
    status = 'paid',
    paid_at = v_settled_at,
    payment_method = 'razorpay',
    transaction_id = trim(p_provider_payment_id),
    razorpay_payment_id = trim(p_provider_payment_id),
    razorpay_order_id = trim(p_provider_order_id)
  WHERE id = v_payment.id
    AND status <> 'paid';

  RETURN jsonb_build_object(
    'success', true,
    'idempotent_replay', false,
    'attempt_id', v_attempt.id,
    'payment_id', v_payment.id,
    'tenant_id', v_payment.tenant_id,
    'amount', v_payment.amount,
    'paid_at', v_settled_at,
    'razorpay_order_id', trim(p_provider_order_id),
    'razorpay_payment_id', trim(p_provider_payment_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.consume_razorpay_payment_attempt(text, text, text, bigint, text, uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_razorpay_payment_attempt(text, text, text, bigint, text, uuid, uuid, timestamptz) TO service_role;
