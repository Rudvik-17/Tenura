-- =========================================================
-- Migration 028: Complete Payment Ownership, Reconciliation,
-- Verified Direct UPI, Refunds/Reversals/Corrections, and Acceptance Tests
-- =========================================================

-- 1. Verified UPI destination columns on public.properties
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS upi_id text,
  ADD COLUMN IF NOT EXISTS upi_payee_name text,
  ADD COLUMN IF NOT EXISTS upi_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS upi_verified_at timestamptz;

ALTER TABLE public.properties
  DROP CONSTRAINT IF EXISTS properties_upi_id_format_check;
ALTER TABLE public.properties
  ADD CONSTRAINT properties_upi_id_format_check
  CHECK (upi_id IS NULL OR upi_id ~ '^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$');

ALTER TABLE public.properties
  DROP CONSTRAINT IF EXISTS properties_upi_verified_requires_destination;
ALTER TABLE public.properties
  ADD CONSTRAINT properties_upi_verified_requires_destination
  CHECK (NOT upi_verified OR (upi_id IS NOT NULL AND length(trim(COALESCE(upi_payee_name, ''))) > 0));

-- 2. Extend public.payments with verification, review, refund, reversal, and correction columns
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS refunded_amount numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refunded_at timestamptz,
  ADD COLUMN IF NOT EXISTS refund_reason text,
  ADD COLUMN IF NOT EXISTS refund_reference text,
  ADD COLUMN IF NOT EXISTS reversed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reversal_reason text,
  ADD COLUMN IF NOT EXISTS original_amount numeric(12, 2),
  ADD COLUMN IF NOT EXISTS corrected_at timestamptz,
  ADD COLUMN IF NOT EXISTS correction_reason text,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_notes text,
  ADD COLUMN IF NOT EXISTS last_rejected_utr text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_status_check
  CHECK (status IN (
    'pending',
    'overdue',
    'under_review',
    'paid',
    'partially_refunded',
    'refunded',
    'reversed',
    'failed'
  ));

ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_verification_status_check;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_verification_status_check
  CHECK (verification_status IN (
    'unverified',
    'verified_provider',
    'verified_owner',
    'legacy_unverified',
    'conflict'
  ));

ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_refunded_amount_check;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_refunded_amount_check
  CHECK (refunded_amount >= 0 AND refunded_amount <= amount);

-- Automated updated_at trigger on public.payments
CREATE OR REPLACE FUNCTION public.set_payments_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payments_updated_at ON public.payments;
CREATE TRIGGER trg_payments_updated_at
  BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.set_payments_updated_at();

-- Unique index on active/approved UTR numbers so a single UTR cannot be reused across obligations
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_unique_utr_number
  ON public.payments(utr_number)
  WHERE utr_number IS NOT NULL AND status IN ('under_review', 'paid', 'partially_refunded', 'refunded');

-- 3. Extend public.payment_attempts for recovery and single-open-attempt enforcement
ALTER TABLE public.payment_attempts
  ADD COLUMN IF NOT EXISTS verified_amount_paise bigint,
  ADD COLUMN IF NOT EXISTS captured_at timestamptz,
  ADD COLUMN IF NOT EXISTS failure_reason text;

-- Expire older duplicate 'created' attempts if any exist, keeping only the newest per payment_id
WITH ranked_open_attempts AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY payment_id ORDER BY created_at DESC, id DESC) AS rn
  FROM public.payment_attempts
  WHERE status = 'created'
)
UPDATE public.payment_attempts pa
SET status = 'expired'
FROM ranked_open_attempts r
WHERE pa.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_attempts_one_open_per_payment
  ON public.payment_attempts(payment_id)
  WHERE status = 'created';

-- 4. Extend public.transactions for append-only ledger accounting (settlements, refunds, reversals, corrections)
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS entry_kind text NOT NULL DEFAULT 'settlement',
  ADD COLUMN IF NOT EXISTS reference_id text,
  ADD COLUMN IF NOT EXISTS parent_transaction_id uuid REFERENCES public.transactions(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS reconciliation_status text NOT NULL DEFAULT 'verified',
  ADD COLUMN IF NOT EXISTS reconciliation_notes text;

ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_entry_kind_check;
ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_entry_kind_check
  CHECK (entry_kind IN ('settlement', 'refund', 'reversal', 'correction', 'manual'));

ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_reconciliation_status_check;
ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_reconciliation_status_check
  CHECK (reconciliation_status IN ('verified', 'linked_historical', 'ambiguous', 'unverified_legacy', 'manual_entry'));

-- Replace the single-row-per-payment index with settlement-specific and event-reference indexes
DROP INDEX IF EXISTS public.idx_transactions_unique_payment_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_unique_payment_settlement
  ON public.transactions(payment_id)
  WHERE payment_id IS NOT NULL AND entry_kind = 'settlement';

CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_unique_payment_event_ref
  ON public.transactions(payment_id, entry_kind, COALESCE(reference_id, ''))
  WHERE payment_id IS NOT NULL AND entry_kind IN ('refund', 'reversal');

CREATE INDEX IF NOT EXISTS idx_transactions_payment_id_all
  ON public.transactions(payment_id);

-- 5. Create immutable payment_audit_log and payment_reconciliation_conflicts tables
CREATE TABLE IF NOT EXISTS public.payment_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid REFERENCES public.payments(id) ON DELETE RESTRICT,
  attempt_id uuid REFERENCES public.payment_attempts(id) ON DELETE SET NULL,
  ledger_transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN (
    'obligation_created',
    'attempt_created',
    'attempt_reused',
    'attempt_captured',
    'attempt_failed',
    'attempt_expired',
    'settled_razorpay',
    'upi_submitted',
    'upi_approved',
    'upi_rejected',
    'payment_refunded',
    'payment_partially_refunded',
    'payment_reversed',
    'payment_corrected',
    'reconciliation_linked',
    'conflict_detected',
    'conflict_resolved'
  )),
  actor_id uuid,
  actor_role text,
  previous_status text,
  new_status text,
  amount numeric(12, 2),
  provider_order_id text,
  provider_payment_id text,
  utr_number text,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_audit_log_payment_id ON public.payment_audit_log(payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_audit_log_created_at ON public.payment_audit_log(created_at DESC);

ALTER TABLE public.payment_audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_audit_log FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.payment_audit_log FROM authenticated;
GRANT SELECT ON public.payment_audit_log TO authenticated;

DROP POLICY IF EXISTS "Tenants view own payment audit log" ON public.payment_audit_log;
CREATE POLICY "Tenants view own payment audit log" ON public.payment_audit_log
  FOR SELECT TO authenticated
  USING (
    payment_id IN (
      SELECT p.id FROM public.payments p
      JOIN public.tenants t ON t.id = p.tenant_id
      WHERE t.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Owners view property payment audit log" ON public.payment_audit_log;
CREATE POLICY "Owners view property payment audit log" ON public.payment_audit_log
  FOR SELECT TO authenticated
  USING (
    payment_id IN (
      SELECT p.id FROM public.payments p
      JOIN public.tenants t ON t.id = p.tenant_id
      WHERE t.owner_id = (SELECT auth.uid())
    )
  );

CREATE TABLE IF NOT EXISTS public.payment_reconciliation_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conflict_type text NOT NULL CHECK (conflict_type IN (
    'duplicate_razorpay_payment_id',
    'duplicate_razorpay_order_id',
    'duplicate_transaction_id',
    'duplicate_utr_number',
    'legacy_synthetic_reference',
    'ambiguous_ledger_match',
    'orphan_rent_transaction',
    'paid_payment_missing_ledger_entry',
    'duplicate_captured_attempt',
    'amount_mismatch_with_lease'
  )),
  payment_id uuid REFERENCES public.payments(id) ON DELETE RESTRICT,
  ledger_transaction_id uuid REFERENCES public.transactions(id) ON DELETE RESTRICT,
  provider_reference text,
  preserved_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reconciled', 'acknowledged')),
  resolution_notes text,
  resolved_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_conflicts_payment_id ON public.payment_reconciliation_conflicts(payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_conflicts_status ON public.payment_reconciliation_conflicts(status);

ALTER TABLE public.payment_reconciliation_conflicts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_reconciliation_conflicts FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.payment_reconciliation_conflicts FROM authenticated;
GRANT SELECT ON public.payment_reconciliation_conflicts TO authenticated;

DROP POLICY IF EXISTS "Owners view reconciliation conflicts" ON public.payment_reconciliation_conflicts;
CREATE POLICY "Owners view reconciliation conflicts" ON public.payment_reconciliation_conflicts
  FOR SELECT TO authenticated
  USING (
    payment_id IN (
      SELECT p.id FROM public.payments p
      JOIN public.tenants t ON t.id = p.tenant_id
      WHERE t.owner_id = (SELECT auth.uid())
    )
    OR ledger_transaction_id IN (
      SELECT tr.id FROM public.transactions tr
      JOIN public.properties prop ON prop.id = tr.property_id
      WHERE prop.owner_id = (SELECT auth.uid())
    )
  );

-- 6. Reconcile existing historical payments and transactions safely without losing evidence
DO $$
DECLARE
  v_rec RECORD;
  v_match_count int;
  v_tx_match_count int;
  v_matched_payment_id uuid;
  v_matched_verif_status text;
BEGIN
  -- 6A. Classify historical paid payments by verification provenance
  FOR v_rec IN
    SELECT p.*
    FROM public.payments p
    WHERE p.status = 'paid'
  LOOP
    IF v_rec.razorpay_payment_id IS NOT NULL AND v_rec.razorpay_order_id IS NOT NULL THEN
      UPDATE public.payments
      SET verification_status = 'verified_provider'
      WHERE id = v_rec.id AND verification_status = 'unverified';
    ELSIF v_rec.utr_number IS NOT NULL AND v_rec.reviewed_by IS NOT NULL THEN
      UPDATE public.payments
      SET verification_status = 'verified_owner'
      WHERE id = v_rec.id AND verification_status = 'unverified';
    ELSIF v_rec.transaction_id ~ '^TXN[0-9]+$' AND v_rec.razorpay_payment_id IS NULL AND v_rec.utr_number IS NULL THEN
      UPDATE public.payments
      SET verification_status = 'legacy_unverified'
      WHERE id = v_rec.id;

      -- Preserve conflict/audit record for legacy synthetic reference if not already logged
      IF NOT EXISTS (
        SELECT 1 FROM public.payment_reconciliation_conflicts c
        WHERE c.payment_id = v_rec.id AND c.conflict_type = 'legacy_synthetic_reference'
      ) THEN
        INSERT INTO public.payment_reconciliation_conflicts (
          conflict_type,
          payment_id,
          provider_reference,
          preserved_payload,
          status,
          resolution_notes
        ) VALUES (
          'legacy_synthetic_reference',
          v_rec.id,
          v_rec.transaction_id,
          to_jsonb(v_rec),
          'open',
          'Historical payment marked paid using legacy client-generated TXN reference without provider or owner UTR verification; preserved for owner audit.'
        );
      END IF;
    END IF;
  END LOOP;

  -- 6B. Link historical rent transactions (where payment_id IS NULL) to payments where 1:1 verified/unambiguous
  FOR v_rec IN
    SELECT tr.*
    FROM public.transactions tr
    WHERE tr.type = 'rent'
      AND tr.payment_id IS NULL
      AND tr.entry_kind = 'settlement'
  LOOP
    SELECT count(*), (array_agg(p.id))[1], (array_agg(p.verification_status))[1]
    INTO v_match_count, v_matched_payment_id, v_matched_verif_status
    FROM public.payments p
    JOIN public.tenants t ON t.id = p.tenant_id
    WHERE t.property_id = v_rec.property_id
      AND p.amount = v_rec.amount
      AND COALESCE(p.paid_at::date, p.due_date) = v_rec.date
      AND p.status IN ('paid', 'partially_refunded', 'refunded', 'reversed')
      AND NOT EXISTS (
        SELECT 1 FROM public.transactions existing_tr
        WHERE existing_tr.payment_id = p.id
          AND existing_tr.entry_kind = 'settlement'
          AND existing_tr.id <> v_rec.id
      );

    -- Check how many unlinked rent transactions match this same (property_id, amount, date)
    SELECT count(*)
    INTO v_tx_match_count
    FROM public.transactions tr2
    WHERE tr2.type = 'rent'
      AND tr2.payment_id IS NULL
      AND tr2.entry_kind = 'settlement'
      AND tr2.property_id = v_rec.property_id
      AND tr2.amount = v_rec.amount
      AND tr2.date = v_rec.date;

    IF v_match_count = 1 AND v_tx_match_count = 1 THEN
      UPDATE public.transactions
      SET
        payment_id = v_matched_payment_id,
        reconciliation_status = CASE
          WHEN v_matched_verif_status IN ('verified_provider', 'verified_owner') THEN 'linked_historical'
          ELSE 'unverified_legacy'
        END,
        reconciliation_notes = CASE
          WHEN v_matched_verif_status IN ('verified_provider', 'verified_owner')
            THEN 'Linked 1:1 to verified historical payment ' || v_matched_payment_id::text
          ELSE 'Linked 1:1 to legacy unverified payment ' || v_matched_payment_id::text
        END
      WHERE id = v_rec.id;

      INSERT INTO public.payment_audit_log (
        payment_id,
        ledger_transaction_id,
        action,
        actor_role,
        new_status,
        amount,
        reason,
        metadata
      ) VALUES (
        v_matched_payment_id,
        v_rec.id,
        'reconciliation_linked',
        'system_migration',
        v_matched_verif_status,
        v_rec.amount,
        'Historical ledger transaction linked 1:1 to payment obligation',
        jsonb_build_object('transaction_date', v_rec.date, 'property_id', v_rec.property_id)
      );
    ELSIF v_match_count > 1 OR v_tx_match_count > 1 THEN
      UPDATE public.transactions
      SET
        reconciliation_status = 'ambiguous',
        reconciliation_notes = format('Ambiguous historical match: %s candidate payments and %s candidate transactions on %s', v_match_count, v_tx_match_count, v_rec.date)
      WHERE id = v_rec.id;

      IF NOT EXISTS (
        SELECT 1 FROM public.payment_reconciliation_conflicts c
        WHERE c.ledger_transaction_id = v_rec.id AND c.conflict_type = 'ambiguous_ledger_match'
      ) THEN
        INSERT INTO public.payment_reconciliation_conflicts (
          conflict_type,
          ledger_transaction_id,
          preserved_payload,
          status,
          resolution_notes
        ) VALUES (
          'ambiguous_ledger_match',
          v_rec.id,
          jsonb_build_object(
            'transaction', to_jsonb(v_rec),
            'candidate_payment_ids', (
              SELECT COALESCE(jsonb_agg(p.id), '[]'::jsonb)
              FROM public.payments p
              JOIN public.tenants t ON t.id = p.tenant_id
              WHERE t.property_id = v_rec.property_id
                AND p.amount = v_rec.amount
                AND COALESCE(p.paid_at::date, p.due_date) = v_rec.date
            )
          ),
          'open',
          'Multiple candidate payments/transactions share the same property, date, and amount; requires explicit reconciliation.'
        );
      END IF;
    ELSE
      UPDATE public.transactions
      SET
        reconciliation_status = 'ambiguous',
        reconciliation_notes = 'Orphan historical rent transaction with no matching paid payment record'
      WHERE id = v_rec.id;

      IF NOT EXISTS (
        SELECT 1 FROM public.payment_reconciliation_conflicts c
        WHERE c.ledger_transaction_id = v_rec.id AND c.conflict_type = 'orphan_rent_transaction'
      ) THEN
        INSERT INTO public.payment_reconciliation_conflicts (
          conflict_type,
          ledger_transaction_id,
          preserved_payload,
          status,
          resolution_notes
        ) VALUES (
          'orphan_rent_transaction',
          v_rec.id,
          to_jsonb(v_rec),
          'open',
          'Rent ledger transaction has no matching payment obligation.'
        );
      END IF;
    END IF;
  END LOOP;

  -- 6C. Detect any settled payment rows missing a settlement ledger entry in public.transactions
  FOR v_rec IN
    SELECT p.*
    FROM public.payments p
    WHERE p.status IN ('paid', 'partially_refunded', 'refunded')
      AND NOT EXISTS (
        SELECT 1 FROM public.transactions tr
        WHERE tr.payment_id = p.id AND tr.entry_kind = 'settlement'
      )
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.payment_reconciliation_conflicts c
      WHERE c.payment_id = v_rec.id AND c.conflict_type = 'paid_payment_missing_ledger_entry'
    ) THEN
      INSERT INTO public.payment_reconciliation_conflicts (
        conflict_type,
        payment_id,
        provider_reference,
        preserved_payload,
        status,
        resolution_notes
      ) VALUES (
        'paid_payment_missing_ledger_entry',
        v_rec.id,
        COALESCE(v_rec.razorpay_payment_id, v_rec.transaction_id, v_rec.utr_number),
        to_jsonb(v_rec),
        'open',
        'Settled payment has no linked settlement row in public.transactions; requires accounting review.'
      );
    END IF;
  END LOOP;
END $$;

-- 7. Remove tenant direct INSERT/UPDATE/DELETE privileges on public.payments (Make rent obligations server-owned)
DROP POLICY IF EXISTS "Tenants insert own payments" ON public.payments;
DROP POLICY IF EXISTS "Tenant inserts own payments" ON public.payments;
DROP POLICY IF EXISTS "Tenants update own payments" ON public.payments;
DROP POLICY IF EXISTS "Tenant updates own payments" ON public.payments;
DROP POLICY IF EXISTS "Owners manage own property payments" ON public.payments;
DROP POLICY IF EXISTS "Owner views payments for own tenants" ON public.payments;

REVOKE ALL ON public.payments FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.payments FROM authenticated;
GRANT SELECT ON public.payments TO authenticated;

DROP POLICY IF EXISTS "Tenants view own payments" ON public.payments;
CREATE POLICY "Tenants view own payments" ON public.payments
  FOR SELECT TO authenticated
  USING (
    tenant_id IN (SELECT id FROM public.tenants WHERE user_id = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS "Owners view own property payments" ON public.payments;
CREATE POLICY "Owners view own property payments" ON public.payments
  FOR SELECT TO authenticated
  USING (
    tenant_id IN (SELECT id FROM public.tenants WHERE owner_id = (SELECT auth.uid()))
  );

-- Helper to distinguish service_role / direct postgres SQL admin from authenticated JWT callers inside SECURITY DEFINER functions
CREATE OR REPLACE FUNCTION public.is_service_or_superuser()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    COALESCE(auth.role(), '') = 'service_role'
    OR (
      COALESCE(auth.role(), '') = ''
      AND auth.uid() IS NULL
      AND session_user IN ('postgres', 'supabase_admin', 'service_role')
    );
$$;

-- 8. Protect financial history from deletion and enforce obligation integrity via database triggers
CREATE OR REPLACE FUNCTION public.prevent_financial_history_deletion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Allow explicit cleanup of temporary test fixtures only when superuser/service_role sets tenura.allow_test_cleanup = 'on'
  IF current_setting('tenura.allow_test_cleanup', true) = 'on'
     AND public.is_service_or_superuser() THEN
    RETURN OLD;
  END IF;

  IF TG_TABLE_NAME = 'payment_audit_log' THEN
    RAISE EXCEPTION 'Financial audit log entries are immutable and cannot be deleted';
  END IF;

  IF TG_TABLE_NAME = 'transactions' THEN
    IF OLD.payment_id IS NOT NULL OR OLD.type = 'rent' OR OLD.entry_kind IN ('settlement', 'refund', 'reversal', 'correction') THEN
      RAISE EXCEPTION 'Financial history in transactions cannot be deleted. Use refund, reversal, or correction functions instead.';
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'payments' THEN
    IF OLD.status IN ('paid', 'partially_refunded', 'refunded', 'reversed', 'under_review')
       OR OLD.paid_at IS NOT NULL
       OR OLD.razorpay_payment_id IS NOT NULL
       OR OLD.utr_number IS NOT NULL
       OR EXISTS (SELECT 1 FROM public.transactions tr WHERE tr.payment_id = OLD.id) THEN
      RAISE EXCEPTION 'Financial history on payments cannot be deleted. Use refund, reversal, or correction functions instead.';
    END IF;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_audit_log_delete ON public.payment_audit_log;
CREATE TRIGGER trg_prevent_audit_log_delete
  BEFORE DELETE OR UPDATE ON public.payment_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.prevent_financial_history_deletion();

DROP TRIGGER IF EXISTS trg_prevent_transactions_delete ON public.transactions;
CREATE TRIGGER trg_prevent_transactions_delete
  BEFORE DELETE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_financial_history_deletion();

DROP TRIGGER IF EXISTS trg_prevent_settled_payments_delete ON public.payments;
CREATE TRIGGER trg_prevent_settled_payments_delete
  BEFORE DELETE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.prevent_financial_history_deletion();

-- Trigger to enforce lease-derived rent obligation amount and settlement verification on public.payments
CREATE OR REPLACE FUNCTION public.validate_payment_obligation_and_settlement()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_lease_rent numeric(12, 2);
  v_lease_tenant_id uuid;
BEGIN
  IF NEW.amount IS NULL OR NEW.amount <= 0 THEN
    RAISE EXCEPTION 'Payment obligation amount must be greater than zero';
  END IF;

  IF NEW.lease_id IS NULL OR NEW.tenant_id IS NULL THEN
    RAISE EXCEPTION 'Payment obligation must be bound to a valid tenant_id and lease_id';
  END IF;

  SELECT l.monthly_rent, l.tenant_id
  INTO v_lease_rent, v_lease_tenant_id
  FROM public.leases l
  WHERE l.id = NEW.lease_id;

  IF v_lease_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Lease % not found for payment obligation', NEW.lease_id;
  END IF;

  IF v_lease_tenant_id <> NEW.tenant_id THEN
    RAISE EXCEPTION 'Lease % does not belong to tenant %', NEW.lease_id, NEW.tenant_id;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- New obligations cannot be inserted as already settled
    IF NEW.status NOT IN ('pending', 'overdue') THEN
      RAISE EXCEPTION 'New rent obligations must be created with status pending or overdue (attempted: %)', NEW.status;
    END IF;

    -- Obligation amount on creation must match the lease's monthly_rent unless an explicit correction is recorded
    IF NEW.amount <> v_lease_rent AND NEW.original_amount IS NULL THEN
      RAISE EXCEPTION 'Rent obligation amount (%) must match lease monthly_rent (%)', NEW.amount, v_lease_rent;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Changing the obligation amount requires an audited correction (original_amount & correction_reason)
    IF NEW.amount IS DISTINCT FROM OLD.amount THEN
      IF NEW.original_amount IS NULL OR length(trim(COALESCE(NEW.correction_reason, ''))) = 0 THEN
        RAISE EXCEPTION 'Changing a payment obligation amount requires an audited correction with correction_reason';
      END IF;
    END IF;

    -- Transitioning to 'paid' requires verified provider capture or verified owner approval
    IF NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid' THEN
      IF NEW.paid_at IS NULL THEN
        RAISE EXCEPTION 'Settled payment requires paid_at timestamp';
      END IF;

      IF NEW.verification_status = 'verified_provider' THEN
        IF NEW.razorpay_payment_id IS NULL OR NEW.razorpay_order_id IS NULL THEN
          RAISE EXCEPTION 'Provider-verified settlement requires razorpay_order_id and razorpay_payment_id';
        END IF;
      ELSIF NEW.verification_status = 'verified_owner' THEN
        IF NEW.utr_number IS NULL OR NEW.reviewed_by IS NULL OR NEW.reviewed_at IS NULL THEN
          RAISE EXCEPTION 'Owner-verified UPI settlement requires utr_number, reviewed_by, and reviewed_at';
        END IF;
      ELSE
        RAISE EXCEPTION 'Payment cannot transition to paid without verified_provider or verified_owner verification_status';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_payment_obligation ON public.payments;
CREATE TRIGGER trg_validate_payment_obligation
  BEFORE INSERT OR UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.validate_payment_obligation_and_settlement();

-- Update settlement ledger trigger to set entry_kind = 'settlement' and reconciliation_status = 'verified'
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
        entry_kind,
        category,
        amount,
        description,
        date,
        reference_id,
        reconciliation_status,
        reconciliation_notes
      ) VALUES (
        v_property_id,
        NEW.id,
        'rent',
        'settlement',
        'residential',
        NEW.amount,
        'Rent payment from ' || COALESCE(v_tenant_name, 'Tenant'),
        COALESCE(NEW.paid_at::date, CURRENT_DATE),
        COALESCE(NEW.razorpay_payment_id, NEW.transaction_id, NEW.utr_number),
        'verified',
        CASE
          WHEN NEW.verification_status = 'verified_provider' THEN 'Settled via Razorpay order ' || COALESCE(NEW.razorpay_order_id, '')
          WHEN NEW.verification_status = 'verified_owner' THEN 'Approved UPI UTR ' || COALESCE(NEW.utr_number, '')
          ELSE 'Verified settlement'
        END
      )
      ON CONFLICT (payment_id) WHERE payment_id IS NOT NULL AND entry_kind = 'settlement' DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- 9. Server-owned rent obligation derivation RPC (Item 2 & Item 5)
CREATE OR REPLACE FUNCTION public.ensure_current_rent_obligation(
  p_target_due_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_tenant RECORD;
  v_lease RECORD;
  v_due_date date;
  v_month_row public.payments%ROWTYPE;
  v_actionable_payment public.payments%ROWTYPE;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Locate the caller's tenant profile and associated property UPI verification details
  SELECT
    t.id,
    t.user_id,
    t.owner_id,
    t.property_id,
    t.full_name,
    t.unit_number,
    t.phone,
    t.status,
    prop.name AS property_name,
    prop.upi_id AS property_upi_id,
    prop.upi_payee_name AS property_upi_payee_name,
    prop.upi_verified AS property_upi_verified
  INTO v_tenant
  FROM public.tenants t
  LEFT JOIN public.properties prop ON prop.id = t.property_id
  WHERE t.user_id = v_user_id
  ORDER BY (t.status = 'active') DESC, t.created_at DESC
  LIMIT 1;

  IF v_tenant.id IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'no_tenant',
      'not_set_up', true,
      'tenant', NULL,
      'lease', NULL,
      'payment', NULL,
      'upi_destination', NULL
    );
  END IF;

  -- Locate the active lease for this tenant
  SELECT l.*
  INTO v_lease
  FROM public.leases l
  WHERE l.tenant_id = v_tenant.id
    AND l.status = 'active'
    AND l.monthly_rent > 0
  ORDER BY l.end_date DESC, l.created_at DESC
  LIMIT 1;

  v_due_date := date_trunc('month', COALESCE(p_target_due_date, CURRENT_DATE))::date;
  IF NOT public.is_service_or_superuser() AND v_due_date > date_trunc('month', CURRENT_DATE)::date THEN
    v_due_date := date_trunc('month', CURRENT_DATE)::date;
  END IF;

  -- If an active lease exists and covers the current billing month, ensure the server-owned obligation exists
  IF v_lease.id IS NOT NULL THEN
    SELECT *
    INTO v_month_row
    FROM public.payments p
    WHERE p.tenant_id = v_tenant.id
      AND p.due_date = v_due_date
    LIMIT 1;

    IF v_month_row.id IS NOT NULL
       AND v_month_row.status IN ('pending', 'overdue')
       AND v_month_row.original_amount IS NULL
       AND v_month_row.amount <> v_lease.monthly_rent THEN
      UPDATE public.payments
      SET amount = v_lease.monthly_rent,
          lease_id = v_lease.id
      WHERE id = v_month_row.id
      RETURNING * INTO v_month_row;
    END IF;

    IF v_month_row.id IS NULL
       AND v_due_date >= date_trunc('month', v_lease.start_date)::date
       AND v_due_date <= date_trunc('month', v_lease.end_date)::date THEN
      INSERT INTO public.payments (
        tenant_id,
        lease_id,
        amount,
        due_date,
        status,
        verification_status
      ) VALUES (
        v_tenant.id,
        v_lease.id,
        v_lease.monthly_rent,
        v_due_date,
        'pending',
        'unverified'
      )
      ON CONFLICT (tenant_id, due_date) DO NOTHING
      RETURNING * INTO v_month_row;

      IF v_month_row.id IS NOT NULL THEN
        INSERT INTO public.payment_audit_log (
          payment_id,
          action,
          actor_id,
          actor_role,
          new_status,
          amount,
          reason
        ) VALUES (
          v_month_row.id,
          'obligation_created',
          v_user_id,
          'tenant_session_derivation',
          v_month_row.status,
          v_month_row.amount,
          'Derived rent obligation from active lease ' || v_lease.id::text
        );
      END IF;
    END IF;
  END IF;

  -- Fetch the earliest outstanding/actionable obligation (including 'under_review' and 'reversed' so unverified/reversed items remain outstanding)
  SELECT *
  INTO v_actionable_payment
  FROM public.payments p
  WHERE p.tenant_id = v_tenant.id
    AND p.status IN ('pending', 'overdue', 'under_review', 'reversed')
  ORDER BY p.due_date ASC, p.created_at ASC
  LIMIT 1;

  RETURN jsonb_build_object(
    'status', CASE
      WHEN v_lease.id IS NULL AND v_actionable_payment.id IS NULL THEN 'no_active_lease'
      WHEN v_actionable_payment.id IS NULL THEN 'all_paid'
      ELSE 'due'
    END,
    'not_set_up', false,
    'tenant', jsonb_build_object(
      'id', v_tenant.id,
      'phone', COALESCE(v_tenant.phone, ''),
      'full_name', v_tenant.full_name,
      'unit_number', v_tenant.unit_number,
      'property_id', v_tenant.property_id,
      'property_name', v_tenant.property_name
    ),
    'lease', CASE WHEN v_lease.id IS NOT NULL THEN jsonb_build_object(
      'id', v_lease.id,
      'monthly_rent', v_lease.monthly_rent,
      'start_date', v_lease.start_date,
      'end_date', v_lease.end_date,
      'status', v_lease.status
    ) ELSE NULL END,
    'payment', CASE WHEN v_actionable_payment.id IS NOT NULL THEN to_jsonb(v_actionable_payment) ELSE NULL END,
    'upi_destination', jsonb_build_object(
      'verified', COALESCE(v_tenant.property_upi_verified, false)
        AND v_tenant.property_upi_id IS NOT NULL
        AND length(trim(COALESCE(v_tenant.property_upi_payee_name, ''))) > 0,
      'upi_id', CASE
        WHEN COALESCE(v_tenant.property_upi_verified, false) THEN v_tenant.property_upi_id
        ELSE NULL
      END,
      'payee_name', CASE
        WHEN COALESCE(v_tenant.property_upi_verified, false) THEN v_tenant.property_upi_payee_name
        ELSE NULL
      END
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_current_rent_obligation(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_current_rent_obligation(date) TO authenticated, service_role;

-- 10. Deadlock-free atomic Razorpay attempt registration, capture recording, and consumption (Item 3 & Item 6)
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
    'created',
    v_payment.amount,
    v_attempt.provider_order_id,
    'Created bound Razorpay order attempt'
  );

  RETURN to_jsonb(v_attempt);
END;
$$;

REVOKE ALL ON FUNCTION public.register_razorpay_payment_attempt(uuid, uuid, text, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_razorpay_payment_attempt(uuid, uuid, text, bigint, text) TO service_role;

CREATE OR REPLACE FUNCTION public.record_razorpay_attempt_capture(
  p_provider_order_id text,
  p_provider_payment_id text,
  p_verified_amount_paise bigint,
  p_provider_signature text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_lookup_payment_id uuid;
  v_payment public.payments%ROWTYPE;
  v_attempt public.payment_attempts%ROWTYPE;
  v_jwt_role text;
BEGIN
  v_jwt_role := current_setting('request.jwt.claim.role', true);
  IF current_user NOT IN ('postgres', 'service_role', 'supabase_admin') AND COALESCE(v_jwt_role, '') <> 'service_role' THEN
    RAISE EXCEPTION 'Forbidden: record_razorpay_attempt_capture requires service_role';
  END IF;

  SELECT payment_id
  INTO v_lookup_payment_id
  FROM public.payment_attempts
  WHERE provider_order_id = trim(p_provider_order_id);

  IF v_lookup_payment_id IS NULL THEN
    RAISE EXCEPTION 'Trusted payment attempt not found for order %', p_provider_order_id;
  END IF;

  -- Lock shared payment row FIRST
  SELECT *
  INTO v_payment
  FROM public.payments
  WHERE id = v_lookup_payment_id
  FOR UPDATE;

  PERFORM 1
  FROM public.payment_attempts
  WHERE payment_id = v_payment.id
  ORDER BY id ASC
  FOR UPDATE;

  SELECT *
  INTO v_attempt
  FROM public.payment_attempts
  WHERE provider_order_id = trim(p_provider_order_id);

  IF v_attempt.expected_amount_paise <> p_verified_amount_paise THEN
    RAISE EXCEPTION 'Captured amount (% paise) does not match expected attempt amount (% paise)',
      p_verified_amount_paise, v_attempt.expected_amount_paise;
  END IF;

  IF v_attempt.status IN ('created', 'expired') THEN
    UPDATE public.payment_attempts
    SET
      status = 'captured',
      provider_payment_id = trim(p_provider_payment_id),
      provider_signature = COALESCE(p_provider_signature, provider_signature),
      verified_amount_paise = p_verified_amount_paise,
      captured_at = COALESCE(captured_at, now())
    WHERE id = v_attempt.id
    RETURNING * INTO v_attempt;
  END IF;

  RETURN to_jsonb(v_attempt);
END;
$$;

REVOKE ALL ON FUNCTION public.record_razorpay_attempt_capture(text, text, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_razorpay_attempt_capture(text, text, bigint, text) TO service_role;

CREATE OR REPLACE FUNCTION public.mark_razorpay_attempt_failed(
  p_provider_order_id text,
  p_failure_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_lookup_payment_id uuid;
  v_payment public.payments%ROWTYPE;
  v_attempt public.payment_attempts%ROWTYPE;
  v_jwt_role text;
BEGIN
  v_jwt_role := current_setting('request.jwt.claim.role', true);
  IF current_user NOT IN ('postgres', 'service_role', 'supabase_admin') AND COALESCE(v_jwt_role, '') <> 'service_role' THEN
    RAISE EXCEPTION 'Forbidden: mark_razorpay_attempt_failed requires service_role';
  END IF;

  SELECT payment_id
  INTO v_lookup_payment_id
  FROM public.payment_attempts
  WHERE provider_order_id = trim(p_provider_order_id);

  IF v_lookup_payment_id IS NULL THEN
    RAISE EXCEPTION 'Trusted payment attempt not found for order %', p_provider_order_id;
  END IF;

  -- Lock shared payment row FIRST
  SELECT *
  INTO v_payment
  FROM public.payments
  WHERE id = v_lookup_payment_id
  FOR UPDATE;

  PERFORM 1
  FROM public.payment_attempts
  WHERE payment_id = v_payment.id
  ORDER BY id ASC
  FOR UPDATE;

  SELECT *
  INTO v_attempt
  FROM public.payment_attempts
  WHERE provider_order_id = trim(p_provider_order_id);

  -- Never downgrade a consumed or captured attempt
  IF v_attempt.status = 'created' THEN
    UPDATE public.payment_attempts
    SET
      status = 'failed',
      failure_reason = COALESCE(p_failure_reason, 'Checkout failed or cancelled')
    WHERE id = v_attempt.id
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
      'attempt_failed',
      v_attempt.user_id,
      'system',
      'created',
      'failed',
      v_payment.amount,
      v_attempt.provider_order_id,
      COALESCE(p_failure_reason, 'Checkout failed or cancelled')
    );
  END IF;

  RETURN to_jsonb(v_attempt);
END;
$$;

REVOKE ALL ON FUNCTION public.mark_razorpay_attempt_failed(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_razorpay_attempt_failed(text, text) TO service_role;

-- Update consume_razorpay_payment_attempt with parent-first lock ordering, audit trail, and conflict logging
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
  v_prev_payment_status text;
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

  -- Step 1: Lookup parent payment_id without locking child rows
  SELECT payment_id
  INTO v_lookup_payment_id
  FROM public.payment_attempts
  WHERE provider_order_id = trim(p_provider_order_id);

  IF v_lookup_payment_id IS NULL THEN
    RAISE EXCEPTION 'Trusted payment attempt not found for order %', p_provider_order_id;
  END IF;

  -- Step 2: Lock shared parent payment row FIRST to prevent deadlocks across concurrent callbacks
  SELECT *
  INTO v_payment
  FROM public.payments
  WHERE id = v_lookup_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target payment obligation % not found', v_lookup_payment_id;
  END IF;

  -- Step 3: Lock all attempts for this payment in deterministic ID order, then read the target attempt
  PERFORM 1
  FROM public.payment_attempts
  WHERE payment_id = v_payment.id
  ORDER BY id ASC
  FOR UPDATE;

  SELECT *
  INTO v_attempt
  FROM public.payment_attempts
  WHERE provider_order_id = trim(p_provider_order_id);

  -- Step 4: Verify caller ownership if invoked on behalf of an authenticated user
  IF p_caller_user_id IS NOT NULL AND v_attempt.user_id <> p_caller_user_id THEN
    RAISE EXCEPTION 'Unauthorized: payment attempt belongs to another tenant';
  END IF;

  -- Step 5: Reject cross-obligation settlement attempts (Tenant A / Obligation A cannot settle B)
  IF p_target_payment_id IS NOT NULL AND v_attempt.payment_id <> p_target_payment_id THEN
    RAISE EXCEPTION 'Obligation mismatch: order % is bound to payment %, not %',
      p_provider_order_id, v_attempt.payment_id, p_target_payment_id;
  END IF;

  -- Step 6: Verify captured provider amount and currency against expected obligation
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

  -- Step 7: Idempotent replay check if this exact attempt + provider_payment_id was already consumed
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

  -- Step 8: Ensure provider_payment_id has never been used by any other attempt or obligation
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

  -- Step 9: Check if target payment was already settled
  IF v_payment.status IN ('paid', 'partially_refunded', 'refunded') THEN
    IF v_payment.razorpay_payment_id = trim(p_provider_payment_id)
       AND v_payment.razorpay_order_id = trim(p_provider_order_id) THEN
      UPDATE public.payment_attempts
      SET
        status = 'consumed',
        provider_payment_id = trim(p_provider_payment_id),
        provider_signature = COALESCE(p_provider_signature, provider_signature),
        verified_amount_paise = p_verified_amount_paise,
        captured_at = COALESCE(captured_at, v_payment.paid_at, now()),
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
      -- Record conflict if a second distinct attempt was somehow captured for an already-settled obligation
      INSERT INTO public.payment_reconciliation_conflicts (
        conflict_type,
        payment_id,
        provider_reference,
        preserved_payload,
        status,
        resolution_notes
      ) VALUES (
        'duplicate_captured_attempt',
        v_payment.id,
        trim(p_provider_payment_id),
        jsonb_build_object(
          'existing_razorpay_order_id', v_payment.razorpay_order_id,
          'existing_razorpay_payment_id', v_payment.razorpay_payment_id,
          'duplicate_order_id', trim(p_provider_order_id),
          'duplicate_payment_id', trim(p_provider_payment_id),
          'amount_paise', p_verified_amount_paise
        ),
        'open',
        'A second distinct provider payment arrived for an already-settled obligation; blocked double settlement.'
      );
      RAISE EXCEPTION 'Payment obligation % is already settled', v_payment.id;
    END IF;
  END IF;

  v_prev_payment_status := v_payment.status;
  v_settled_at := COALESCE(v_payment.paid_at, p_paid_at, now());

  -- Step 10: Atomically consume the attempt
  UPDATE public.payment_attempts
  SET
    status = 'consumed',
    provider_payment_id = trim(p_provider_payment_id),
    provider_signature = COALESCE(p_provider_signature, provider_signature),
    verified_amount_paise = p_verified_amount_paise,
    captured_at = COALESCE(captured_at, v_settled_at),
    consumed_at = COALESCE(consumed_at, v_settled_at)
  WHERE id = v_attempt.id;

  -- Step 11: Expire any other still-open attempts for the same rent obligation
  UPDATE public.payment_attempts
  SET status = 'expired'
  WHERE payment_id = v_payment.id
    AND id <> v_attempt.id
    AND status IN ('created', 'captured');

  -- Step 12: Settle the payment obligation once
  UPDATE public.payments
  SET
    status = 'paid',
    verification_status = 'verified_provider',
    paid_at = v_settled_at,
    payment_method = 'razorpay',
    transaction_id = trim(p_provider_payment_id),
    razorpay_payment_id = trim(p_provider_payment_id),
    razorpay_order_id = trim(p_provider_order_id),
    refunded_amount = 0,
    reversed_at = NULL,
    reversal_reason = NULL
  WHERE id = v_payment.id
    AND status NOT IN ('paid', 'partially_refunded', 'refunded');

  -- Step 13: Record immutable audit log entry
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
    provider_payment_id,
    reason
  ) VALUES (
    v_payment.id,
    v_attempt.id,
    'settled_razorpay',
    COALESCE(p_caller_user_id, v_attempt.user_id),
    CASE WHEN p_caller_user_id IS NOT NULL THEN 'tenant' ELSE 'webhook_or_reconciler' END,
    v_prev_payment_status,
    'paid',
    v_payment.amount,
    trim(p_provider_order_id),
    trim(p_provider_payment_id),
    'Settled via verified Razorpay capture'
  );

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

-- Database-level reconciliation of any already-captured attempts after app closure or transient error
CREATE OR REPLACE FUNCTION public.reconcile_captured_payment_attempts(
  p_payment_id uuid,
  p_caller_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.payments%ROWTYPE;
  v_tenant_user_id uuid;
  v_tenant_owner_id uuid;
  v_captured_attempt public.payment_attempts%ROWTYPE;
  v_effective_user uuid;
  v_result jsonb;
BEGIN
  IF NOT public.is_service_or_superuser() THEN
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'Authentication required to reconcile payment %', p_payment_id;
    END IF;
    IF p_caller_user_id IS NOT NULL AND p_caller_user_id <> auth.uid() THEN
      RAISE EXCEPTION 'Unauthorized caller_user_id mismatch';
    END IF;
    v_effective_user := auth.uid();
  ELSE
    v_effective_user := COALESCE(p_caller_user_id, auth.uid());
  END IF;

  -- Lock parent payment FIRST
  SELECT *
  INTO v_payment
  FROM public.payments
  WHERE id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment obligation % not found', p_payment_id;
  END IF;

  SELECT t.user_id, t.owner_id
  INTO v_tenant_user_id, v_tenant_owner_id
  FROM public.tenants t
  WHERE t.id = v_payment.tenant_id;

  IF NOT public.is_service_or_superuser() THEN
    IF v_effective_user IS DISTINCT FROM v_tenant_user_id
       AND v_effective_user IS DISTINCT FROM v_tenant_owner_id THEN
      RAISE EXCEPTION 'Unauthorized access to reconcile payment %', p_payment_id;
    END IF;
  ELSIF v_effective_user IS NOT NULL
        AND v_effective_user <> v_tenant_user_id
        AND v_effective_user <> v_tenant_owner_id THEN
    RAISE EXCEPTION 'Unauthorized access to reconcile payment %', p_payment_id;
  END IF;

  IF v_payment.status = 'paid' THEN
    RETURN jsonb_build_object(
      'success', true,
      'reconciled', true,
      'idempotent_replay', true,
      'status', 'paid',
      'payment_id', v_payment.id,
      'amount', v_payment.amount,
      'paid_at', v_payment.paid_at,
      'razorpay_order_id', v_payment.razorpay_order_id,
      'razorpay_payment_id', v_payment.razorpay_payment_id
    );
  END IF;

  -- Lock child attempts in deterministic ID order
  PERFORM 1
  FROM public.payment_attempts
  WHERE payment_id = v_payment.id
  ORDER BY id ASC
  FOR UPDATE;

  SELECT *
  INTO v_captured_attempt
  FROM public.payment_attempts
  WHERE payment_id = v_payment.id
    AND status = 'captured'
    AND provider_payment_id IS NOT NULL
    AND verified_amount_paise = expected_amount_paise
  ORDER BY captured_at ASC NULLS LAST, created_at ASC
  LIMIT 1;

  IF v_captured_attempt.id IS NOT NULL THEN
    v_result := public.consume_razorpay_payment_attempt(
      p_provider_order_id => v_captured_attempt.provider_order_id,
      p_provider_payment_id => v_captured_attempt.provider_payment_id,
      p_provider_signature => v_captured_attempt.provider_signature,
      p_verified_amount_paise => v_captured_attempt.verified_amount_paise,
      p_verified_currency => v_captured_attempt.currency,
      p_caller_user_id => v_captured_attempt.user_id,
      p_target_payment_id => v_payment.id,
      p_paid_at => v_captured_attempt.captured_at
    );
    RETURN v_result || jsonb_build_object('reconciled', true, 'status', 'paid');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'reconciled', false,
    'status', v_payment.status,
    'payment_id', v_payment.id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_captured_payment_attempts(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_captured_payment_attempts(uuid, uuid) TO authenticated, service_role;

-- 11. Direct UPI Configuration, Submission (Under Review), and Owner Approval/Rejection with Audit Trail (Item 5)
CREATE OR REPLACE FUNCTION public.configure_property_upi_destination(
  p_property_id uuid,
  p_upi_id text,
  p_payee_name text,
  p_verified boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_prop public.properties%ROWTYPE;
  v_clean_upi text;
  v_clean_payee text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL AND NOT public.is_service_or_superuser() THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT *
  INTO v_prop
  FROM public.properties
  WHERE id = p_property_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Property % not found', p_property_id;
  END IF;

  IF NOT public.is_service_or_superuser() AND v_prop.owner_id IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'Forbidden: only the property owner can configure UPI payee details';
  ELSIF v_user_id IS NOT NULL AND v_prop.owner_id <> v_user_id THEN
    RAISE EXCEPTION 'Forbidden: only the property owner can configure UPI payee details';
  END IF;

  v_clean_upi := NULLIF(lower(trim(COALESCE(p_upi_id, ''))), '');
  v_clean_payee := NULLIF(trim(COALESCE(p_payee_name, '')), '');

  IF p_verified AND (v_clean_upi IS NULL OR v_clean_payee IS NULL) THEN
    RAISE EXCEPTION 'A valid UPI ID and payee name are required to enable verified UPI destination';
  END IF;

  UPDATE public.properties
  SET
    upi_id = v_clean_upi,
    upi_payee_name = v_clean_payee,
    upi_verified = COALESCE(p_verified, false) AND v_clean_upi IS NOT NULL AND v_clean_payee IS NOT NULL,
    upi_verified_at = CASE
      WHEN COALESCE(p_verified, false) AND v_clean_upi IS NOT NULL AND v_clean_payee IS NOT NULL THEN now()
      ELSE NULL
    END
  WHERE id = p_property_id
  RETURNING * INTO v_prop;

  RETURN jsonb_build_object(
    'success', true,
    'property_id', v_prop.id,
    'upi_id', v_prop.upi_id,
    'upi_payee_name', v_prop.upi_payee_name,
    'upi_verified', v_prop.upi_verified,
    'upi_verified_at', v_prop.upi_verified_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.configure_property_upi_destination(uuid, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.configure_property_upi_destination(uuid, text, text, boolean) TO authenticated, service_role;

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

  v_clean_utr := regexp_replace(trim(COALESCE(p_utr_number, '')), '\s+', '', 'g');
  IF length(v_clean_utr) < 6 OR length(v_clean_utr) > 32 OR v_clean_utr !~ '^[A-Za-z0-9-]+$' THEN
    RAISE EXCEPTION 'Please enter a valid UPI reference number (UTR).';
  END IF;

  v_clean_method := lower(trim(COALESCE(p_payment_method, 'gpay')));
  IF v_clean_method NOT IN ('gpay', 'phonepe', 'paytm') THEN
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
    utr_number = v_clean_utr,
    payment_method = v_clean_method,
    paid_at = NULL,
    transaction_id = NULL,
    reviewed_by = NULL,
    reviewed_at = NULL,
    review_notes = NULL
  WHERE id = v_payment.id
  RETURNING * INTO v_payment;

  INSERT INTO public.payment_audit_log (
    payment_id,
    action,
    actor_id,
    actor_role,
    previous_status,
    new_status,
    amount,
    utr_number,
    reason,
    metadata
  ) VALUES (
    v_payment.id,
    'upi_submitted',
    COALESCE(auth.uid(), v_tenant_user_id),
    'tenant',
    v_prev_status,
    'under_review',
    v_payment.amount,
    v_clean_utr,
    'Tenant submitted UPI reference for owner verification',
    jsonb_build_object('payment_method', v_clean_method)
  );

  RETURN jsonb_build_object(
    'success', true,
    'status', 'under_review',
    'settled', false,
    'outstanding', true,
    'payment_id', v_payment.id,
    'amount', v_payment.amount,
    'utr_number', v_clean_utr
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_upi_payment(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_upi_payment(uuid, text, text) TO authenticated, service_role;

-- Owner approval / rejection of submitted UPI reference with full audit trail
CREATE OR REPLACE FUNCTION public.review_upi_payment(
  p_payment_id uuid,
  p_decision text,
  p_reason text DEFAULT NULL,
  p_actor_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.payments%ROWTYPE;
  v_owner_id uuid;
  v_actor uuid;
  v_decision text;
  v_settled_at timestamptz;
  v_reverted_status text;
  v_utr text;
BEGIN
  IF NOT public.is_service_or_superuser() THEN
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'Authentication required to review UPI payment';
    END IF;
    IF p_actor_user_id IS NOT NULL AND p_actor_user_id <> auth.uid() THEN
      RAISE EXCEPTION 'Forbidden: actor_user_id mismatch';
    END IF;
    v_actor := auth.uid();
  ELSE
    v_actor := COALESCE(auth.uid(), p_actor_user_id);
  END IF;

  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required to review UPI payment';
  END IF;

  v_decision := lower(trim(COALESCE(p_decision, '')));
  IF v_decision NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'Invalid review decision: must be approve or reject';
  END IF;

  -- Lock parent payment FIRST
  SELECT *
  INTO v_payment
  FROM public.payments
  WHERE id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment obligation % not found', p_payment_id;
  END IF;

  SELECT t.owner_id
  INTO v_owner_id
  FROM public.tenants t
  WHERE t.id = v_payment.tenant_id;

  IF v_owner_id IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Forbidden: only the property owner can approve or reject UPI references';
  END IF;

  IF v_payment.status <> 'under_review' OR v_payment.utr_number IS NULL THEN
    RAISE EXCEPTION 'Payment % is not awaiting UPI review (current status: %)', p_payment_id, v_payment.status;
  END IF;

  v_utr := v_payment.utr_number;

  -- Lock child attempts in deterministic order
  PERFORM 1
  FROM public.payment_attempts
  WHERE payment_id = v_payment.id
  ORDER BY id ASC
  FOR UPDATE;

  IF v_decision = 'approve' THEN
    v_settled_at := now();

    -- Expire any open Razorpay attempts for this obligation
    UPDATE public.payment_attempts
    SET status = 'expired'
    WHERE payment_id = v_payment.id
      AND status IN ('created', 'captured');

    UPDATE public.payments
    SET
      status = 'paid',
      verification_status = 'verified_owner',
      paid_at = v_settled_at,
      transaction_id = 'UPI-' || v_utr,
      reviewed_by = v_actor,
      reviewed_at = v_settled_at,
      review_notes = COALESCE(NULLIF(trim(COALESCE(p_reason, '')), ''), 'Approved by property owner after verifying bank credit')
    WHERE id = v_payment.id
    RETURNING * INTO v_payment;

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
      'upi_approved',
      v_actor,
      'owner',
      'under_review',
      'paid',
      v_payment.amount,
      v_utr,
      v_payment.review_notes
    );

    RETURN jsonb_build_object(
      'success', true,
      'decision', 'approve',
      'status', 'paid',
      'settled', true,
      'payment_id', v_payment.id,
      'amount', v_payment.amount,
      'paid_at', v_payment.paid_at,
      'transaction_id', v_payment.transaction_id,
      'utr_number', v_utr,
      'reviewed_by', v_actor,
      'reviewed_at', v_settled_at
    );
  ELSE
    v_reverted_status := CASE WHEN CURRENT_DATE > v_payment.due_date THEN 'overdue' ELSE 'pending' END;

    UPDATE public.payments
    SET
      status = v_reverted_status,
      verification_status = 'unverified',
      last_rejected_utr = v_utr,
      utr_number = NULL,
      transaction_id = NULL,
      paid_at = NULL,
      reviewed_by = v_actor,
      reviewed_at = now(),
      review_notes = COALESCE(NULLIF(trim(COALESCE(p_reason, '')), ''), 'Rejected by property owner: UTR not found in bank statement')
    WHERE id = v_payment.id
    RETURNING * INTO v_payment;

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
      'upi_rejected',
      v_actor,
      'owner',
      'under_review',
      v_reverted_status,
      v_payment.amount,
      v_utr,
      v_payment.review_notes
    );

    RETURN jsonb_build_object(
      'success', true,
      'decision', 'reject',
      'status', v_reverted_status,
      'settled', false,
      'outstanding', true,
      'payment_id', v_payment.id,
      'amount', v_payment.amount,
      'rejected_utr', v_utr,
      'reviewed_by', v_actor,
      'reviewed_at', v_payment.reviewed_at,
      'review_notes', v_payment.review_notes
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.review_upi_payment(uuid, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_upi_payment(uuid, text, text, uuid) TO authenticated, service_role;

-- 12. Refunds, Reversals, and Corrections with Append-Only Ledger Entries (Item 7)
CREATE OR REPLACE FUNCTION public.refund_payment(
  p_payment_id uuid,
  p_refund_amount numeric DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_refund_reference text DEFAULT NULL,
  p_actor_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.payments%ROWTYPE;
  v_owner_id uuid;
  v_property_id uuid;
  v_tenant_name text;
  v_actor uuid;
  v_refund_amt numeric(12, 2);
  v_remaining_refundable numeric(12, 2);
  v_new_total_refunded numeric(12, 2);
  v_new_status text;
  v_prev_status text;
  v_settlement_tx_id uuid;
  v_refund_tx_id uuid;
  v_ref text;
BEGIN
  IF NOT public.is_service_or_superuser() THEN
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'Authentication required to issue refund';
    END IF;
    IF p_actor_user_id IS NOT NULL AND p_actor_user_id <> auth.uid() THEN
      RAISE EXCEPTION 'Forbidden: actor_user_id mismatch';
    END IF;
    v_actor := auth.uid();
  ELSE
    v_actor := COALESCE(auth.uid(), p_actor_user_id);
  END IF;

  -- Lock parent payment FIRST
  SELECT *
  INTO v_payment
  FROM public.payments
  WHERE id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment % not found', p_payment_id;
  END IF;

  SELECT t.owner_id, t.property_id, t.full_name
  INTO v_owner_id, v_property_id, v_tenant_name
  FROM public.tenants t
  WHERE t.id = v_payment.tenant_id;

  IF NOT public.is_service_or_superuser() THEN
    IF v_actor IS DISTINCT FROM v_owner_id THEN
      RAISE EXCEPTION 'Forbidden: only the property owner or payment server can issue refunds';
    END IF;
  ELSIF v_actor IS NOT NULL AND v_actor <> v_owner_id THEN
    RAISE EXCEPTION 'Forbidden: only the property owner or payment server can issue refunds';
  END IF;

  v_ref := COALESCE(NULLIF(trim(COALESCE(p_refund_reference, '')), ''), 'RFND-' || gen_random_uuid()::text);

  -- Idempotent replay check if this exact refund_reference was already recorded for this payment
  IF EXISTS (
    SELECT 1 FROM public.transactions tr
    WHERE tr.payment_id = v_payment.id
      AND tr.entry_kind = 'refund'
      AND tr.reference_id = v_ref
  ) THEN
    RETURN jsonb_build_object(
      'success', true,
      'idempotent_replay', true,
      'payment_id', v_payment.id,
      'status', v_payment.status,
      'gross_amount', v_payment.amount,
      'refunded_amount', v_payment.refunded_amount,
      'net_amount', v_payment.amount - v_payment.refunded_amount
    );
  END IF;

  IF v_payment.status NOT IN ('paid', 'partially_refunded') THEN
    RAISE EXCEPTION 'Only paid or partially_refunded payments can be refunded (current status: %)', v_payment.status;
  END IF;

  v_remaining_refundable := v_payment.amount - COALESCE(v_payment.refunded_amount, 0);
  v_refund_amt := COALESCE(p_refund_amount, v_remaining_refundable);

  IF v_refund_amt <= 0 OR v_refund_amt > v_remaining_refundable THEN
    RAISE EXCEPTION 'Invalid refund amount %: must be between 0.01 and remaining refundable balance %',
      v_refund_amt, v_remaining_refundable;
  END IF;

  v_prev_status := v_payment.status;
  v_new_total_refunded := COALESCE(v_payment.refunded_amount, 0) + v_refund_amt;
  v_new_status := CASE
    WHEN v_new_total_refunded >= v_payment.amount THEN 'refunded'
    ELSE 'partially_refunded'
  END;

  UPDATE public.payments
  SET
    status = v_new_status,
    refunded_amount = v_new_total_refunded,
    refunded_at = now(),
    refund_reason = COALESCE(NULLIF(trim(COALESCE(p_reason, '')), ''), 'Payment refunded'),
    refund_reference = v_ref
  WHERE id = v_payment.id
  RETURNING * INTO v_payment;

  SELECT id
  INTO v_settlement_tx_id
  FROM public.transactions
  WHERE payment_id = v_payment.id AND entry_kind = 'settlement'
  LIMIT 1;

  -- Append offsetting negative rent ledger entry (preserving original settlement transaction)
  INSERT INTO public.transactions (
    property_id,
    payment_id,
    parent_transaction_id,
    type,
    entry_kind,
    category,
    amount,
    description,
    date,
    reference_id,
    reconciliation_status,
    reconciliation_notes
  ) VALUES (
    v_property_id,
    v_payment.id,
    v_settlement_tx_id,
    'rent',
    'refund',
    'residential',
    -v_refund_amt,
    format('Rent refund to %s (%s)', COALESCE(v_tenant_name, 'Tenant'), COALESCE(NULLIF(trim(COALESCE(p_reason, '')), ''), v_ref)),
    CURRENT_DATE,
    v_ref,
    'verified',
    'Offsetting refund ledger entry for payment ' || v_payment.id::text
  )
  RETURNING id INTO v_refund_tx_id;

  INSERT INTO public.payment_audit_log (
    payment_id,
    ledger_transaction_id,
    action,
    actor_id,
    actor_role,
    previous_status,
    new_status,
    amount,
    reason,
    metadata
  ) VALUES (
    v_payment.id,
    v_refund_tx_id,
    CASE WHEN v_new_status = 'refunded' THEN 'payment_refunded' ELSE 'payment_partially_refunded' END,
    v_actor,
    CASE WHEN v_actor = v_owner_id THEN 'owner' ELSE 'system' END,
    v_prev_status,
    v_new_status,
    -v_refund_amt,
    v_payment.refund_reason,
    jsonb_build_object(
      'refund_amount', v_refund_amt,
      'total_refunded', v_new_total_refunded,
      'net_settled_amount', v_payment.amount - v_new_total_refunded,
      'refund_reference', v_ref
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'idempotent_replay', false,
    'payment_id', v_payment.id,
    'ledger_transaction_id', v_refund_tx_id,
    'status', v_payment.status,
    'gross_amount', v_payment.amount,
    'refund_amount', v_refund_amt,
    'refunded_amount', v_payment.refunded_amount,
    'net_amount', v_payment.amount - v_payment.refunded_amount
  );
END;
$$;

REVOKE ALL ON FUNCTION public.refund_payment(uuid, numeric, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refund_payment(uuid, numeric, text, text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reverse_payment(
  p_payment_id uuid,
  p_reason text DEFAULT NULL,
  p_reversal_reference text DEFAULT NULL,
  p_actor_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.payments%ROWTYPE;
  v_owner_id uuid;
  v_property_id uuid;
  v_tenant_name text;
  v_actor uuid;
  v_reversal_amt numeric(12, 2);
  v_prev_status text;
  v_settlement_tx_id uuid;
  v_reversal_tx_id uuid;
  v_ref text;
BEGIN
  IF NOT public.is_service_or_superuser() THEN
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'Authentication required to reverse payment';
    END IF;
    IF p_actor_user_id IS NOT NULL AND p_actor_user_id <> auth.uid() THEN
      RAISE EXCEPTION 'Forbidden: actor_user_id mismatch';
    END IF;
    v_actor := auth.uid();
  ELSE
    v_actor := COALESCE(auth.uid(), p_actor_user_id);
  END IF;

  -- Lock parent payment FIRST
  SELECT *
  INTO v_payment
  FROM public.payments
  WHERE id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment % not found', p_payment_id;
  END IF;

  SELECT t.owner_id, t.property_id, t.full_name
  INTO v_owner_id, v_property_id, v_tenant_name
  FROM public.tenants t
  WHERE t.id = v_payment.tenant_id;

  IF NOT public.is_service_or_superuser() THEN
    IF v_actor IS DISTINCT FROM v_owner_id THEN
      RAISE EXCEPTION 'Forbidden: only the property owner or payment server can reverse a payment';
    END IF;
  ELSIF v_actor IS NOT NULL AND v_actor <> v_owner_id THEN
    RAISE EXCEPTION 'Forbidden: only the property owner or payment server can reverse a payment';
  END IF;

  v_ref := COALESCE(NULLIF(trim(COALESCE(p_reversal_reference, '')), ''), 'REV-' || v_payment.id::text);

  IF v_payment.status = 'reversed' THEN
    RETURN jsonb_build_object(
      'success', true,
      'idempotent_replay', true,
      'payment_id', v_payment.id,
      'status', v_payment.status,
      'gross_amount', v_payment.amount,
      'refunded_amount', v_payment.refunded_amount,
      'net_amount', 0
    );
  END IF;

  IF v_payment.status NOT IN ('paid', 'partially_refunded') THEN
    RAISE EXCEPTION 'Only settled payments can be reversed (current status: %)', v_payment.status;
  END IF;

  v_prev_status := v_payment.status;
  v_reversal_amt := v_payment.amount - COALESCE(v_payment.refunded_amount, 0);

  UPDATE public.payments
  SET
    status = 'reversed',
    refunded_amount = v_payment.amount,
    reversed_at = now(),
    reversal_reason = COALESCE(NULLIF(trim(COALESCE(p_reason, '')), ''), 'Payment settlement reversed')
  WHERE id = v_payment.id
  RETURNING * INTO v_payment;

  SELECT id
  INTO v_settlement_tx_id
  FROM public.transactions
  WHERE payment_id = v_payment.id AND entry_kind = 'settlement'
  LIMIT 1;

  IF v_reversal_amt > 0 THEN
    INSERT INTO public.transactions (
      property_id,
      payment_id,
      parent_transaction_id,
      type,
      entry_kind,
      category,
      amount,
      description,
      date,
      reference_id,
      reconciliation_status,
      reconciliation_notes
    ) VALUES (
      v_property_id,
      v_payment.id,
      v_settlement_tx_id,
      'rent',
      'reversal',
      'residential',
      -v_reversal_amt,
      format('Rent payment reversal for %s (%s)', COALESCE(v_tenant_name, 'Tenant'), v_payment.reversal_reason),
      CURRENT_DATE,
      v_ref,
      'verified',
      'Offsetting reversal ledger entry for payment ' || v_payment.id::text
    )
    RETURNING id INTO v_reversal_tx_id;
  END IF;

  UPDATE public.payment_reconciliation_conflicts
  SET
    status = 'reconciled',
    resolved_by = v_actor,
    resolved_at = now(),
    updated_at = now(),
    resolution_notes = COALESCE(resolution_notes, '') || ' | Reconciled via payment reversal (' || v_payment.reversal_reason || ')'
  WHERE payment_id = v_payment.id
    AND status = 'open';

  INSERT INTO public.payment_audit_log (
    payment_id,
    ledger_transaction_id,
    action,
    actor_id,
    actor_role,
    previous_status,
    new_status,
    amount,
    reason,
    metadata
  ) VALUES (
    v_payment.id,
    v_reversal_tx_id,
    'payment_reversed',
    v_actor,
    CASE WHEN v_actor = v_owner_id THEN 'owner' ELSE 'system' END,
    v_prev_status,
    'reversed',
    -v_reversal_amt,
    v_payment.reversal_reason,
    jsonb_build_object(
      'reversed_amount', v_reversal_amt,
      'net_settled_amount', 0,
      'reversal_reference', v_ref
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'idempotent_replay', false,
    'payment_id', v_payment.id,
    'ledger_transaction_id', v_reversal_tx_id,
    'status', v_payment.status,
    'gross_amount', v_payment.amount,
    'reversed_amount', v_reversal_amt,
    'refunded_amount', v_payment.refunded_amount,
    'net_amount', 0,
    'outstanding_amount', v_payment.amount
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reverse_payment(uuid, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_payment(uuid, text, text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.correct_payment_record(
  p_payment_id uuid,
  p_new_amount numeric,
  p_reason text,
  p_actor_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.payments%ROWTYPE;
  v_owner_id uuid;
  v_property_id uuid;
  v_tenant_name text;
  v_actor uuid;
  v_old_amount numeric(12, 2);
  v_delta numeric(12, 2);
  v_settlement_tx_id uuid;
  v_correction_tx_id uuid;
BEGIN
  IF NOT public.is_service_or_superuser() THEN
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'Authentication required to correct payment record';
    END IF;
    IF p_actor_user_id IS NOT NULL AND p_actor_user_id <> auth.uid() THEN
      RAISE EXCEPTION 'Forbidden: actor_user_id mismatch';
    END IF;
    v_actor := auth.uid();
  ELSE
    v_actor := COALESCE(auth.uid(), p_actor_user_id);
  END IF;

  IF p_new_amount IS NULL OR p_new_amount <= 0 THEN
    RAISE EXCEPTION 'Corrected amount must be greater than zero';
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'A clear correction reason is required for audit trail';
  END IF;

  -- Lock parent payment FIRST
  SELECT *
  INTO v_payment
  FROM public.payments
  WHERE id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment % not found', p_payment_id;
  END IF;

  SELECT t.owner_id, t.property_id, t.full_name
  INTO v_owner_id, v_property_id, v_tenant_name
  FROM public.tenants t
  WHERE t.id = v_payment.tenant_id;

  IF NOT public.is_service_or_superuser() THEN
    IF v_actor IS DISTINCT FROM v_owner_id THEN
      RAISE EXCEPTION 'Forbidden: only the property owner can correct a payment record';
    END IF;
  ELSIF v_actor IS NOT NULL AND v_actor <> v_owner_id THEN
    RAISE EXCEPTION 'Forbidden: only the property owner can correct a payment record';
  END IF;

  IF p_new_amount < COALESCE(v_payment.refunded_amount, 0) THEN
    RAISE EXCEPTION 'Corrected amount (%) cannot be less than already refunded amount (%)',
      p_new_amount, v_payment.refunded_amount;
  END IF;

  v_old_amount := v_payment.amount;
  v_delta := p_new_amount - v_old_amount;

  IF v_delta = 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'no_change', true,
      'payment_id', v_payment.id,
      'amount', v_payment.amount
    );
  END IF;

  -- Lock child attempts and expire any open 'created' attempts if obligation amount changed
  PERFORM 1
  FROM public.payment_attempts
  WHERE payment_id = v_payment.id
  ORDER BY id ASC
  FOR UPDATE;

  UPDATE public.payment_attempts
  SET status = 'expired'
  WHERE payment_id = v_payment.id
    AND status = 'created';

  UPDATE public.payments
  SET
    original_amount = COALESCE(original_amount, v_old_amount),
    amount = p_new_amount,
    corrected_at = now(),
    correction_reason = trim(p_reason)
  WHERE id = v_payment.id
  RETURNING * INTO v_payment;

  -- If the payment was already settled, append a compensating correction entry in public.transactions
  IF v_payment.status IN ('paid', 'partially_refunded') THEN
    SELECT id
    INTO v_settlement_tx_id
    FROM public.transactions
    WHERE payment_id = v_payment.id AND entry_kind = 'settlement'
    LIMIT 1;

    INSERT INTO public.transactions (
      property_id,
      payment_id,
      parent_transaction_id,
      type,
      entry_kind,
      category,
      amount,
      description,
      date,
      reference_id,
      reconciliation_status,
      reconciliation_notes
    ) VALUES (
      v_property_id,
      v_payment.id,
      v_settlement_tx_id,
      'rent',
      'correction',
      'residential',
      v_delta,
      format('Accounting correction for %s: %s (from ₹%s to ₹%s)', COALESCE(v_tenant_name, 'Tenant'), trim(p_reason), v_old_amount, p_new_amount),
      CURRENT_DATE,
      'CORR-' || gen_random_uuid()::text,
      'verified',
      'Compensating ledger adjustment preserving original settlement entry'
    )
    RETURNING id INTO v_correction_tx_id;
  END IF;

  INSERT INTO public.payment_audit_log (
    payment_id,
    ledger_transaction_id,
    action,
    actor_id,
    actor_role,
    previous_status,
    new_status,
    amount,
    reason,
    metadata
  ) VALUES (
    v_payment.id,
    v_correction_tx_id,
    'payment_corrected',
    v_actor,
    CASE WHEN v_actor = v_owner_id THEN 'owner' ELSE 'system' END,
    v_payment.status,
    v_payment.status,
    v_delta,
    trim(p_reason),
    jsonb_build_object(
      'previous_amount', v_old_amount,
      'new_amount', p_new_amount,
      'delta', v_delta
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', v_payment.id,
    'previous_amount', v_old_amount,
    'new_amount', v_payment.amount,
    'delta', v_delta,
    'ledger_transaction_id', v_correction_tx_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.correct_payment_record(uuid, numeric, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.correct_payment_record(uuid, numeric, text, uuid) TO authenticated, service_role;

-- 13. Verified Receipt Eligibility Check RPC (Item 5 & Item 8)
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

  -- Only settled ('paid' or 'partially_refunded') payments with confirmed provider or owner verification can issue a paid receipt
  IF v_payment.status NOT IN ('paid', 'partially_refunded')
     OR v_payment.paid_at IS NULL
     OR v_payment.verification_status NOT IN ('verified_provider', 'verified_owner') THEN
    RETURN jsonb_build_object(
      'eligible', false,
      'status', v_payment.status,
      'verification_status', v_payment.verification_status,
      'reason', format('Paid receipt requires confirmed settlement (current status: %s, verification: %s)', v_payment.status, v_payment.verification_status)
    );
  END IF;

  v_tx_id := COALESCE(v_payment.razorpay_payment_id, v_payment.transaction_id);
  v_net_amount := v_payment.amount - COALESCE(v_payment.refunded_amount, 0);

  RETURN jsonb_build_object(
    'eligible', true,
    'payment_id', v_payment.id,
    'id', v_payment.id,
    'status', v_payment.status,
    'verification_status', v_payment.verification_status,
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

-- 14. Comprehensive Automated Payment Acceptance Test Suite (Item 8)
CREATE OR REPLACE FUNCTION public.run_payment_acceptance_tests()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_id uuid := '0c7a5a05-edbf-4eaf-a924-1a1ed5c243d0';
  v_tenant_a_user_id uuid := 'f613025d-8713-47e7-938b-d370b747db6b';
  v_tenant_a_id uuid := '6ee57595-99f2-4cb5-bfd5-a783ba806496';
  v_lease_a_id uuid := 'eef09aa3-dddc-44b5-a390-dbac9b4a7594';
  v_prop_a_id uuid := '61773069-53d4-4276-ad16-49c2206d8ff4';

  v_tenant_b_user_id uuid := '158f710e-bda2-44f5-8b01-2d362c44b5a7';
  v_tenant_b_id uuid;
  v_lease_b_id uuid;

  v_pay_a_id uuid;
  v_pay_b_id uuid;
  v_pay_fail_id uuid;
  v_pay_rec_id uuid;
  v_pay_upi_id uuid;
  v_pay_ref_id uuid;

  v_orig_prop_upi_id text;
  v_orig_prop_payee text;
  v_orig_prop_verified boolean;
  v_orig_prop_verified_at timestamptz;

  v_err_msg text;
  v_res1 jsonb;
  v_res2 jsonb;
  v_res3 jsonb;
  v_tx_count int;
  v_net_ledger numeric(12, 2);
  v_paid_at_1 timestamptz;
  v_paid_at_2 timestamptz;
  v_delete_blocked boolean := false;

  v_results jsonb := '{}'::jsonb;
BEGIN
  SELECT upi_id, upi_payee_name, upi_verified, upi_verified_at
  INTO v_orig_prop_upi_id, v_orig_prop_payee, v_orig_prop_verified, v_orig_prop_verified_at
  FROM public.properties
  WHERE id = v_prop_a_id;

  -- Create temporary isolated test fixtures
  INSERT INTO public.tenants (user_id, owner_id, property_id, full_name, unit_number, status)
  VALUES (v_tenant_b_user_id, v_owner_id, v_prop_a_id, 'Test Tenant B', 'B-999', 'active')
  RETURNING id INTO v_tenant_b_id;

  INSERT INTO public.leases (tenant_id, property_id, start_date, end_date, monthly_rent, status)
  VALUES (v_tenant_b_id, v_prop_a_id, '2026-01-01', '2029-12-31', 15000, 'active')
  RETURNING id INTO v_lease_b_id;

  INSERT INTO public.payments (tenant_id, lease_id, amount, due_date, status)
  VALUES (v_tenant_a_id, v_lease_a_id, 15000, '2099-01-01', 'pending')
  RETURNING id INTO v_pay_a_id;

  INSERT INTO public.payments (tenant_id, lease_id, amount, due_date, status)
  VALUES (v_tenant_b_id, v_lease_b_id, 15000, '2099-01-01', 'pending')
  RETURNING id INTO v_pay_b_id;

  -- =========================================================================
  -- TEST 1: ₹1 cannot settle ₹15,000 rent
  -- =========================================================================
  -- 1a. Attempt to insert a ₹1 obligation for a ₹15,000 lease -> blocked by trigger
  v_err_msg := NULL;
  BEGIN
    INSERT INTO public.payments (tenant_id, lease_id, amount, due_date, status)
    VALUES (v_tenant_a_id, v_lease_a_id, 1, '2099-02-01', 'pending');
  EXCEPTION WHEN OTHERS THEN
    v_err_msg := SQLERRM;
  END;
  IF v_err_msg IS NULL OR v_err_msg NOT ILIKE '%must match lease monthly_rent%' THEN
    RAISE EXCEPTION 'Test 1a failed: expected ₹1 obligation insert to be rejected, got: %', COALESCE(v_err_msg, 'NO ERROR');
  END IF;

  -- 1a2. Attempt by Tenant A to self-correct their ₹15,000 obligation down to ₹1 -> blocked
  v_err_msg := NULL;
  BEGIN
    PERFORM public.correct_payment_record(v_pay_a_id, 1, 'Tenant self-discount attempt', v_tenant_a_user_id);
  EXCEPTION WHEN OTHERS THEN
    v_err_msg := SQLERRM;
  END;
  IF v_err_msg IS NULL OR v_err_msg NOT ILIKE '%Forbidden%' THEN
    RAISE EXCEPTION 'Test 1a2 failed: expected tenant self-correction to ₹1 to be rejected, got: %', COALESCE(v_err_msg, 'NO ERROR');
  END IF;

  -- 1b. Attempt to register a ₹1 (100 paise) attempt for ₹15,000 obligation -> blocked
  v_err_msg := NULL;
  BEGIN
    PERFORM public.register_razorpay_payment_attempt(v_pay_a_id, v_tenant_a_user_id, 'order_test_1rs_reg', 100, 'INR');
  EXCEPTION WHEN OTHERS THEN
    v_err_msg := SQLERRM;
  END;
  IF v_err_msg IS NULL OR v_err_msg NOT ILIKE '%Expected amount mismatch%' THEN
    RAISE EXCEPTION 'Test 1b failed: expected 100 paise attempt registration to be rejected, got: %', COALESCE(v_err_msg, 'NO ERROR');
  END IF;

  -- 1c. Register valid ₹15,000 (1500000 paise) attempt, then attempt to settle with ₹1 (100 paise) capture -> blocked
  PERFORM public.register_razorpay_payment_attempt(v_pay_a_id, v_tenant_a_user_id, 'order_test_a_15000', 1500000, 'INR');
  v_err_msg := NULL;
  BEGIN
    PERFORM public.consume_razorpay_payment_attempt(
      p_provider_order_id => 'order_test_a_15000',
      p_provider_payment_id => 'pay_test_1rs_capture',
      p_verified_amount_paise => 100,
      p_verified_currency => 'INR',
      p_caller_user_id => v_tenant_a_user_id,
      p_target_payment_id => v_pay_a_id
    );
  EXCEPTION WHEN OTHERS THEN
    v_err_msg := SQLERRM;
  END;
  IF v_err_msg IS NULL OR v_err_msg NOT ILIKE '%Amount mismatch%' THEN
    RAISE EXCEPTION 'Test 1c failed: expected 100 paise settlement to be rejected, got: %', COALESCE(v_err_msg, 'NO ERROR');
  END IF;

  IF (SELECT status FROM public.payments WHERE id = v_pay_a_id) <> 'pending' THEN
    RAISE EXCEPTION 'Test 1 failed: payment status changed after rejected ₹1 attempt';
  END IF;

  v_results := v_results || jsonb_build_object(
    'test_1_one_rupee_cannot_settle_15000', jsonb_build_object(
      'passed', true,
      'obligation_insert_blocked', true,
      'tenant_self_correction_blocked', true,
      'attempt_registration_blocked', true,
      'consumption_mismatch_error', v_err_msg,
      'payment_status_after', (SELECT status FROM public.payments WHERE id = v_pay_a_id)
    )
  );

  -- =========================================================================
  -- TEST 2: Tenant A cannot settle Tenant B's rent
  -- =========================================================================
  -- 2a. Tenant A attempts to register an order for Tenant B's payment -> blocked
  v_err_msg := NULL;
  BEGIN
    PERFORM public.register_razorpay_payment_attempt(v_pay_b_id, v_tenant_a_user_id, 'order_cross_reg', 1500000, 'INR');
  EXCEPTION WHEN OTHERS THEN
    v_err_msg := SQLERRM;
  END;
  IF v_err_msg IS NULL OR v_err_msg NOT ILIKE '%Unauthorized%' THEN
    RAISE EXCEPTION 'Test 2a failed: expected Tenant A order creation on Tenant B payment to fail, got: %', COALESCE(v_err_msg, 'NO ERROR');
  END IF;

  -- 2b. Tenant A attempts to use their own valid order ('order_test_a_15000') to settle Tenant B's payment (v_pay_b_id) -> blocked
  v_err_msg := NULL;
  BEGIN
    PERFORM public.consume_razorpay_payment_attempt(
      p_provider_order_id => 'order_test_a_15000',
      p_provider_payment_id => 'pay_cross_settle',
      p_verified_amount_paise => 1500000,
      p_verified_currency => 'INR',
      p_caller_user_id => v_tenant_a_user_id,
      p_target_payment_id => v_pay_b_id
    );
  EXCEPTION WHEN OTHERS THEN
    v_err_msg := SQLERRM;
  END;
  IF v_err_msg IS NULL OR v_err_msg NOT ILIKE '%Obligation mismatch%' THEN
    RAISE EXCEPTION 'Test 2b failed: expected cross-obligation settlement to be rejected, got: %', COALESCE(v_err_msg, 'NO ERROR');
  END IF;

  -- 2c. Tenant B attempts to verify/consume Tenant A's order -> blocked
  v_err_msg := NULL;
  BEGIN
    PERFORM public.consume_razorpay_payment_attempt(
      p_provider_order_id => 'order_test_a_15000',
      p_provider_payment_id => 'pay_hijack',
      p_verified_amount_paise => 1500000,
      p_verified_currency => 'INR',
      p_caller_user_id => v_tenant_b_user_id,
      p_target_payment_id => v_pay_a_id
    );
  EXCEPTION WHEN OTHERS THEN
    v_err_msg := SQLERRM;
  END;
  IF v_err_msg IS NULL OR v_err_msg NOT ILIKE '%Unauthorized%' THEN
    RAISE EXCEPTION 'Test 2c failed: expected cross-tenant attempt hijack to be rejected, got: %', COALESCE(v_err_msg, 'NO ERROR');
  END IF;

  -- 2d. Tenant B attempts to reconcile Tenant A's payment -> blocked
  v_err_msg := NULL;
  BEGIN
    PERFORM public.reconcile_captured_payment_attempts(v_pay_a_id, v_tenant_b_user_id);
  EXCEPTION WHEN OTHERS THEN
    v_err_msg := SQLERRM;
  END;
  IF v_err_msg IS NULL OR v_err_msg NOT ILIKE '%Unauthorized%' THEN
    RAISE EXCEPTION 'Test 2d failed: expected cross-tenant reconciliation to be rejected, got: %', COALESCE(v_err_msg, 'NO ERROR');
  END IF;

  v_results := v_results || jsonb_build_object(
    'test_2_tenant_a_cannot_settle_tenant_b', jsonb_build_object(
      'passed', true,
      'cross_order_blocked', true,
      'cross_obligation_blocked', true,
      'cross_user_hijack_blocked', true,
      'cross_user_reconcile_blocked', true,
      'tenant_b_payment_status', (SELECT status FROM public.payments WHERE id = v_pay_b_id)
    )
  );

  -- =========================================================================
  -- TEST 3: Replay and concurrent callbacks create no duplicate income
  -- =========================================================================
  -- 3a. Initial settlement via checkout verification
  v_res1 := public.consume_razorpay_payment_attempt(
    p_provider_order_id => 'order_test_a_15000',
    p_provider_payment_id => 'pay_valid_a_15000',
    p_provider_signature => 'sig_valid_a',
    p_verified_amount_paise => 1500000,
    p_verified_currency => 'INR',
    p_caller_user_id => v_tenant_a_user_id,
    p_target_payment_id => v_pay_a_id,
    p_paid_at => '2026-11-01T10:00:00Z'::timestamptz
  );
  v_paid_at_1 := (v_res1->>'paid_at')::timestamptz;

  -- 3b. Webhook replay (no caller_user_id)
  v_res2 := public.consume_razorpay_payment_attempt(
    p_provider_order_id => 'order_test_a_15000',
    p_provider_payment_id => 'pay_valid_a_15000',
    p_provider_signature => NULL,
    p_verified_amount_paise => 1500000,
    p_verified_currency => 'INR',
    p_caller_user_id => NULL,
    p_target_payment_id => v_pay_a_id,
    p_paid_at => '2026-11-01T10:05:00Z'::timestamptz
  );
  v_paid_at_2 := (v_res2->>'paid_at')::timestamptz;

  -- 3c. Reconciler replay
  v_res3 := public.reconcile_captured_payment_attempts(v_pay_a_id, v_tenant_a_user_id);

  -- 3d. Attempt to reuse same provider_payment_id ('pay_valid_a_15000') on Tenant B's order -> blocked
  PERFORM public.register_razorpay_payment_attempt(v_pay_b_id, v_tenant_b_user_id, 'order_test_b_15000', 1500000, 'INR');
  v_err_msg := NULL;
  BEGIN
    PERFORM public.consume_razorpay_payment_attempt(
      p_provider_order_id => 'order_test_b_15000',
      p_provider_payment_id => 'pay_valid_a_15000',
      p_verified_amount_paise => 1500000,
      p_verified_currency => 'INR',
      p_caller_user_id => v_tenant_b_user_id,
      p_target_payment_id => v_pay_b_id
    );
  EXCEPTION WHEN OTHERS THEN
    v_err_msg := SQLERRM;
  END;
  IF v_err_msg IS NULL OR v_err_msg NOT ILIKE '%already been used%' THEN
    RAISE EXCEPTION 'Test 3d failed: expected duplicate provider_payment_id across orders to be rejected, got: %', COALESCE(v_err_msg, 'NO ERROR');
  END IF;

  SELECT count(*), COALESCE(sum(amount), 0)
  INTO v_tx_count, v_net_ledger
  FROM public.transactions
  WHERE payment_id = v_pay_a_id;

  IF (v_res1->>'idempotent_replay')::boolean IS DISTINCT FROM false
     OR (v_res2->>'idempotent_replay')::boolean IS DISTINCT FROM true
     OR (v_res3->>'idempotent_replay')::boolean IS DISTINCT FROM true
     OR v_paid_at_1 IS DISTINCT FROM v_paid_at_2
     OR v_tx_count <> 1
     OR v_net_ledger <> 15000 THEN
    RAISE EXCEPTION 'Test 3 failed: tx_count=%, net_ledger=%, paid_at_1=%, paid_at_2=%',
      v_tx_count, v_net_ledger, v_paid_at_1, v_paid_at_2;
  END IF;

  v_results := v_results || jsonb_build_object(
    'test_3_replay_and_concurrent_callbacks_no_duplicate_income', jsonb_build_object(
      'passed', true,
      'first_call_idempotent_replay', (v_res1->>'idempotent_replay')::boolean,
      'webhook_replay_idempotent', (v_res2->>'idempotent_replay')::boolean,
      'reconciler_replay_idempotent', (v_res3->>'idempotent_replay')::boolean,
      'paid_at_preserved', (v_paid_at_1 = v_paid_at_2),
      'ledger_transaction_count', v_tx_count,
      'ledger_total_amount', v_net_ledger
    )
  );

  -- =========================================================================
  -- TEST 4: Failed/cancelled checkout never produces a paid receipt
  -- =========================================================================
  INSERT INTO public.payments (tenant_id, lease_id, amount, due_date, status)
  VALUES (v_tenant_a_id, v_lease_a_id, 15000, '2099-03-01', 'pending')
  RETURNING id INTO v_pay_fail_id;

  PERFORM public.register_razorpay_payment_attempt(v_pay_fail_id, v_tenant_a_user_id, 'order_test_failed_checkout', 1500000, 'INR');
  PERFORM public.mark_razorpay_attempt_failed('order_test_failed_checkout', 'User cancelled / payment failed');

  v_res1 := public.verify_payment_receipt_eligibility(v_pay_fail_id);
  SELECT count(*) INTO v_tx_count FROM public.transactions WHERE payment_id = v_pay_fail_id;

  IF (v_res1->>'eligible')::boolean IS DISTINCT FROM false
     OR (SELECT status FROM public.payments WHERE id = v_pay_fail_id) <> 'pending'
     OR (SELECT status FROM public.payment_attempts WHERE provider_order_id = 'order_test_failed_checkout') <> 'failed'
     OR v_tx_count <> 0 THEN
    RAISE EXCEPTION 'Test 4 failed: receipt eligibility=%', v_res1;
  END IF;

  v_results := v_results || jsonb_build_object(
    'test_4_failed_cancelled_checkout_never_produces_paid_receipt', jsonb_build_object(
      'passed', true,
      'attempt_status', 'failed',
      'payment_status', (SELECT status FROM public.payments WHERE id = v_pay_fail_id),
      'receipt_eligible', (v_res1->>'eligible')::boolean,
      'receipt_rejection_reason', v_res1->>'reason',
      'ledger_transaction_count', v_tx_count
    )
  );

  -- =========================================================================
  -- TEST 5: Captured payment reconciles after the app closes (and multiple attempts expire prior open ones)
  -- =========================================================================
  INSERT INTO public.payments (tenant_id, lease_id, amount, due_date, status)
  VALUES (v_tenant_a_id, v_lease_a_id, 15000, '2099-04-01', 'pending')
  RETURNING id INTO v_pay_rec_id;

  -- Create attempt 1, then create attempt 2 -> attempt 1 automatically becomes 'expired' (only 1 'created' allowed)
  PERFORM public.register_razorpay_payment_attempt(v_pay_rec_id, v_tenant_a_user_id, 'order_test_rec_1', 1500000, 'INR');
  PERFORM public.register_razorpay_payment_attempt(v_pay_rec_id, v_tenant_a_user_id, 'order_test_rec_2', 1500000, 'INR');

  IF (SELECT status FROM public.payment_attempts WHERE provider_order_id = 'order_test_rec_1') <> 'expired'
     OR (SELECT count(*) FROM public.payment_attempts WHERE payment_id = v_pay_rec_id AND status = 'created') <> 1 THEN
    RAISE EXCEPTION 'Test 5a failed: multiple open created attempts were not collapsed to 1';
  END IF;

  -- Simulate provider capture recorded while app closed before final settlement completed
  PERFORM public.record_razorpay_attempt_capture('order_test_rec_2', 'pay_test_rec_2_captured', 1500000, 'sig_rec_2');

  -- App reopens and runs reconciliation -> settles without another charge
  v_res1 := public.reconcile_captured_payment_attempts(v_pay_rec_id, v_tenant_a_user_id);
  v_res2 := public.verify_payment_receipt_eligibility(v_pay_rec_id);
  SELECT count(*) INTO v_tx_count FROM public.transactions WHERE payment_id = v_pay_rec_id AND entry_kind = 'settlement';

  IF (v_res1->>'reconciled')::boolean IS DISTINCT FROM true
     OR (SELECT status FROM public.payments WHERE id = v_pay_rec_id) <> 'paid'
     OR (SELECT status FROM public.payment_attempts WHERE provider_order_id = 'order_test_rec_2') <> 'consumed'
     OR (v_res2->>'eligible')::boolean IS DISTINCT FROM true
     OR v_tx_count <> 1 THEN
    RAISE EXCEPTION 'Test 5b failed: reconciliation result=%', v_res1;
  END IF;

  v_results := v_results || jsonb_build_object(
    'test_5_captured_payment_reconciles_after_app_closes', jsonb_build_object(
      'passed', true,
      'prior_open_attempt_expired', true,
      'reconciled', (v_res1->>'reconciled')::boolean,
      'payment_status_after', (SELECT status FROM public.payments WHERE id = v_pay_rec_id),
      'attempt_status_after', (SELECT status FROM public.payment_attempts WHERE provider_order_id = 'order_test_rec_2'),
      'receipt_eligible_after_reconciliation', (v_res2->>'eligible')::boolean,
      'ledger_transaction_count', v_tx_count
    )
  );

  -- =========================================================================
  -- TEST 6: Unverified UPI references remain outstanding (and Direct UPI disabled until property destination is verified)
  -- =========================================================================
  INSERT INTO public.payments (tenant_id, lease_id, amount, due_date, status)
  VALUES (v_tenant_a_id, v_lease_a_id, 15000, '2099-05-01', 'pending')
  RETURNING id INTO v_pay_upi_id;

  -- 6a. Ensure Direct UPI is rejected when property has no verified UPI destination
  PERFORM public.configure_property_upi_destination(v_prop_a_id, NULL, NULL, false);
  v_err_msg := NULL;
  BEGIN
    PERFORM public.submit_upi_payment(v_pay_upi_id, '423589123456', 'gpay');
  EXCEPTION WHEN OTHERS THEN
    v_err_msg := SQLERRM;
  END;
  IF v_err_msg IS NULL OR v_err_msg NOT ILIKE '%Direct UPI is disabled%' THEN
    RAISE EXCEPTION 'Test 6a failed: expected submit_upi_payment to fail when property UPI is unverified, got: %', COALESCE(v_err_msg, 'NO ERROR');
  END IF;

  -- 6b. Owner configures verified UPI destination on property, then tenant submits UTR -> stays under_review & outstanding
  PERFORM public.configure_property_upi_destination(v_prop_a_id, 'owner.verified@okaxis', 'Rudvik Estates LLP', true);
  v_res1 := public.submit_upi_payment(v_pay_upi_id, '423589123456', 'gpay');
  v_res2 := public.verify_payment_receipt_eligibility(v_pay_upi_id);
  SELECT count(*) INTO v_tx_count FROM public.transactions WHERE payment_id = v_pay_upi_id;

  IF (SELECT status FROM public.payments WHERE id = v_pay_upi_id) <> 'under_review'
     OR (SELECT paid_at FROM public.payments WHERE id = v_pay_upi_id) IS NOT NULL
     OR (v_res1->>'outstanding')::boolean IS DISTINCT FROM true
     OR (v_res2->>'eligible')::boolean IS DISTINCT FROM false
     OR v_tx_count <> 0 THEN
    RAISE EXCEPTION 'Test 6b failed: unverified UPI did not remain outstanding or produced a receipt/ledger row';
  END IF;

  -- 6c. Owner rejects unverified UTR -> reverts to pending/overdue, records audit trail
  v_res3 := public.review_upi_payment(v_pay_upi_id, 'reject', 'UTR not found in bank statement', v_owner_id);
  IF (SELECT status FROM public.payments WHERE id = v_pay_upi_id) <> 'pending'
     OR (SELECT last_rejected_utr FROM public.payments WHERE id = v_pay_upi_id) <> '423589123456' THEN
    RAISE EXCEPTION 'Test 6c failed: rejected UPI did not revert to pending with last_rejected_utr';
  END IF;

  -- 6d. Tenant submits valid UTR and owner approves -> settles & becomes receipt-eligible
  PERFORM public.submit_upi_payment(v_pay_upi_id, '423589999888', 'gpay');
  PERFORM public.review_upi_payment(v_pay_upi_id, 'approve', 'Verified credit in HDFC statement', v_owner_id);
  v_res2 := public.verify_payment_receipt_eligibility(v_pay_upi_id);
  SELECT count(*) INTO v_tx_count FROM public.transactions WHERE payment_id = v_pay_upi_id AND entry_kind = 'settlement';

  IF (SELECT status FROM public.payments WHERE id = v_pay_upi_id) <> 'paid'
     OR (v_res2->>'eligible')::boolean IS DISTINCT FROM true
     OR v_tx_count <> 1 THEN
    RAISE EXCEPTION 'Test 6d failed: owner-approved UPI did not settle cleanly';
  END IF;

  v_results := v_results || jsonb_build_object(
    'test_6_unverified_upi_references_remain_outstanding', jsonb_build_object(
      'passed', true,
      'blocked_when_property_upi_unverified', true,
      'status_after_submission', 'under_review',
      'outstanding_while_unverified', true,
      'receipt_blocked_while_unverified', true,
      'ledger_entries_while_unverified', 0,
      'status_after_owner_rejection', 'pending',
      'status_after_owner_approval', 'paid',
      'audit_log_entries', (SELECT count(*) FROM public.payment_audit_log WHERE payment_id = v_pay_upi_id)
    )
  );

  -- =========================================================================
  -- TEST 7: Refunds, reversals, and corrections leave correct balances & preserve history
  -- =========================================================================
  INSERT INTO public.payments (tenant_id, lease_id, amount, due_date, status)
  VALUES (v_tenant_a_id, v_lease_a_id, 15000, '2099-06-01', 'pending')
  RETURNING id INTO v_pay_ref_id;

  PERFORM public.register_razorpay_payment_attempt(v_pay_ref_id, v_tenant_a_user_id, 'order_test_refund_flow', 1500000, 'INR');
  PERFORM public.consume_razorpay_payment_attempt(
    p_provider_order_id => 'order_test_refund_flow',
    p_provider_payment_id => 'pay_test_refund_flow',
    p_verified_amount_paise => 1500000,
    p_verified_currency => 'INR',
    p_caller_user_id => v_tenant_a_user_id,
    p_target_payment_id => v_pay_ref_id
  );

  -- 7a. Partial refund of ₹5,000 -> status = 'partially_refunded', net balance = ₹10,000, 2 ledger rows (+15000, -5000)
  v_res1 := public.refund_payment(v_pay_ref_id, 5000, 'Partial concession refund', 'rfnd_part_1', v_owner_id);
  SELECT count(*), COALESCE(sum(amount), 0) INTO v_tx_count, v_net_ledger FROM public.transactions WHERE payment_id = v_pay_ref_id;

  IF (SELECT status FROM public.payments WHERE id = v_pay_ref_id) <> 'partially_refunded'
     OR (v_res1->>'net_amount')::numeric <> 10000
     OR v_tx_count <> 2
     OR v_net_ledger <> 10000 THEN
    RAISE EXCEPTION 'Test 7a failed: partial refund net_ledger=%, tx_count=%', v_net_ledger, v_tx_count;
  END IF;

  -- 7b. Correction of settled amount from ₹15,000 to ₹14,000 -> net balance = ₹14,000 - ₹5,000 = ₹9,000, 3 ledger rows (+15000, -5000, -1000)
  v_res2 := public.correct_payment_record(v_pay_ref_id, 14000, 'Corrected agreed rent from 15000 to 14000', v_owner_id);
  SELECT count(*), COALESCE(sum(amount), 0) INTO v_tx_count, v_net_ledger FROM public.transactions WHERE payment_id = v_pay_ref_id;

  IF (SELECT amount FROM public.payments WHERE id = v_pay_ref_id) <> 14000
     OR (SELECT original_amount FROM public.payments WHERE id = v_pay_ref_id) <> 15000
     OR v_tx_count <> 3
     OR v_net_ledger <> 9000 THEN
    RAISE EXCEPTION 'Test 7b failed: correction net_ledger=%, tx_count=%', v_net_ledger, v_tx_count;
  END IF;

  -- 7c. Reversal of remaining ₹9,000 -> status = 'reversed', net balance = ₹0, 4 ledger rows (+15000, -5000, -1000, -9000)
  v_res3 := public.reverse_payment(v_pay_ref_id, 'Bank chargeback reversal', 'rev_test_1', v_owner_id);
  SELECT count(*), COALESCE(sum(amount), 0) INTO v_tx_count, v_net_ledger FROM public.transactions WHERE payment_id = v_pay_ref_id;

  IF (SELECT status FROM public.payments WHERE id = v_pay_ref_id) <> 'reversed'
     OR (v_res3->>'net_amount')::numeric <> 0
     OR v_tx_count <> 4
     OR v_net_ledger <> 0 THEN
    RAISE EXCEPTION 'Test 7c failed: reversal net_ledger=%, tx_count=%', v_net_ledger, v_tx_count;
  END IF;

  -- 7d. Verify that deleting financial history from transactions or payments is blocked
  v_delete_blocked := false;
  BEGIN
    DELETE FROM public.transactions WHERE payment_id = v_pay_ref_id;
  EXCEPTION WHEN OTHERS THEN
    v_delete_blocked := true;
  END;
  IF NOT v_delete_blocked THEN
    RAISE EXCEPTION 'Test 7d failed: deleting financial history from transactions was not blocked';
  END IF;

  v_results := v_results || jsonb_build_object(
    'test_7_refunds_reversals_corrections_preserve_history_and_balances', jsonb_build_object(
      'passed', true,
      'net_after_5000_partial_refund', 10000,
      'net_after_1000_downward_correction', 9000,
      'net_after_full_reversal', v_net_ledger,
      'final_payment_status', (SELECT status FROM public.payments WHERE id = v_pay_ref_id),
      'preserved_ledger_entries_count', v_tx_count,
      'history_deletion_blocked', v_delete_blocked
    )
  );

  -- Clean up temporary test fixtures using privileged session GUC
  PERFORM set_config('tenura.allow_test_cleanup', 'on', true);
  UPDATE public.properties
  SET
    upi_id = v_orig_prop_upi_id,
    upi_payee_name = v_orig_prop_payee,
    upi_verified = COALESCE(v_orig_prop_verified, false),
    upi_verified_at = v_orig_prop_verified_at
  WHERE id = v_prop_a_id;

  DELETE FROM public.payment_audit_log WHERE payment_id IN (v_pay_a_id, v_pay_b_id, v_pay_fail_id, v_pay_rec_id, v_pay_upi_id, v_pay_ref_id);
  DELETE FROM public.payment_reconciliation_conflicts WHERE payment_id IN (v_pay_a_id, v_pay_b_id, v_pay_fail_id, v_pay_rec_id, v_pay_upi_id, v_pay_ref_id);
  DELETE FROM public.transactions WHERE payment_id IN (v_pay_a_id, v_pay_b_id, v_pay_fail_id, v_pay_rec_id, v_pay_upi_id, v_pay_ref_id);
  DELETE FROM public.payment_attempts WHERE payment_id IN (v_pay_a_id, v_pay_b_id, v_pay_fail_id, v_pay_rec_id, v_pay_upi_id, v_pay_ref_id);
  DELETE FROM public.payments WHERE id IN (v_pay_a_id, v_pay_b_id, v_pay_fail_id, v_pay_rec_id, v_pay_upi_id, v_pay_ref_id);
  DELETE FROM public.leases WHERE id = v_lease_b_id;
  DELETE FROM public.tenants WHERE id = v_tenant_b_id;
  PERFORM set_config('tenura.allow_test_cleanup', 'off', true);

  RETURN jsonb_build_object(
    'all_passed', true,
    'executed_at', now(),
    'tests', v_results
  );
END;
$$;

REVOKE ALL ON FUNCTION public.run_payment_acceptance_tests() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_payment_acceptance_tests() TO service_role;
