# EstateLogic — Presentation Plan

**Purpose:** Technical demo to a developer (Rudvik's brother) covering the stack, current state, and what's left to build.  
**Goal:** Get help with Razorpay payment integration and push notifications.  
**Target audience:** Developer — skip fluff, focus on tech architecture + demo.

---

## 🎯 Presentation Flow (7-10 min)

### 1. Context (60 seconds)
- What is EstateLogic? → Property management for Indian landlords with 1-10 units
- Problem: WhatsApp/cash management has zero accountability
- Solution: React Native + Supabase app with owner and tenant portals

### 2. Live Demo (5-7 min) — See DEMO_SCRIPT.md for full script
Walk through app in order:
1. **Owner Login → Role Selection** — auth is real, not mock
2. **Dashboard** — live Supabase metrics, property cards, recent transactions
3. **Portfolio → Property Detail** — first property (The Sterling Heights)
4. **Residents → Tenant Detail** — tenant profile, lease, payment history
5. **Onboard Tenant** — show the 4-step wizard (don't save, just show)
6. **Finance** — revenue vs expenses, rent collection, overdue tracking
7. **Issues** — maintenance requests with real-time chat
8. *(Optional)* **Tenant Portal** — sign in as tenant, show their view

### 3. Tech Stack Deep Dive (2 min)
- React Native + Expo ~54 — one codebase, iOS + Android
- Supabase — PostgreSQL + RLS (all production-ready)
- Auth: email verification, auto tenant linking, role-based navigation
- Payments pattern: always through tenant join, never direct query
- Migration: 10 migration files applied

### 4. What's Left + The Ask (1-2 min)
| Feature | Status | Why it matters |
|---------|--------|---------------|
| Razorpay SDK | ⬜ Not started | Real payment processing |
| Push notifications | ⬜ Not started | Rent reminders + confirmations |
| Everything else | ✅ Done | Auth, CRUD, finance, chat, PDFs |

**Ask:** Help specifically with the Razorpay integration

---

## 📋 Pre-Demo Checklist

- [ ] All 10 migrations applied in Supabase SQL editor
- [ ] Seed data loaded with correct auth user UUID
- [ ] Owner signed in with `rudvik.tech@gmail.com` and role set to Owner
- [ ] At least one tenant test account created (e.g., `arjun.sharma@example.com`)
- [ ] App running via `npx expo start`
- [ ] Supabase dashboard open on browser (for showing DB tables/RLS if needed)
- [ ] CLAUDE.md or Developer Brief doc ready to share

---

## ⚠️ What NOT to Demo

- ❌ Don't tap Pay Rent → Razorpay not wired up yet
- ❌ Don't open Payment History unless data is seeded
- ❌ Don't delete any seeded data accidentally
- ❌ Don't spend time on features that aren't complete

---

## 📂 Context Files to Share

| File | Why |
|------|-----|
| `CLAUDE.md` | Architecture, patterns, rules — developer documentation |
| `supabase/seed/002_seed_data.sql` | Schema + data patterns reference |
| `src/context/AuthContext.js` | Auth flow + auto-link logic |
| EstateLogic Developer Brief (docx) | Overview document for contributors |

## 🔍 Key Technical Points to Emphasize

1. **RLS is real** — Every table has RLS, owners only see their properties
2. **Payments are never direct** — Always via `payments, tenants!inner(owner_id)` join
3. **Auto-link** — Tenant signs up → matching email → auto-linked to owner's data
4. **Real data** — No mock data in production screens, everything hits Supabase
5. **10 migrations** — Schema evolved properly with backward compatibility
