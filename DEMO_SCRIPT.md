# 🎤 Tenura Demo Walkthrough

## Setup Before Demo
- [ ] Owner account signed up ✅ (rudvik.tech@gmail.com)
- [ ] Seed data loaded via `tenura_full_setup.sql` in Supabase SQL editor
- [ ] Tenant test account created (`arjun.sharma@example.com / Test@123456`)
- [ ] App running via Expo Go → scan QR from `npm start`
- [ ] Expo Go pre-opened once (caches Google Fonts)
- [ ] Demo phone ready (your iPhone)

---

## 🎬 Script (5-7 min)

### 1. Login (30 sec)
- Open app → Login screen appears
- "This is where owners and tenants sign in"
- Enter your credentials → tap Sign In

### 2. Owner Dashboard (1 min)
- **Hero section:** "TENURA" branding, portfolio value
- **Metrics grid:** 2 of 2 units occupied, 78.3K collected MTD, 1 active issue highlighted urgent
- **Properties list:** Sterling Heights (Bangalore, 120 units, 2/120 occupied), Skyline Atrium (Mumbai)
- *Swipe to scroll*

### 3. Property Detail (1 min)
- Tap Sterling Heights
- **Stats strip:** 120 total, 2 occupied, 118 vacant — shows the potential
- **Monthly revenue:** From occupied units
- **Residents list:** Arjun Sharma (Unit 402-B, ₹42K/mo), Priya Nair (Unit 1105-A, ₹43.5K/mo)
- *Tap a resident → Tenant detail screen*

### 4. Resident Data (45 sec)
- Bottom tab → Residents
- **Metrics card:** 4 total, 3 active, 1 pending
- Search bar + filter
- Shows search/A-Z scrolling for large portfolios
- **Add Resident** FAB button

### 5. Finance (45 sec)
- Bottom tab → Finance
- Rent collection ledger
- Transaction history with + and - indicators
- "Everything from one dashboard"

### 6. Issues (30 sec)
- Bottom tab → Issues
- Open/in-progress maintenance requests
- Priority levels (high = urgent)
- Tap to see details + messaging

### 7. Switch to Tenant View (1 min)
- Go to Profile → Switch Role
- Show how tenant sees a totally different dashboard
- Tenant dashboard: their rent, property info, maintenance
- **Key feature:** Rent payment flow
- **Key feature:** Lease agreement → PDF download/share

### 8. The Technical Edge (45 sec)
- Supabase + Row Level Security on all 9 tables = tenants literally cannot see data that isn't theirs
- **Auto-linking magic**: When a tenant signs up with matching email, they're instantly connected to their pre-created tenant row — no manual linking needed
- Expo → cross-platform (iOS + Android from one codebase)
- All UPI methods supported (GPay, PhonePe, PayTM)
- Built-in notifications for maintenance updates

### 9. Close (30 sec)
- "What do you think? Want me to walk through the code or the database schema?"
- Invite questions

---

## 💡 Key Talking Points
- "One app for both roles — owner and tenant see entirely different UIs from the same codebase"
- "Bank-grade security — your data, your tenants' data, completely isolated by Supabase RLS"
- "Real Indian property management — crore/lakh formatting, UPI payment support"
- "Everything is designed for scale — add 1000 units, the dashboard still works"

## ⚠️ Potential Demo Risks
- Expo Go needs internet for fonts → pre-open app once before demo
- Seed data must be loaded before demo (run night before)
- Tenant test account must be created before demo
- Internet connectivity needed for LAN-based Expo Go

## 📸 Screenshots Backup
Screenshots at: /Users/rudvikdinesh/Developer/Tenura/screenshots/
(10 screenshots covering all major screens)
