-- =========================================================
-- Migration 019: Critical Security Fixes (Phase 1)
-- =========================================================

-- 1A: Revoke auth.users public/authenticated exposure immediately
-- Migration 017 erroneously granted SELECT ON auth.users to anon & authenticated,
-- exposing hashed passwords and security tokens.
REVOKE ALL ON auth.users FROM anon, authenticated;

-- 1B: Lock down payments table updates by tenants
-- Prevent tenants from updating payment status to 'paid' or changing amounts arbitrarily.
DROP POLICY IF EXISTS "Tenants update own payments" ON public.payments;

-- 1C: Lock down leases table updates by tenants
-- Prevent tenants from altering rent amounts, terms, or status directly from the client.
DROP POLICY IF EXISTS "Tenants sign own leases" ON public.leases;

-- 1D: Secure rate_limits table
-- Enable RLS and revoke client access so rate limits cannot be manipulated or cleared.
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rate_limits FROM anon, authenticated;

-- 1F: UPI Payment & Status Updates
-- Add utr_number column to store UPI reference numbers
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS utr_number text;

-- Update status check constraint to include 'under_review' and 'failed'
ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_status_check;

ALTER TABLE public.payments
  ADD CONSTRAINT payments_status_check
  CHECK (status IN ('pending', 'paid', 'overdue', 'under_review', 'failed'));

-- Create safe RPC function for tenants to submit UPI payment details
-- This allows tenants to provide their UTR number without granting them direct UPDATE privileges on payments.
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
  v_tenant_id uuid;
  v_current_status text;
  v_amount numeric;
BEGIN
  -- Verify caller is the tenant owning this payment
  SELECT p.tenant_id, p.status, p.amount INTO v_tenant_id, v_current_status, v_amount
  FROM public.payments p
  JOIN public.tenants t ON t.id = p.tenant_id
  WHERE p.id = p_payment_id AND t.user_id = auth.uid();

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Payment record not found or unauthorized access.';
  END IF;

  IF v_current_status = 'paid' THEN
    RAISE EXCEPTION 'Payment is already marked as paid.';
  END IF;

  IF p_utr_number IS NULL OR length(trim(p_utr_number)) < 6 THEN
    RAISE EXCEPTION 'Please enter a valid 12-digit UPI reference number (UTR).';
  END IF;

  UPDATE public.payments
  SET
    status = 'under_review',
    utr_number = trim(p_utr_number),
    payment_method = p_payment_method,
    transaction_id = 'UPI-' || trim(p_utr_number)
  WHERE id = p_payment_id;

  RETURN jsonb_build_object(
    'success', true,
    'status', 'under_review',
    'payment_id', p_payment_id,
    'utr_number', trim(p_utr_number)
  );
END;
$$;

-- Grant execution to authenticated users
GRANT EXECUTE ON FUNCTION public.submit_upi_payment(uuid, text, text) TO authenticated;
