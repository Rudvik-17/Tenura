# 🎯 Tenura – Demo Prep & Walkthrough (May 20)

> **Status:** Last updated May 30, 2026
> **For:** Nischal presentation
> **App:** /Users/rudvikdinesh/Developer/Tenura/
> **Screenshots:** /Users/rudvikdinesh/Developer/Tenura/screenshots/

---

## ✅ COMPLETED

- [x] **Seed data** — `supabase/seed/002_seed_data.sql` ready with Rudvik's auth UID (`f613025d-8713-47e7-938b-d370b747db6b`)
- [x] **Full setup SQL** — `supabase/tenura_full_setup.sql` (all 7 migrations + seed in one file)
- [x] **Tenant test setup** — `supabase/setup_test_tenant.sql` with step-by-step instructions
- [x] **RLS policies** — All 9 tables have RLS enabled with appropriate policies
- [x] **App builds** — Verified via `expo export --platform ios` (successful, 3.86 MB bundle)
- [x] **Demo script** — `DEMO_SCRIPT.md` (5-7 min walkthrough)
- [x] **Screenshots** — 10 screenshots in `screenshots/` directory

---

## ⏳ WHAT YOU NEED TO DO

### Step 1: Run the Seed SQL in Supabase (2 min)
```bash
1. Go to https://supabase.com/dashboard/project/olswwdunaivwxefelasc/sql
2. Open and run supabase/tenura_full_setup.sql (everything in one shot)
   OR run migrations individually in order:
     - 001_create_tables.sql
     - 002_seed_data.sql  (skip — it has old placeholder UUIDs)
     - 003_fix_users_rls.sql
     - 004_tenant_auto_link_rls.sql
     - 005_unique_tenant_due_date.sql
     - 006_messages_table.sql
     - 007_property_type_units.sql
   THEN run:
     - supabase/seed/002_seed_data.sql  (the updated one with your actual UUID)
3. Verify: query returns counts for all tables ✅
```

### Step 2: Create a Tenant Test Account (2 min)
**Recommended method (easiest):**
```bash
1. Go to: https://supabase.com/dashboard/project/olswwdunaivwxefelasc/auth/users
2. Click "Add user" → Email: arjun.sharma@example.com, Password: Test@123456
3. The app's auto-linking code will connect this auth user to the seeded tenant row
   when they sign in with matching email.
```
**Alternative:** Follow `supabase/setup_test_tenant.sql` for the SQL approach.

### Step 3: Test the App (10 min)
```bash
1. cd /Users/rudvikdinesh/Developer/Tenura
2. npm start
3. Scan QR with Expo Go on your iPhone
4. Sign in as owner (rudvik.tech@gmail.com)
5. Walk through all owner screens
6. Go to Profile → Switch Role
7. Sign in as tenant (arjun.sharma@example.com / Test@123456)
8. Walk through all tenant screens
```

---

## 🎬 DEMO WALKTHROUGH (5-7 min)

### Flow A: Owner Perspective (~3-4 min)

| # | Screen | What to Show | Talking Point |
|---|---|---|---|
| 1 | **Login** | Sign in with your email | "One app, two experiences — owner and tenant see entirely different UIs from the same codebase" |
| 2 | **Portfolio Dashboard** | Hero, metrics (occupied units, MTD collection), property list | "At a glance — ₹78.3K collected this month, 2 of 120 units occupied at Sterling Heights. Shows the potential: 118 vacant units ready to generate revenue." |
| 3 | **Property Detail** | Tap Sterling Heights → stats strip (120/2/118) → residents, revenue | "Drill into any property. 120 units, 2 occupied, ₹42K avg rent — immediate sense of monthly revenue potential." |
| 4 | **Residents** | Bottom tab → Residents tab → metrics (4 total, 3 active, 1 pending) → search | "Full resident management. 4 tenants across both properties. Add resident FAB ready for onboarding." |
| 5 | **Tenant Detail** | Tap a tenant → lease info, payment history, maintenance issues | "Complete tenant profile — lease terms, payment history with status tracking, linked maintenance requests." |
| 6 | **Finance** | Bottom tab → Finance → transaction ledger with +Rent / -Expense | "Financial dashboard — rent collection ledger, expenses broken down by category. Everything in one place." |
| 7 | **Issues** | Bottom tab → Issues → open/in-progress/resolved maintenance requests | "Maintenance tracking: open a request, assign priority (high=urgent), track resolution progress. In-app messaging for owner-tenant communication." |

### Flow B: Tenant Perspective (~2 min)

| # | Screen | What to Show | Talking Point |
|---|---|---|---|
| 8 | **Tenant Dashboard** | Their rent, property info, upcoming payment | "Same app, completely different view. Tenants only see what's theirs — Supabase RLS enforces this at the database level." |
| 9 | **Rent Payment** | Payment screen → UPI/gpay/PhonePe options | "Pay rent from the app. April and May already paid, June is due. Integration-ready for UPI deep linking." |
| 10 | **Payment History** | Payment history tab with paid/pending/overdue statuses | "Full payment trail — tenants can see their entire payment history." |
| 11 | **Maintenance** | Raise a request → view existing requests with chat | "Raise issues with photos, track resolution progress, chat with owner — all in-app." |
| 12 | **Rental Agreement** | View lease PDF → share/download | "Digital lease agreements. Download, share, store — no more lost paperwork." |

### The Technical Edge (~1 min)

| Area | Detail |
|---|---|
| **Security** | Row Level Security on all 9 tables. Tenants literally cannot see data that isn't theirs. |
| **Auto-linking** | When a tenant signs up, their account is automatically linked to the pre-created tenant row by email match. |
| **Cross-platform** | Expo → single codebase for iOS + Android |
| **Indian-ready** | Crore/lakh formatting, UPI payment methods, Indian property conventions |
| **Scale** | Designed for 1000+ units — search, filter, metrics still performant |

---

## 📁 FILE INVENTORY

| File | Purpose |
|---|---|
| `supabase/tenura_full_setup.sql` | Everything: schema + migrations + seed data (single file, ready to run) |
| `supabase/seed/002_seed_data.sql` | Clean seed with Rudvik's actual UUID (in seed directory) |
| `supabase/seed_demo_data.sql` | Same seed (top-level, for easy copy-paste) |
| `supabase/setup_test_tenant.sql` | Instructions for creating tenant test account |
| `supabase/migrations/001-007.sql` | Individual migration files |
| `DEMO_SCRIPT.md` | Full 5-7 min demo script with talking points |
| `PRESENTATION_PLAN.md` | This file — comprehensive plan |
| `screenshots/*.png` | 10 screenshots of all major screens |

---

## ⚠️ PRE-DEMO CHECKLIST

- [ ] App builds successfully (`npm start` → Expo Go)
- [ ] Seed data loaded (run `tenura_full_setup.sql` in Supabase SQL editor)
- [ ] Tenant test account created (`arjun.sharma@example.com / Test@123456`)
- [ ] Tenant auto-link verified (sign in as tenant, see their data)
- [ ] Expo Go pre-opened once (to cache fonts: Inter, Manrope from Google Fonts)
- [ ] Wi-Fi stable (Expo Go needs LAN connection)
- [ ] Screenshots ready as backup (in case demo fails)
- [ ] Your phone charged 🔋

### Quick Verifications
```sql
-- Run in Supabase SQL editor to confirm seed loaded:
SELECT 'Properties' AS t, count(*) FROM public.properties
UNION ALL SELECT 'Tenants', count(*) FROM public.tenants
UNION ALL SELECT 'Leases', count(*) FROM public.leases
UNION ALL SELECT 'Payments', count(*) FROM public.payments
UNION ALL SELECT 'Maintenance', count(*) FROM public.maintenance_requests
UNION ALL SELECT 'Transactions', count(*) FROM public.transactions;
```

Expected: Properties=2, Tenants=4, Leases=4, Payments=8, Maintenance=4, Transactions=10

---

## 💡 KEY SELLING POINTS

1. **"One app for both"** — Owner and tenant see completely different UIs from the same codebase
2. **"Bank-grade isolation"** — Supabase RLS means tenants can only see their own data
3. **"Indian-first"** — ₹ crore/lakh formatting, UPI payments, Indian naming conventions
4. **"Designed for scale"** — 120-unit properties, search/filter ready, 1000+ units manageable
5. **"Zero paperwork"** — Digital leases, in-app payments, maintenance chat
6. **"Low acquisition cost"** — Tenants get a great app for free; owners pay for the management value
