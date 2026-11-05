-- =========================================================
-- Migration 023: Unique Maintenance Case Sequence & Photo URL (Phase 2D & 2E)
-- =========================================================

-- Create sequence starting at 5000 for realistic, unique case numbers
CREATE SEQUENCE IF NOT EXISTS public.maintenance_case_seq START WITH 5000;

-- Set default case_number using the sequence
ALTER TABLE public.maintenance_requests
  ALTER COLUMN case_number SET DEFAULT ('EL-' || nextval('public.maintenance_case_seq')::text);

-- Add unique constraint on case_number to guarantee uniqueness
ALTER TABLE public.maintenance_requests
  DROP CONSTRAINT IF EXISTS maintenance_requests_case_number_key;

ALTER TABLE public.maintenance_requests
  ADD CONSTRAINT maintenance_requests_case_number_key UNIQUE (case_number);

-- Add photo_url column to maintenance_requests table
ALTER TABLE public.maintenance_requests
  ADD COLUMN IF NOT EXISTS photo_url text;
