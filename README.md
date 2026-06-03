# 🏛️ Tenura

<p align="center">
  <b>Precision-crafted property management.</b><br>
  A modern, double-sided mobile application built for landlords and tenants.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React%20Native-0.81-61DAFB?logo=react&logoColor=black&style=for-the-badge" alt="React Native">
  <img src="https://img.shields.io/badge/Expo-54-000020?logo=expo&logoColor=white&style=for-the-badge" alt="Expo">
  <img src="https://img.shields.io/badge/Supabase-Backend-3ECF8E?logo=supabase&logoColor=white&style=for-the-badge" alt="Supabase">
  <img src="https://img.shields.io/badge/Database-PostgreSQL-4169E1?logo=postgresql&logoColor=white&style=for-the-badge" alt="Postgres">
</p>

---

## 💎 Design System & Philosophy

Tenura is built on **"The Precision Atelier"** design system — featuring sleek typography, custom spacing tokens, subtle gradients, and dark-mode elegance. The application offers a streamlined, zero-friction interface tailored for fast operations.

### 🎭 Two Roles, One Codebase
The application dynamically routes the user to either the **Owner** or **Tenant** interface based on their authenticated role in Supabase. Complete data isolation is maintained via **Row Level Security (RLS)**.

```mermaid
graph TD
    User([App User]) -->|Login / Auth| Auth{Auth State / Role}
    Auth -->|Owner Role| OwnerNav[Owner Navigation Flow]
    Auth -->|Tenant Role| TenantNav[Tenant Navigation Flow]
    
    OwnerNav --> OwnerDash[Portfolio Dashboard]
    OwnerNav --> Properties[Property & Unit Setup]
    OwnerNav --> Tenants[Tenant Management]
    OwnerNav --> OwnerIssues[Issue Tracker & Chat]
    
    TenantNav --> TenantDash[Lease & Due Status]
    TenantNav --> Payments[UPI Payment Integration]
    TenantNav --> TenantIssues[Maintenance Requests & Chat]
    
    OwnerIssues <-->|Supabase Realtime| TenantIssues
    
    subgraph Supabase [Backend Database & Security]
        DB[(PostgreSQL Database)]
        RLS[Row Level Security]
        DB --- RLS
    end
    
    OwnerNav & TenantNav -->|Secured API Queries| RLS
```

---

## ⚡ Features Matrix

| Feature | Owner Experience | Tenant Experience |
| :--- | :--- | :--- |
| **Dashboard** | 📊 Portfolio metrics, Occupancy, MTD Collections | 🏠 Current Rent status, Due dates, Landlord profile |
| **Finance** | 💰 Full rent ledger, Transaction history log | 💳 Instant UPI payment (Google Pay, PhonePe, Paytm) |
| **Maintenance** | 🔧 Priority-level request tracker | 🛠️ Issue submission & progress tracking |
| **Communication** | 💬 Real-time chat per issue with tenant | 💬 Real-time chat per issue with landlord |
| **Documents** | 📄 Onboard tenants, define lease duration | 📄 Instant view & share of lease PDF |

---

## 🛠️ Tech Stack & Architecture

* **Frontend Framework:** React Native with Expo (SDK 54)
* **Navigation Architecture:** React Navigation 7 (Unified Native Stack & Bottom Tab bars)
* **Backend Database:** Supabase (Postgres, Row Level Security, Real-time WebSockets)
* **PDF Engine:** `expo-print` & `expo-sharing` (generates legal lease documents and digital receipts on the fly)

### 📂 Directory Structure

```
Tenura/
├── src/
│   ├── context/    – Auth state & active user role context
│   ├── navigation/ – Stack + Bottom Tab navigators for each role flow
│   ├── screens/    – Auth, Owner, Tenant, and Shared screens
│   ├── components/ – Atoms & Molecules (MetricCard, CustomButtons, Header)
│   ├── lib/        – Supabase clients & receipt/lease PDF engines
│   └── theme/      – Typography, spacing, and brand color design tokens
└── supabase/
    ├── migrations/ – Table schemas, database indexes, and RLS policies
    └── seed/       – Production-grade demo data for immediate testing
```

---

## 🚀 Running Locally

Follow these quick steps to launch the local Expo development server:

<details>
<summary><b>1. Install Dependencies</b> (Click to expand)</summary>

```bash
npm install
```
</details>

<details>
<summary><b>2. Start Metro Bundler</b> (Click to expand)</summary>

```bash
# Start standard Expo server
npm start

# Or target specific platforms directly
npm run ios        # For iOS simulator
npm run android    # For Android emulator
```
</details>

---

## 🔒 Database & Security Policies

Tenura enforces strict **Row Level Security (RLS)** at the PostgreSQL layer. Data queries cannot bypass validation:

* **Properties:** Managed solely by the authenticated Owner.
* **Tenants:** Linked to properties, mapped to Auth users for self-claiming onboarding.
* **Leases:** Access is double-gated by Owner and Tenant IDs.
* **Payments & Ledger:** Only readable/writable by users belonging to the corresponding lease.
* **Issue Messages:** Structured chat messages linked directly to a maintenance ticket. Uses PostgreSQL real-time listeners for instant updates.
