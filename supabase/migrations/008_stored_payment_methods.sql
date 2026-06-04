-- Migration 008: Stored Payment Methods and Auto-Pay Settings
-- Run this in the Supabase SQL editor: https://supabase.com/dashboard/project/olswwdunaivwxefelasc/sql

-- Stored Payment Methods
CREATE TABLE IF NOT EXISTS public.stored_payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('upi', 'card')),
  label text NOT NULL,
  value text NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.stored_payment_methods ENABLE ROW LEVEL SECURITY;

-- Policy to allow users to read/insert/update/delete their own payment methods
CREATE POLICY "Users can manage own payment methods" ON public.stored_payment_methods
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Auto-Pay Settings
CREATE TABLE IF NOT EXISTS public.autopay_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  day int NOT NULL DEFAULT 5 CHECK (day BETWEEN 1 AND 28),
  method_id uuid REFERENCES public.stored_payment_methods(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.autopay_settings ENABLE ROW LEVEL SECURITY;

-- Policy to allow users to manage their own autopay settings
CREATE POLICY "Users can manage own autopay settings" ON public.autopay_settings
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
