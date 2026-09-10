-- Migration: 017_fix_permissions_and_rls.sql
-- Complete reset & fix of PostgreSQL permissions and RLS policies

-- 1. Grant table & schema permissions for public schema and auth.users
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO anon, authenticated;

-- Grant select on auth.users so any auth helper or subquery never fails with 42501
GRANT SELECT ON auth.users TO authenticated, anon;

-- 2. Drop all old/stale policies in public schema to eliminate conflicts cleanly
DO $$ 
DECLARE 
    r RECORD;
BEGIN
    FOR r IN (SELECT schemaname, tablename, policyname FROM pg_policies WHERE schemaname = 'public') LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
    END LOOP;
END $$;

-- 3. public.users policies
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow select for authenticated users on users" ON public.users
  FOR SELECT TO authenticated USING (
    id = auth.uid()
    OR id IN (SELECT owner_id FROM public.tenants WHERE user_id = auth.uid())
    OR id IN (SELECT user_id FROM public.tenants WHERE owner_id = auth.uid() AND user_id IS NOT NULL)
  );

CREATE POLICY "Users can insert own profile" ON public.users
  FOR INSERT TO authenticated WITH CHECK (id = auth.uid());

CREATE POLICY "Users can update own profile" ON public.users
  FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- 4. public.tenants policies
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenants view own tenant profile" ON public.tenants
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "Owners view own property tenants" ON public.tenants
  FOR SELECT TO authenticated USING (owner_id = auth.uid());

CREATE POLICY "Owners manage own property tenants" ON public.tenants
  FOR ALL TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Tenants find unlinked row by email" ON public.tenants
  FOR SELECT TO authenticated USING (email = (auth.jwt() ->> 'email') AND user_id IS NULL);

CREATE POLICY "Tenants claim unlinked row by email" ON public.tenants
  FOR UPDATE TO authenticated USING (email = (auth.jwt() ->> 'email') AND user_id IS NULL)
  WITH CHECK (user_id = auth.uid());

-- 5. public.properties policies
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners manage own properties" ON public.properties
  FOR ALL TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Tenants view assigned property" ON public.properties
  FOR SELECT TO authenticated USING (
    id IN (SELECT property_id FROM public.tenants WHERE user_id = auth.uid())
    OR owner_id = auth.uid()
  );

-- 6. public.leases policies
ALTER TABLE public.leases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenants view own leases" ON public.leases
  FOR SELECT TO authenticated USING (
    tenant_id IN (SELECT id FROM public.tenants WHERE user_id = auth.uid())
  );

CREATE POLICY "Tenants sign own leases" ON public.leases
  FOR UPDATE TO authenticated USING (
    tenant_id IN (SELECT id FROM public.tenants WHERE user_id = auth.uid())
  ) WITH CHECK (
    tenant_id IN (SELECT id FROM public.tenants WHERE user_id = auth.uid())
  );

CREATE POLICY "Owners manage own leases" ON public.leases
  FOR ALL TO authenticated USING (
    property_id IN (SELECT id FROM public.properties WHERE owner_id = auth.uid())
  ) WITH CHECK (
    property_id IN (SELECT id FROM public.properties WHERE owner_id = auth.uid())
  );

-- 7. public.payments policies
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenants view own payments" ON public.payments
  FOR SELECT TO authenticated USING (
    tenant_id IN (SELECT id FROM public.tenants WHERE user_id = auth.uid())
  );

CREATE POLICY "Tenants insert own payments" ON public.payments
  FOR INSERT TO authenticated WITH CHECK (
    tenant_id IN (SELECT id FROM public.tenants WHERE user_id = auth.uid())
  );

CREATE POLICY "Tenants update own payments" ON public.payments
  FOR UPDATE TO authenticated USING (
    tenant_id IN (SELECT id FROM public.tenants WHERE user_id = auth.uid())
  ) WITH CHECK (
    tenant_id IN (SELECT id FROM public.tenants WHERE user_id = auth.uid())
  );

CREATE POLICY "Owners manage own property payments" ON public.payments
  FOR ALL TO authenticated USING (
    tenant_id IN (SELECT id FROM public.tenants WHERE owner_id = auth.uid())
  ) WITH CHECK (
    tenant_id IN (SELECT id FROM public.tenants WHERE owner_id = auth.uid())
  );

-- 8. public.maintenance_requests policies
ALTER TABLE public.maintenance_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenants view own maintenance requests" ON public.maintenance_requests
  FOR SELECT TO authenticated USING (
    tenant_id IN (SELECT id FROM public.tenants WHERE user_id = auth.uid())
  );

CREATE POLICY "Tenants create maintenance requests" ON public.maintenance_requests
  FOR INSERT TO authenticated WITH CHECK (
    tenant_id IN (SELECT id FROM public.tenants WHERE user_id = auth.uid())
  );

CREATE POLICY "Tenants update own maintenance requests" ON public.maintenance_requests
  FOR UPDATE TO authenticated USING (
    tenant_id IN (SELECT id FROM public.tenants WHERE user_id = auth.uid())
  ) WITH CHECK (
    tenant_id IN (SELECT id FROM public.tenants WHERE user_id = auth.uid())
  );

CREATE POLICY "Owners manage maintenance requests" ON public.maintenance_requests
  FOR ALL TO authenticated USING (
    property_id IN (SELECT id FROM public.properties WHERE owner_id = auth.uid())
  ) WITH CHECK (
    property_id IN (SELECT id FROM public.properties WHERE owner_id = auth.uid())
  );

-- 9. public.transactions policies
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners manage own transactions" ON public.transactions
  FOR ALL TO authenticated USING (
    property_id IN (SELECT id FROM public.properties WHERE owner_id = auth.uid())
  ) WITH CHECK (
    property_id IN (SELECT id FROM public.properties WHERE owner_id = auth.uid())
  );

-- 10. public.units policies
ALTER TABLE public.units ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners manage own units" ON public.units
  FOR ALL TO authenticated USING (
    property_id IN (SELECT id FROM public.properties WHERE owner_id = auth.uid())
  ) WITH CHECK (
    property_id IN (SELECT id FROM public.properties WHERE owner_id = auth.uid())
  );

-- 11. public.stored_payment_methods & public.autopay_settings policies
ALTER TABLE public.stored_payment_methods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own payment methods" ON public.stored_payment_methods
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE public.autopay_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own autopay settings" ON public.autopay_settings
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- 12. public.announcements, public.alerts, public.issue_messages policies
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow select on announcements" ON public.announcements
  FOR SELECT TO authenticated USING (
    property_id IN (SELECT id FROM public.properties WHERE owner_id = auth.uid())
    OR property_id IN (SELECT property_id FROM public.tenants WHERE user_id = auth.uid())
  );

CREATE POLICY "Owners manage announcements" ON public.announcements
  FOR ALL TO authenticated USING (
    property_id IN (SELECT id FROM public.properties WHERE owner_id = auth.uid())
  ) WITH CHECK (
    property_id IN (SELECT id FROM public.properties WHERE owner_id = auth.uid())
  );

ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow select on alerts" ON public.alerts
  FOR SELECT TO authenticated USING (
    property_id IN (SELECT id FROM public.properties WHERE owner_id = auth.uid())
    OR property_id IN (SELECT property_id FROM public.tenants WHERE user_id = auth.uid())
  );

CREATE POLICY "Owners manage alerts" ON public.alerts
  FOR ALL TO authenticated USING (
    property_id IN (SELECT id FROM public.properties WHERE owner_id = auth.uid())
  ) WITH CHECK (
    property_id IN (SELECT id FROM public.properties WHERE owner_id = auth.uid())
  );

ALTER TABLE public.issue_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view issue messages" ON public.issue_messages
  FOR SELECT TO authenticated USING (
    issue_id IN (
      SELECT mr.id FROM public.maintenance_requests mr
      JOIN public.properties p ON p.id = mr.property_id
      WHERE p.owner_id = auth.uid()
    )
    OR issue_id IN (
      SELECT mr.id FROM public.maintenance_requests mr
      JOIN public.tenants t ON t.id = mr.tenant_id
      WHERE t.user_id = auth.uid()
    )
  );

CREATE POLICY "Users insert issue messages" ON public.issue_messages
  FOR INSERT TO authenticated WITH CHECK (
    sender_id = auth.uid()
    AND (
      issue_id IN (
        SELECT mr.id FROM public.maintenance_requests mr
        JOIN public.properties p ON p.id = mr.property_id
        WHERE p.owner_id = auth.uid()
      )
      OR issue_id IN (
        SELECT mr.id FROM public.maintenance_requests mr
        JOIN public.tenants t ON t.id = mr.tenant_id
        WHERE t.user_id = auth.uid()
      )
    )
  );
