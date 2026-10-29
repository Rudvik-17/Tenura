-- =========================================================
-- Migration 026: Security Deposit Management & Move-Out Deductions
-- =========================================================

-- 1. Add security_deposit and deposit status columns to tenants
ALTER TABLE public.tenants
ADD COLUMN IF NOT EXISTS security_deposit numeric(12, 2),
ADD COLUMN IF NOT EXISTS deposit_status text DEFAULT 'pending' CHECK (deposit_status IN ('pending', 'collected', 'refunded')),
ADD COLUMN IF NOT EXISTS deposit_deductions jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS deposit_notes text,
ADD COLUMN IF NOT EXISTS deposit_collected_at timestamptz,
ADD COLUMN IF NOT EXISTS deposit_refunded_at timestamptz;

-- 2. Add security_deposit to leases table as well for formal agreement tracking
ALTER TABLE public.leases
ADD COLUMN IF NOT EXISTS security_deposit numeric(12, 2);

-- 3. Update existing tenants with initial deposits if null
UPDATE public.tenants
SET security_deposit = 30000,
    deposit_status = 'collected',
    deposit_collected_at = NOW()
WHERE security_deposit IS NULL;
