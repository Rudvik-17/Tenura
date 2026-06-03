# Tenura

**Architectural Trust. Defined.**

A React Native + Expo property management app for owners and tenants. Built with Supabase (Postgres + Auth + RLS).

## Tech Stack

- **Frontend:** React Native 0.81 + Expo 54
- **Navigation:** React Navigation 7 (Stack + Bottom Tabs)
- **Backend:** Supabase (Postgres, Auth, Row Level Security)
- **Design:** "The Precision Atelier" – custom theme, Manrope/Inter fonts, MaterialIcons
- **PDF:** expo-print + expo-sharing for lease agreements

## Features

### Owner
- Dashboard with portfolio metrics (occupancy, MTD collection, active/urgent issues, expiring leases)
- Property management (add/edit/delete properties, multi-step form with review)
- Resident management (add tenants, search, view leases, track status)
- Finance overview (rent collection ledger, transactions)
- Issue tracking (maintenance requests with messaging)
- Tenant onboarding (invite tenants, set up leases)

### Tenant
- Dashboard with lease overview, rent due status, property info
- Rent payment flow
- Maintenance request submission
- Rental agreement PDF download & share
- Payment history

## How It Works

1. **Owner** creates property profiles (apartment, house, villa, commercial)
2. **Owner** adds tenants and sets up lease terms
3. **Tenant** receives access to their account
4. **Built-in onboarding** – tenant is auto-linked to their unit when they sign up with matching email
5. **Everything in one place** – rent, maintenance, lease docs, transaction history

## Running Locally

```bash
npm install
npm start          # Expo dev server (scan QR with Expo Go)
npm run ios        # iOS simulator
npm run android    # Android emulator
```

## Architecture

```
src/
  context/    – Auth state (user, role, session management)
  navigation/ – Stack + Tab navigators for Owner and Tenant flows
  screens/    – auth/, owner/, tenant/, shared/
  components/ – Reusable UI (MetricCard, StatusChip, PrimaryButton, etc.)
  lib/        – Supabase client, HTML templates for lease/receipt PDFs
  theme/      – Colors, typography, spacing design tokens
supabase/
  migrations/ – Database schema, seed data, RLS policies
```

## Database

- **properties** – owned by users with role='owner'
- **tenants** – linked to properties, optionally linked to auth users
- **leases** – rental terms per tenant
- **payments** – rent payments, linked to owners via tenant join
- **transactions** – financial ledger entries
- **maintenance_requests** – issue tracking with priority levels
- **users** – extends auth.users with role field
