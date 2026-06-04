-- Tenura Schema
-- Run this in the Supabase SQL editor: https://supabase.com/dashboard/project/olswwdunaivwxefelasc/sql

-- Users table extension (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'tenant' CHECK (role IN ('owner', 'tenant')),
  full_name text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own row" ON public.users FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own row" ON public.users FOR UPDATE USING (auth.uid() = id);

-- Properties
CREATE TABLE IF NOT EXISTS public.properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  address text NOT NULL,
  city text NOT NULL,
  total_units int NOT NULL DEFAULT 1,
  avg_rent numeric(12, 2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners manage their properties" ON public.properties
  USING (auth.uid() = owner_id);

-- Tenants
CREATE TABLE IF NOT EXISTS public.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  owner_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  unit_number text NOT NULL,
  email text,
  phone text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending', 'exiting')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners manage their tenants" ON public.tenants
  USING (auth.uid() = owner_id);
CREATE POLICY "Tenants view own record" ON public.tenants FOR SELECT
  USING (auth.uid() = user_id);

-- Leases
CREATE TABLE IF NOT EXISTS public.leases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  start_date date NOT NULL,
  end_date date NOT NULL,
  monthly_rent numeric(12, 2) NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'pending_signature')),
  signed_at timestamptz,
  document_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.leases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner accesses leases for own properties" ON public.leases
  USING (
    property_id IN (SELECT id FROM public.properties WHERE owner_id = auth.uid())
  );
CREATE POLICY "Tenant views own lease" ON public.leases FOR SELECT
  USING (
    tenant_id IN (SELECT id FROM public.tenants WHERE user_id = auth.uid())
  );

-- Payments
CREATE TABLE IF NOT EXISTS public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  lease_id uuid NOT NULL REFERENCES public.leases(id) ON DELETE CASCADE,
  amount numeric(12, 2) NOT NULL,
  due_date date NOT NULL,
  paid_at timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'overdue')),
  payment_method text CHECK (payment_method IN ('gpay', 'phonepe', 'paytm')),
  transaction_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner views payments for own tenants" ON public.payments
  USING (
    tenant_id IN (SELECT id FROM public.tenants WHERE owner_id = auth.uid())
  );
CREATE POLICY "Tenant views own payments" ON public.payments FOR SELECT
  USING (
    tenant_id IN (SELECT id FROM public.tenants WHERE user_id = auth.uid())
  );
CREATE POLICY "Tenant inserts own payments" ON public.payments FOR INSERT
  WITH CHECK (
    tenant_id IN (SELECT id FROM public.tenants WHERE user_id = auth.uid())
  );
CREATE POLICY "Tenant updates own payments" ON public.payments FOR UPDATE
  USING (
    tenant_id IN (SELECT id FROM public.tenants WHERE user_id = auth.uid())
  );

-- Maintenance Requests
CREATE TABLE IF NOT EXISTS public.maintenance_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  subject text NOT NULL,
  details text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved')),
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  case_number text NOT NULL,
  resolution_progress int NOT NULL DEFAULT 0 CHECK (resolution_progress BETWEEN 0 AND 100),
  scheduled_visit timestamptz,
  location_type text,
  location_details text,
  category text,
  contact_preference text,
  has_animal boolean DEFAULT false,
  entry_note text,
  allow_entry boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.maintenance_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner views maintenance for own properties" ON public.maintenance_requests
  USING (
    property_id IN (SELECT id FROM public.properties WHERE owner_id = auth.uid())
  );
CREATE POLICY "Tenant manages own requests" ON public.maintenance_requests
  USING (
    tenant_id IN (SELECT id FROM public.tenants WHERE user_id = auth.uid())
  );

-- Transactions (financial ledger for owner)
CREATE TABLE IF NOT EXISTS public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('rent', 'expense', 'maintenance_cost')),
  category text NOT NULL,
  amount numeric(12, 2) NOT NULL,
  description text NOT NULL,
  date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner views own property transactions" ON public.transactions
  USING (
    property_id IN (SELECT id FROM public.properties WHERE owner_id = auth.uid())
  );


-- =============================================
-- MIGRATION 003: Fix RLS insert policy
-- =============================================

-- Fix: add INSERT policy to users table so new users can create their own row.
-- The original migration (001) only added SELECT and UPDATE policies.
-- Run this in the Supabase SQL editor if you already ran 001_create_tables.sql.

CREATE POLICY "Users can insert own row" ON public.users
  FOR INSERT WITH CHECK (auth.uid() = id);


-- =============================================
-- MIGRATION 004: Tenant auto-link RLS
-- =============================================

-- Tenant auto-linking policies
-- Allow a newly-registered user to find and claim their own unlinked tenant row
-- by matching auth.email() before user_id has been set.
--
-- Run in the Supabase SQL editor:
-- https://supabase.com/dashboard/project/olswwdunaivwxefelasc/sql

-- SELECT: let authenticated user read rows that were pre-created with their email
-- but haven't been linked yet (user_id IS NULL).
-- The existing "Tenants view own record" policy already covers linked rows.
CREATE POLICY "Tenants can find unlinked row by email"
  ON public.tenants
  FOR SELECT
  USING (
    email = auth.email()
    AND user_id IS NULL
  );

-- UPDATE: let authenticated user claim the unlinked row by setting user_id.
-- USING  — matches rows the user is allowed to update (their email, not yet linked).
-- WITH CHECK — ensures user_id can only be set to auth.uid() (prevents spoofing).
CREATE POLICY "Tenants can claim unlinked row by email"
  ON public.tenants
  FOR UPDATE
  USING (
    email = auth.email()
    AND user_id IS NULL
  )
  WITH CHECK (
    user_id = auth.uid()
  );


-- =============================================
-- MIGRATION 005: Unique tenant due date
-- =============================================

ALTER TABLE payments
  ADD CONSTRAINT unique_tenant_due_date UNIQUE (tenant_id, due_date);


-- =============================================
-- MIGRATION 006: Issue messages table
-- =============================================

-- Issue messages table for in-app owner <-> tenant chat per maintenance issue
-- Run in: https://supabase.com/dashboard/project/olswwdunaivwxefelasc/sql

CREATE TABLE IF NOT EXISTS public.issue_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id uuid NOT NULL REFERENCES public.maintenance_requests(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sender_name text NOT NULL,
  sender_role text NOT NULL CHECK (sender_role IN ('owner', 'tenant')),
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.issue_messages ENABLE ROW LEVEL SECURITY;

-- Owner can read messages for issues on their properties
CREATE POLICY "Owner reads messages for own property issues" ON public.issue_messages
  FOR SELECT USING (
    issue_id IN (
      SELECT mr.id FROM public.maintenance_requests mr
      JOIN public.properties p ON p.id = mr.property_id
      WHERE p.owner_id = auth.uid()
    )
  );

-- Tenant can read messages for issues they created
CREATE POLICY "Tenant reads messages for own issues" ON public.issue_messages
  FOR SELECT USING (
    issue_id IN (
      SELECT mr.id FROM public.maintenance_requests mr
      JOIN public.tenants t ON t.id = mr.tenant_id
      WHERE t.user_id = auth.uid()
    )
  );

-- Owner can send messages on their property issues
CREATE POLICY "Owner sends messages for own property issues" ON public.issue_messages
  FOR INSERT WITH CHECK (
    auth.uid() = sender_id
    AND issue_id IN (
      SELECT mr.id FROM public.maintenance_requests mr
      JOIN public.properties p ON p.id = mr.property_id
      WHERE p.owner_id = auth.uid()
    )
  );

-- Tenant can send messages on their own issues
CREATE POLICY "Tenant sends messages for own issues" ON public.issue_messages
  FOR INSERT WITH CHECK (
    auth.uid() = sender_id
    AND issue_id IN (
      SELECT mr.id FROM public.maintenance_requests mr
      JOIN public.tenants t ON t.id = mr.tenant_id
      WHERE t.user_id = auth.uid()
    )
  );

-- Index for fast per-issue lookups
CREATE INDEX IF NOT EXISTS issue_messages_issue_id_created_at_idx
  ON public.issue_messages (issue_id, created_at DESC);


-- =============================================
-- MIGRATION 007: Property type & units
-- =============================================

-- Run in: https://supabase.com/dashboard/project/olswwdunaivwxefelasc/sql

-- 1. Add property_type to the existing properties table
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS property_type text NOT NULL DEFAULT 'apartment'
  CHECK (property_type IN ('apartment', 'house', 'villa', 'commercial'));

-- 2. Units table — one row per physical unit in a property
CREATE TABLE IF NOT EXISTS public.units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  unit_number text NOT NULL,
  status text NOT NULL DEFAULT 'vacant' CHECK (status IN ('vacant', 'occupied')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, unit_number)
);

ALTER TABLE public.units ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner manages their units" ON public.units
  USING (
    property_id IN (
      SELECT id FROM public.properties WHERE owner_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS units_property_id_idx ON public.units (property_id);


-- =============================================
-- SEED DATA (for demo - May 20)
-- =============================================

-- =========================================================
-- Tenura ✦ Demo Data Seed
-- =========================================================
-- RUN THIS IN SUPABASE SQL EDITOR:
-- Dashboard → olswwdunaivwxefelasc → SQL Editor
-- =========================================================

-- ⚠️ STEP 0: Replace '<YOUR_AUTH_UID>' with your actual auth user ID
-- Find it at: Supabase Dashboard → Authentication → Users → 
-- Click your email (rudvik.tech@gmail.com) → copy the UUID
-- =========================================================

DO $$
DECLARE
  owner_uid uuid := 'f613025d-8713-47e7-938b-d370b747db6b';
  prop1_id uuid := gen_random_uuid();
  prop2_id uuid := gen_random_uuid();
  tenant1_id uuid := gen_random_uuid();
  tenant2_id uuid := gen_random_uuid();
  tenant3_id uuid := gen_random_uuid();
  tenant4_id uuid := gen_random_uuid();
  lease1_id uuid := gen_random_uuid();
  lease2_id uuid := gen_random_uuid();
  lease3_id uuid := gen_random_uuid();
  lease4_id uuid := gen_random_uuid();
BEGIN

  -- === SET OWNER ROLE ===
  INSERT INTO public.users (id, role, full_name)
  VALUES (owner_uid, 'owner', 'Rudvik Dinesh')
  ON CONFLICT (id) DO UPDATE 
  SET role = 'owner', full_name = 'Rudvik Dinesh';

  -- === PROPERTIES ===
  INSERT INTO public.properties (id, owner_id, name, address, city, total_units, avg_rent) VALUES
    (prop1_id, owner_uid, 'The Sterling Heights', 'Whitefield Main Road, Whitefield', 'Bangalore', 120, 42000),
    (prop2_id, owner_uid, 'Skyline Atrium', 'Bandra Kurla Complex', 'Mumbai', 45, 35275);

  -- === TENANTS ===
  INSERT INTO public.tenants (id, user_id, owner_id, property_id, full_name, unit_number, email, phone, status) VALUES
    (tenant1_id, NULL, owner_uid, prop1_id, 'Arjun Sharma', '402-B', 'arjun.sharma@example.com', '+91 98765 43210', 'active'),
    (tenant2_id, NULL, owner_uid, prop1_id, 'Priya Nair', '1105-A', 'priya.nair@example.com', '+91 87654 32109', 'active'),
    (tenant3_id, NULL, owner_uid, prop2_id, 'Rahul Mehta', '201-C', 'rahul.mehta@example.com', '+91 76543 21098', 'active'),
    (tenant4_id, NULL, owner_uid, prop2_id, 'Sneha Iyer', '304-D', 'sneha.iyer@example.com', '+91 65432 10987', 'pending');

  -- === LEASES ===
  INSERT INTO public.leases (id, tenant_id, property_id, start_date, end_date, monthly_rent, status, signed_at) VALUES
    (lease1_id, tenant1_id, prop1_id, '2025-10-01', '2026-09-30', 42000, 'active', '2025-09-28 14:30:00+05:30'),
    (lease2_id, tenant2_id, prop1_id, '2025-08-01', '2026-07-31', 43500, 'active', '2025-07-25 11:00:00+05:30'),
    (lease3_id, tenant3_id, prop2_id, '2025-09-01', '2026-08-31', 35275, 'active', '2025-08-29 10:00:00+05:30'),
    (lease4_id, tenant4_id, prop2_id, '2026-01-01', '2026-12-31', 38000, 'pending_signature', NULL);

  -- === PAYMENTS (2 months history + 1 pending) ===
  INSERT INTO public.payments (tenant_id, lease_id, amount, due_date, paid_at, status, payment_method, transaction_id) VALUES
    -- Arjun (Sterling Heights, 402-B) — 42K/mo — April paid, May paid, June pending
    (tenant1_id, lease1_id, 42000, '2026-04-05', '2026-04-03 10:45:00+05:30', 'paid', 'gpay', 'TXN9842034821'),
    (tenant1_id, lease1_id, 42000, '2026-05-05', '2026-05-02 09:30:00+05:30', 'paid', 'phonepe', 'TXN8731924632'),
    (tenant1_id, lease1_id, 42000, '2026-06-05', NULL, 'pending', NULL, NULL),
    -- Priya (Sterling Heights, 1105-A) — 43.5K/mo
    (tenant2_id, lease2_id, 43500, '2026-04-05', '2026-04-04 11:20:00+05:30', 'paid', 'gpay', 'TXN7621813543'),
    (tenant2_id, lease2_id, 43500, '2026-05-05', '2026-05-01 08:15:00+05:30', 'paid', 'gpay', 'TXN6512702454'),
    (tenant2_id, lease2_id, 43500, '2026-06-05', NULL, 'pending', NULL, NULL),
    -- Rahul (Skyline Atrium, 201-C) — 35.3K/mo — April paid, May overdue!
    (tenant3_id, lease3_id, 35275, '2026-04-05', '2026-04-05 16:00:00+05:30', 'paid', 'paytm', 'TXN5403691365'),
    (tenant3_id, lease3_id, 35275, '2026-05-05', NULL, 'overdue', NULL, NULL);

  -- === MAINTENANCE REQUESTS ===
  INSERT INTO public.maintenance_requests (tenant_id, property_id, subject, details, status, priority, case_number, resolution_progress, scheduled_visit) VALUES
    (tenant1_id, prop1_id, 'Leaky Faucet - Kitchen', 'Kitchen faucet dripping continuously for 2 days, water damage near sink cabinet.', 'in_progress', 'medium', 'TN-4902', 65, NOW() + INTERVAL '1 day'),
    (tenant2_id, prop1_id, 'AC not working', 'Split AC in master bedroom stopped cooling. Unit turns on but blows warm air.', 'in_progress', 'high', 'ISS-8831', 40, NOW() + INTERVAL '3 hours'),
    (tenant3_id, prop2_id, 'Door Lock Issue', 'Digital PIN lock on main door intermittently fails to recognize registered PIN codes.', 'open', 'medium', 'ISS-8911', 0, NULL),
    (tenant1_id, prop1_id, 'Hallway Light Flickering', 'Corridor light outside Unit 402-B has been flickering for a week.', 'resolved', 'low', 'ISS-8720', 100, NULL);

  -- === TRANSACTIONS (financial ledger) ===
  INSERT INTO public.transactions (property_id, type, category, amount, description, date) VALUES
    -- Sterling Heights - April
    (prop1_id, 'rent', 'residential', 42000, 'Rent - Arjun Sharma - Unit 402-B', '2026-04-03'),
    (prop1_id, 'rent', 'residential', 43500, 'Rent - Priya Nair - Unit 1105-A', '2026-04-04'),
    (prop1_id, 'expense', 'maintenance', 12500, 'Plumbing repair - common area pipes', '2026-04-10'),
    (prop1_id, 'expense', 'staff', 45000, 'Security & housekeeping - April', '2026-04-30'),
    -- Skyline Atrium - April
    (prop2_id, 'rent', 'residential', 35275, 'Rent - Rahul Mehta - Unit 201-C', '2026-04-05'),
    (prop2_id, 'expense', 'utilities', 28000, 'Common area electricity - April', '2026-04-30'),
    (prop2_id, 'expense', 'maintenance', 8750, 'Elevator maintenance - quarterly', '2026-04-15'),
    -- Sterling Heights - May
    (prop1_id, 'rent', 'residential', 42000, 'Rent - Arjun Sharma - Unit 402-B', '2026-05-02'),
    (prop1_id, 'rent', 'residential', 43500, 'Rent - Priya Nair - Unit 1105-A', '2026-05-01'),
    -- Skyline Atrium - May
    (prop2_id, 'rent', 'residential', 35275, 'Rent - Rahul Mehta - Unit 201-C', '2026-05-03');

END $$;

-- =============================================
-- MIGRATION 008: Stored Payment Methods & Auto-Pay Settings
-- =============================================

-- Stored Payment Methods
CREATE TABLE IF NOT EXISTS public.stored_payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('upi', 'card')),
  label text NOT NULL,
  value text NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.stored_payment_methods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own payment methods" ON public.stored_payment_methods
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Auto-Pay Settings
CREATE TABLE IF NOT EXISTS public.autopay_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  day int NOT NULL DEFAULT 5 CHECK (day BETWEEN 1 AND 28),
  method_id uuid REFERENCES public.stored_payment_methods(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.autopay_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own autopay settings" ON public.autopay_settings
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- =============================================
-- MIGRATION 009: Community Announcements & Alerts
-- =============================================

CREATE TABLE IF NOT EXISTS public.announcements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id UUID REFERENCES public.properties(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id UUID REFERENCES public.properties(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'info',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow select for authenticated users on announcements" ON public.announcements
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow select for authenticated users on alerts" ON public.alerts
    FOR SELECT TO authenticated USING (true);

-- Seeding community data
DO $$
DECLARE
    demo_prop_id UUID;
BEGIN
    SELECT id INTO demo_prop_id FROM public.properties WHERE name = 'Sterling Heights' LIMIT 1;
    IF demo_prop_id IS NULL THEN
        SELECT id INTO demo_prop_id FROM public.properties LIMIT 1;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM public.announcements) THEN
        INSERT INTO public.announcements (property_id, title, content, created_at)
        VALUES 
            (demo_prop_id, 'Pool Renovation Schedule', 'The community swimming pool will undergo routine maintenance and renovation starting June 10th. It will be closed for 5 days. We appreciate your cooperation as we improve our amenities.', NOW() - INTERVAL '1 day'),
            (demo_prop_id, 'Annual Fire Safety Inspection', 'Please note that our annual building fire safety and alarm system inspection will take place on June 15th between 9:00 AM and 4:00 PM. Alarms will be tested briefly throughout the day.', NOW() - INTERVAL '3 days'),
            (demo_prop_id, 'New Resident Recycling Guidelines', 'We have updated our recycling guidelines to help reduce contamination. Please ensure cardboard is flattened and no plastic bags are thrown in the blue bins. Check the new guides in the laundry room.', NOW() - INTERVAL '5 days');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.alerts) THEN
        INSERT INTO public.alerts (property_id, title, content, type, created_at)
        VALUES 
            (demo_prop_id, 'Water Outage Alert', 'Emergency water main repair is scheduled for Block B on June 6th from 1:00 PM to 3:00 PM. Water supply will be temporarily shut off during these hours.', 'urgent', NOW()),
            (demo_prop_id, 'Scheduled Power Maintenance', 'We are conducting electrical grid maintenance on June 8th between 2:00 AM and 4:00 AM. Expect brief power fluctuations during this window.', 'warning', NOW() - INTERVAL '12 hours'),
            (demo_prop_id, 'Elevator Serviced & Restored', 'The elevator in Block A has been fully serviced by engineers and is now back in normal operation. Thank you for your patience.', 'info', NOW() - INTERVAL '1 day');
    END IF;
END $$;


-- =========================================================
-- VERIFY RLS POLICIES ARE IN PLACE
-- =========================================================
SELECT tablename, policyname, permissive, cmd, qual 
FROM pg_policies 
WHERE schemaname = 'public' 
ORDER BY tablename;
