-- ============================================================================
-- Migration 031: Utility Bills Cloud Persistence
-- Persists electricity and water utility bills in Supabase with RLS so receipts
-- and payment histories are never lost across device reinstalls or switches.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.utility_bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  bill_type text NOT NULL CHECK (bill_type IN ('electricity', 'water', 'gas', 'wifi')),
  title text NOT NULL,
  department_code text,
  department_name text,
  department_short_name text,
  department_upi_id text,
  consumer_number text,
  billing_month text,
  amount numeric(12, 2) NOT NULL DEFAULT 0,
  due_date text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  paid_at timestamptz,
  txn_id text,
  payment_method text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_utility_bills_tenant_id ON public.utility_bills(tenant_id);
CREATE INDEX IF NOT EXISTS idx_utility_bills_user_id ON public.utility_bills(user_id);
CREATE INDEX IF NOT EXISTS idx_utility_bills_status ON public.utility_bills(status);

ALTER TABLE public.utility_bills ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenants can view own utility bills" ON public.utility_bills;
CREATE POLICY "Tenants can view own utility bills" ON public.utility_bills
  FOR SELECT
  USING (
    auth.uid() = user_id
    OR tenant_id IN (SELECT id FROM public.tenants WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Tenants can manage own utility bills" ON public.utility_bills;
CREATE POLICY "Tenants can manage own utility bills" ON public.utility_bills
  FOR ALL
  USING (
    auth.uid() = user_id
    OR tenant_id IN (SELECT id FROM public.tenants WHERE user_id = auth.uid())
  )
  WITH CHECK (
    auth.uid() = user_id
    OR tenant_id IN (SELECT id FROM public.tenants WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Owners can view tenant utility bills" ON public.utility_bills;
CREATE POLICY "Owners can view tenant utility bills" ON public.utility_bills
  FOR SELECT
  USING (
    tenant_id IN (
      SELECT t.id FROM public.tenants t
      JOIN public.properties p ON p.id = t.property_id
      WHERE p.owner_id = auth.uid()
    )
  );
