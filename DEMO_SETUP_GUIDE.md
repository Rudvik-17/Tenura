# EstateLogic — Demo Setup Guide

**Last updated:** June 6, 2026

This guide covers the manual steps you need to do on the Supabase dashboard to get the demo ready. I've done everything I can programmatically — these are the pieces that require your Supabase dashboard access.

---

## Step 1: Clone the Project

The project is at: `github.com/Rudvik-17/Estate-Logic`

```bash
# Clone fresh
git clone https://github.com/Rudvik-17/Estate-Logic.git
cd Estate-Logic
npm install
```

---

## Step 2: Apply Database Migrations

Open: [Supabase SQL Editor](https://supabase.com/dashboard/project/olswwdunaivwxefelasc/sql)

Run these migration files **in order**:
1. `supabase/migrations/001_create_tables.sql` — Core schema (7 tables + RLS)
2. `supabase/migrations/003_fix_users_rls.sql` — INSERT policy for users table
3. `supabase/migrations/004_tenant_auto_link_rls.sql` — Tenant auto-link policies
4. `supabase/migrations/005_unique_tenant_due_date.sql` — Unique constraint on payments
5. `supabase/migrations/006_messages_table.sql` — Issue messages + RLS
6. `supabase/migrations/007_property_type_units.sql` — Property type + units table
7. `supabase/migrations/008_stored_payment_methods.sql` — Stored payment methods + auto-pay
8. `supabase/migrations/009_community_features.sql` — Announcements + alerts
9. `supabase/migrations/010_maintenance_details.sql` — Maintenance request detail columns

---

## Step 3: Get Your Auth User UUID

1. Go to [Supabase Dashboard → Authentication → Users](https://supabase.com/dashboard/project/olswwdunaivwxefelasc/auth/users)
2. Find `rudvik.tech@gmail.com` in the list
3. Click the row — copy the **UUID** (the long string like `f613025d-...`)
4. Copy this UUID somewhere — you'll need it for the seed SQL

> ⚠️ If `rudvik.tech@gmail.com` is NOT listed as a user, you need to:
> 1. Sign up in the app first (or use the Supabase Add User button)
> 2. Then come back here to copy the UUID

---

## Step 4: Seed Demo Data

Open: [Supabase SQL Editor](https://supabase.com/dashboard/project/olswwdunaivwxefelasc/sql)

Copy the entire contents of `supabase/seed/002_seed_data.sql` into the SQL editor.

**⚠️ IMPORTANT:** Before running, find this line:
```sql
owner_uid uuid := 'f613025d-8713-47e7-938b-d370b747db6b';
```
And replace `f613025d-8713-47e7-938b-d370b747db6b` with **your actual auth user UUID** from Step 3.

Then click **Run**. The seed creates:
- 2 properties (Sterling Heights, Skyline Atrium)
- 4 tenants (Arjun, Priya, Rahul, Sneha)
- 4 leases (3 active, 1 pending)
- 8 payments (some paid, some pending, 1 overdue)
- 4 maintenance requests (different priorities)
- 10 financial transactions

---

## Step 5: Create Tenant Test Account(s)

After seed data is loaded, create auth accounts for tenants so you can demo the tenant portal:

**Option A: Best for demo** — Disable email confirmation:
1. Go to [Authentication → Settings](https://supabase.com/dashboard/project/olswwdunaivwxefelasc/auth/settings)
2. Toggle **"Confirm email"** OFF
3. Then create tenant users via Sign Up API / SQL

**Option B: Create via dashboard:**
1. [Auth → Users → Add User](https://supabase.com/dashboard/project/olswwdunaivwxefelasc/auth/users)
2. Email: `arjun.sharma@example.com`
3. Password: `Test@123456`
4. Click Create — they'll get the confirmation email (check spam)

**Option C: If you need the service_role key (from API Settings):**
Run this in SQL editor:
```sql
-- Create auth user
SELECT supabase_auth.create_user(
  email := 'arjun.sharma@example.com',
  password := 'Test@123456',
  email_confirm := true
);
```

The auto-link in the app will automatically connect this auth account to the existing tenant row.

**Create additional test accounts** if you want to show multiple tenants:
- `priya.nair@example.com` / `Test@123456`
- `rahul.mehta@example.com` / `Test@123456`

---

## Step 6: Run the App

```bash
npm start
# or
npx expo start
```

Scan the QR code with Expo Go on your phone, or press `i` for iOS simulator.

---

## Step 7: Sign In & Set Role

1. Sign in with `rudvik.tech@gmail.com`
2. On Role Selection screen → tap **Property Owner**
3. Dashboard loads with your seeded data

---

## Step 8: Verify Everything Works

Check these flows:
- [ ] Dashboard — Property count, tenant count, rent due are non-zero
- [ ] Properties — Tap a property → detail screen loads
- [ ] Residents — Tap a tenant → detail screen loads with payment history
- [ ] Finance — Revenue and expense numbers are correct
- [ ] Issues — Maintenance requests are visible, tap one → chat works
- [ ] Tenant login — `arjun.sharma@example.com` → sees their lease, payment pending

---

## What I've Created

| Item | Path | Description |
|------|------|-------------|
| ✅ Demo Script | `DEMO_SCRIPT.md` | Full walkthrough with talking points |
| ✅ Presentation Plan | `PRESENTATION_PLAN.md` | High-level presentation flow |
| ✅ This Guide | `DEMO_SETUP_GUIDE.md` | Step-by-step setup instructions |
| ✅ Seed SQL | `supabase/seed/002_seed_data.sql` | Ready to run (needs your UUID) |
| ✅ Setup SQL | `supabase/setup_test_tenant.sql` | Tenant account setup instructions |
| ✅ Migration Files | `supabase/migrations/001-010*.sql` | Full schema evolution |
| ✅ Developer Brief | *(existing)* EstateLogic_Developer_Brief.docx | Architecture overview |
| ✅ Walkthrough Script | *(existing)* EstateLogic_Walkthrough_Script.docx | Original walkthrough |

---

## 🚨 Troubleshooting

**"Invalid login credentials"**
→ You haven't created the auth user yet, or password is wrong

**"Email not confirmed"**
→ Need to confirm via email, or disable confirmation in Auth settings

**"Relation 'public.properties' does not exist"**
→ Migrations not run yet — run `001_create_tables.sql` first

**"Dashboard shows 0 for everything"**
→ Seed data not loaded, or wrong auth UUID in seed SQL

**App crashes on startup**
→ `npm install` first, check for Expo Go compatibility issues
