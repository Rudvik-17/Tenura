-- Tenura ✦ Demo Seed Data
-- =========================================================
-- Run AFTER migrations have been applied.
-- Run this in the Supabase SQL editor:
-- https://supabase.com/dashboard/project/olswwdunaivwxefelasc/sql
-- =========================================================
-- This seed uses Rudvik's auth user ID.
-- If this UUID changes, update owner_uid below.
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
    -- Arjun (Sterling Heights, 402-B) — 42K/mo
    (tenant1_id, lease1_id, 42000, '2026-04-05', '2026-04-03 10:45:00+05:30', 'paid', 'gpay', 'TXN9842034821'),
    (tenant1_id, lease1_id, 42000, '2026-05-05', '2026-05-02 09:30:00+05:30', 'paid', 'phonepe', 'TXN8731924632'),
    (tenant1_id, lease1_id, 42000, '2026-06-05', NULL, 'pending', NULL, NULL),
    -- Priya (Sterling Heights, 1105-A) — 43.5K/mo
    (tenant2_id, lease2_id, 43500, '2026-04-05', '2026-04-04 11:20:00+05:30', 'paid', 'gpay', 'TXN7621813543'),
    (tenant2_id, lease2_id, 43500, '2026-05-05', '2026-05-01 08:15:00+05:30', 'paid', 'gpay', 'TXN6512702454'),
    (tenant2_id, lease2_id, 43500, '2026-06-05', NULL, 'pending', NULL, NULL),
    -- Rahul (Skyline Atrium, 201-C) — 35.3K/mo — April paid, May overdue!
    (tenant3_id, lease3_id, 35275, '2026-04-05', '2026-04-05 16:00:00+05:30', 'paid', 'paytm', 'TXN5403691365'),
    (tenant3_id, lease3_id, 35275, '2026-06-05', NULL, 'overdue', NULL, NULL);

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

-- =========================================================
-- VERIFY SEED
-- =========================================================
SELECT 'Owner set:' AS check, id, role, full_name FROM public.users WHERE id = 'f613025d-8713-47e7-938b-d370b747db6b';
SELECT 'Properties:' AS check, count(*) AS count FROM public.properties;
SELECT 'Tenants:' AS check, count(*) AS count FROM public.tenants;
SELECT 'Leases:' AS check, count(*) AS count FROM public.leases;
SELECT 'Payments:' AS check, count(*) AS count FROM public.payments;
SELECT 'Maintenance requests:' AS check, count(*) AS count FROM public.maintenance_requests;
SELECT 'Transactions:' AS check, count(*) AS count FROM public.transactions;
