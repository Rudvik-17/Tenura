-- =========================================================
-- Migration 022: Auto-Create Transactions on Paid Payments (Phase 2C)
-- =========================================================

-- Trigger function to create a ledger transaction whenever rent is paid
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
  -- Only execute when status becomes 'paid'
  IF NEW.status = 'paid' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'paid') THEN
    -- Look up associated property and tenant name
    SELECT t.property_id, t.full_name 
    INTO v_property_id, v_tenant_name
    FROM public.tenants t
    WHERE t.id = NEW.tenant_id;

    IF v_property_id IS NOT NULL THEN
      INSERT INTO public.transactions (
        property_id,
        type,
        category,
        amount,
        description,
        date
      ) VALUES (
        v_property_id,
        'rent',
        'residential',
        NEW.amount,
        'Rent payment from ' || COALESCE(v_tenant_name, 'Tenant'),
        COALESCE(NEW.paid_at::date, CURRENT_DATE)
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Create trigger on public.payments
DROP TRIGGER IF EXISTS trg_payment_paid_transaction ON public.payments;
CREATE TRIGGER trg_payment_paid_transaction
  AFTER INSERT OR UPDATE OF status ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.handle_payment_paid_transaction();

-- Backfill transactions for existing paid payments
INSERT INTO public.transactions (
  property_id,
  type,
  category,
  amount,
  description,
  date
)
SELECT 
  t.property_id,
  'rent',
  'residential',
  p.amount,
  'Rent payment from ' || COALESCE(t.full_name, 'Tenant'),
  COALESCE(p.paid_at::date, CURRENT_DATE)
FROM public.payments p
JOIN public.tenants t ON t.id = p.tenant_id
WHERE p.status = 'paid'
  AND t.property_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.transactions tr
    WHERE tr.property_id = t.property_id
      AND tr.amount = p.amount
      AND tr.date = COALESCE(p.paid_at::date, CURRENT_DATE)
  );
