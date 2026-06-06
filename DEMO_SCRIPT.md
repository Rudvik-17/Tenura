# EstateLogic (Tenura) — Demo Walkthrough Script

**Last updated:** June 6, 2026  
**App name (codebase):** Tenura  
**Marketing name:** EstateLogic  
**Duration:** ~7-10 minutes

---

## 🧩 Setup Checklist (Before Demo)

Before running the demo, ensure:

- [ ] **Migrations applied** — All 10 migration files in `supabase/migrations/` run in Supabase SQL editor
- [ ] **Seed data loaded** — `supabase/seed/002_seed_data.sql` run with **your actual auth user UUID** replacing `f613025d-8713-47e7-938b-d370b747db6b`
- [ ] **Owner account exists** — You have signed into the app with `rudvik.tech@gmail.com` and set your role to **Owner**
- [ ] **Tenant test accounts** — At least one tenant seeded (e.g., `arjun.sharma@example.com`) has a corresponding auth user created with auto-link
- [ ] **App dependencies installed** — `npm install` done
- [ ] **App running** — `npx expo start` launches successfully

### How to Get Your Auth User ID
1. Go to [Supabase Dashboard → Authentication → Users](https://supabase.com/dashboard/project/olswwdunaivwxefelasc/auth/users)
2. Find your email (`rudvik.tech@gmail.com`) — copy the UUID
3. Replace `f613025d-8713-47e7-938b-d370b747db6b` in `002_seed_data.sql` with this UUID
4. Run the seed SQL in the Supabase SQL editor

### How to Create Tenant Test Accounts
1. Go to [Supabase Dashboard → Authentication → Users](https://supabase.com/dashboard/project/olswwdunaivwxefelasc/auth/users)
2. Click "Invite user" / "Add user"
3. Use email from seeded tenants (e.g., `arjun.sharma@example.com`)
4. Set password (e.g., `Test@123456`)
5. The app's auto-link code in `AuthContext.js` will link them automatically
6. Or disable "Confirm email" in Auth settings for demo/development

---

## 🎬 Demo Script

### Block 1: Login & Auth (1 min)

1. Open the EstateLogic (Tenura) app
2. **Enter credentials** → email: `rudvik.tech@gmail.com`, password: `[your password]`
3. After login, **Role Selection** screen appears:
   - → Select **"Property Owner"**
4. App navigates to **Owner Dashboard**

**🎯 Talking point:** *"Auth is live. Supabase handles email verification, RLS enforces that I only see my data. First-time role selection creates my profile in the users table."*

---

### Block 2: Owner Dashboard — Portfolio Tab (1.5 min)

**This is the main view — the Portfolio tab:**

- **Metrics at the top:** Properties count, Total tenants, Active leases, Rent due this month
- **Recent properties card:** Shows property cards with name, city, unit count, avg rent
- **Recent transactions:** Last 10 financial entries (rent received + expenses)

**🎯 Talking point:** *"All numbers come from live Supabase queries. No hardcoded values. The dashboard is the command center — I can see my portfolio at a glance, drill in, or add a new property."*

👉 Tap a property card → **Property Detail Screen**

**Property Detail shows:**
- Property name, address, city, type (apartment/house/villa/commercial)
- Total units, average rent
- Active tenants listed with unit numbers
- Edit option (pencil icon top-right)

**🎯 Talking point:** *"This is a real property in Bangalore — The Sterling Heights in Whitefield. The data flows from Supabase through RLS policies that chain through my owner ID."*

👉 Navigate back to dashboard

---

### Block 3: Residents Tab (1.5 min)

👉 Tap **Residents** tab

**Resident Data list shows:**
- All tenants across all properties
- Filter/search by name
- Status chips: Active / Pending / Exiting

👉 Tap a tenant → **Tenant Detail Screen**

**Tenant Detail shows:**
- Full name, unit, email, phone
- Lease status (active/pending)
- Payment history for this tenant
- Edit and Delete options

**🎯 Talking point:** *"Tenants can be pre-seeded with their email. When they sign up for the first time, the app auto-links their auth account to this tenant row — no manual work needed."*

👉 Tap **"Onboard Tenant"** button (top-right) → **Tenant Onboarding screen** (multi-step form)

**Onboarding flow:**
- Step 1: Tenant Info (name, email, phone)
- Step 2: Property & Unit (select property, unit number)
- Step 3: Lease Details (start/end date, monthly rent)
- Step 4: Review & Submit

**🎯 Talking point:** *"Adding a tenant is a wizard — 4 steps. It creates the tenant record, sets up the lease, and optionally creates an auth account for them. Full validation on every field."*

👉 Navigate back

---

### Block 4: Finance Tab (1.5 min)

👉 Tap **Finance** tab

**Finance Overview shows:**
- Rent collected (MTD — month to date)
- Total expenses
- Pending rent amounts
- Revenue vs expense breakdown by property

👉 Tap **"Rent Collection"** → **Rent Collection Screen**

**Rent Collection shows:**
- Tenants grouped by property
- Each tenant shows: name, unit, due amount, status (paid/pending/overdue)
- Action buttons for each pending tenant

**🎯 Talking point:** *"The finance tab is the real moneymaker. I can see exactly who's paid, who's overdue, and what's coming in. The data comes from payments joined through tenants — we never query payments directly because there's no owner_id column. Every payment routes through the tenant's owner for RLS."*

---

### Block 5: Issues Tab (1 min)

👉 Tap **Issues** tab

**Resident Issues shows:**
- All maintenance requests across properties
- Filter by priority (All / High / Medium / Low)
- Stats cards: Open, In Progress, Resolved
- Each issue shows: subject, status, priority, case number

👉 Tap an issue → **Issue Messages** (chat thread)

**Issue Messages shows:**
- Chat interface between owner and tenant per issue
- Real-time updates via Supabase Realtime subscriptions
- Message history with sender role labels

**🎯 Talking point:** *"Every maintenance request becomes a thread. The owner and tenant can chat in real-time through Supabase Realtime subscriptions. No more WhatsApp — it's all tracked in the app."*

---

### Block 6: Tenant Portal (Optional — if tenant accounts are set up) (1 min)

Sign out → sign in as tenant (`arjun.sharma@example.com` / `Test@123456`)

**Tenant Dashboard:**
- Shows: Lease status, rent due, due date
- Owner info (name, contact)
- Active maintenance requests

**Payments Tab:**
- Payment history
- Pay Rent → Select UPI method → Payment flow
- Success screen with PDF receipt generation

**Maintenance Tab:**
- Raise a new issue
- Track existing request progress
- Chat with owner

**Community Tab:**
- Announcements from owner
- Community features (if enabled)

**🎯 Talking point:** *"The tenant side is clean and focused. They see their lease, their payments, their issues. Nothing more, nothing less. The UPI payment flow is set up — just needs Razorpay wired in for production."*

---

### Block 7: What's Left + Next Steps (1 min)

| Feature | Status | Details |
|---------|--------|---------|
| Auth (email, RLS, role selection) | ✅ Done | Production-ready |
| Properties CRUD | ✅ Done | Add, edit, delete, list, detail |
| Tenant Onboarding | ✅ Done | 4-step wizard, auto-link |
| Lease Management | ✅ Done | Create, view, status tracking |
| Maintenance + Chat | ✅ Done | Issue creation, real-time chat, priority tracking |
| Finance Overview | ✅ Done | Revenue, expenses, MTD collections |
| Rent Collection | ✅ Done | Per-tenant view, UPI flow UI |
| Payment History | ✅ Done | Screen exists, data linked |
| PDF Receipts | ✅ Done | Lease agreement + payment receipts generated on-device |
| **Razorpay Integration** | ⬜ Not started | SDK setup, payment initiation, webhook handling |
| **Push Notifications** | ⬜ Not started | Expo Notifications, rent reminders, payment confirmations |
| **Tenant Auth Accounts** | ⬜ Manual setup needed | Need to create auth users for seeded tenants |

**🎯 Ask:** *"The app is 80% done. What's left are the two most impactful features: payments and notifications. I'd love your help specifically on the Razorpay integration — even 2 hours to get the flow wired up would be huge."*

---

## 🚨 Known Issues / Gotchas

1. **Seed SQL requires your auth user UUID** — Replace `f613025d-8713-47e7-938b-d370b747db6b` in `002_seed_data.sql` with your actual UUID
2. **Tenant test accounts** — Created via Supabase Auth dashboard (or signup with auto-link), not via seed SQL
3. **Email confirmation** — If Supabase has email confirmation enabled, test accounts won't be able to sign in until confirmed
4. **RentPaymentScreen** — Pay Rent button shows UPI flow UI but needs Razorpay SDK integration for real payment processing
5. **Payment History Screen** — Screen exists and queries data, but needs verification with seeded data

## 📁 Key Files Reference

| File | Purpose |
|------|---------|
| `src/lib/supabase.js` | Supabase client with anon key |
| `src/context/AuthContext.js` | Auth state, role, auto-link, fetchRole |
| `src/navigation/RootNavigator.js` | Auth gate → role gate → navigator |
| `src/navigation/OwnerNavigator.js` | 5-tab bottom nav for owners |
| `src/navigation/TenantNavigator.js` | 5-tab bottom nav for tenants |
| `supabase/migrations/001_create_tables.sql` | Core schema (7 tables, RLS) |
| `supabase/seed/002_seed_data.sql` | Demo seed data |
| `supabase/migrations/003-010_*.sql` | Additional features & fixes |
| `supabase/setup_test_tenant.sql` | Instructions for creating tenant accounts |
