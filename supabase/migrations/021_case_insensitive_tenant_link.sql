-- =========================================================
-- Migration 021: Case-Insensitive Tenant Auto-Link Policies (Phase 2B)
-- =========================================================

-- Drop case-sensitive policies
DROP POLICY IF EXISTS "Tenants claim unlinked row by email" ON public.tenants;
DROP POLICY IF EXISTS "Tenants find unlinked row by email" ON public.tenants;

-- Create case-insensitive SELECT policy for unlinked tenant row
CREATE POLICY "Tenants find unlinked row by email"
  ON public.tenants
  FOR SELECT
  TO authenticated
  USING (
    lower(email) = lower(auth.jwt() ->> 'email')
    AND user_id IS NULL
  );

-- Create case-insensitive UPDATE policy for claiming unlinked tenant row
CREATE POLICY "Tenants claim unlinked row by email"
  ON public.tenants
  FOR UPDATE
  TO authenticated
  USING (
    lower(email) = lower(auth.jwt() ->> 'email')
    AND user_id IS NULL
  )
  WITH CHECK (
    user_id = auth.uid()
  );
