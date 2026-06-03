-- =========================================================
-- Tenant Test Account Setup
-- =========================================================
-- This script does TWO things:
--   1. Creates a test auth user in Supabase Auth
--   2. Links them to one of the seeded tenant rows
--
-- ⚠️ IMPORTANT: Before running this, first run 002_seed_data.sql
-- =========================================================

-- === OPTION A: Create via Supabase Dashboard (recommended) ===
-- 1. Go to: https://supabase.com/dashboard/project/olswwdunaivwxefelasc/auth/users
-- 2. Click "Invite user" or "Add user"
-- 3. Email: arjun.sharma@example.com
-- 4. Password: Test@123456 (or whatever you choose)
-- 5. Click "Create user"
-- 6. When you sign into the app with these credentials,
--    the auto-linking code in AuthContext.js will automatically
--    link this user to the existing tenant row (Arjun Sharma, Unit 402-B).
-- 7. ✅ Done - no SQL needed for the link!

-- === OPTION B: Create via SQL (for convenience) ===
-- This will:
--   a) Create the auth user directly
--   b) Link the tenant row

-- ⚠️ You need the service_role key for this!
-- Get it from: Supabase Dashboard → Project Settings → API → service_role key

-- WARNING: This is a Supabase auth function - requires service_role key, NOT anon key

-- Step 1: Create auth user
-- Run in Supabase SQL editor:
SELECT supabase_auth.create_user(
  email := 'arjun.sharma@example.com',
  password := 'Test@123456',
  email_confirm := true
);

-- Step 2: Find the created user's ID
-- SELECT id, email FROM auth.users WHERE email = 'arjun.sharma@example.com';

-- Step 3: Link the tenant row to this auth user
-- UPDATE public.tenants 
-- SET user_id = '<UUID_FROM_STEP_2>', status = 'active'
-- WHERE email = 'arjun.sharma@example.com' AND user_id IS NULL;

-- Step 4: Set their role to 'tenant' in the users table
-- INSERT INTO public.users (id, role, full_name)
-- VALUES ('<UUID_FROM_STEP_2>', 'tenant', 'Arjun Sharma');


-- =========================================================
-- ALTERNATIVE: Manual tenant account creation
-- =========================================================
-- If the tenant didn't exist in seed data, you'd:
-- 1. Create a tenant row with user_id set from the start
-- 2. Or let the app's auto-link handle it on sign-up
-- 
-- The auto-linking works like this:
-- User signs up → app checks if any tenant row has matching email
-- and user_id IS NULL → app sets user_id = auth_user.id, status = 'active'
-- That's it!

-- =========================================================
-- VERIFY AFTER SETUP
-- =========================================================
-- Check linked tenants:
-- SELECT t.id, t.full_name, t.email, t.unit_number, t.user_id, u.email as auth_email
-- FROM public.tenants t
-- LEFT JOIN auth.users u ON u.id = t.user_id
-- WHERE t.user_id IS NOT NULL;
