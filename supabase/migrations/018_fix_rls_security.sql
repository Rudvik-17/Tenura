-- Migration: 018_fix_rls_security.sql
-- Fix overly permissive RLS SELECT policies on users, announcements, alerts, issue_messages.
-- These tables previously used USING (true) which leaked data across tenants/owners.

-- =============================================
-- 1. Fix public.users — scope to own row + related owner/tenant profiles
-- =============================================
DROP POLICY IF EXISTS "Allow select for authenticated users on users" ON public.users;

CREATE POLICY "Allow select for authenticated users on users" ON public.users
  FOR SELECT TO authenticated USING (
    id = auth.uid()
    OR id IN (SELECT owner_id FROM public.tenants WHERE user_id = auth.uid())
    OR id IN (SELECT user_id FROM public.tenants WHERE owner_id = auth.uid() AND user_id IS NOT NULL)
  );

-- =============================================
-- 2. Fix public.announcements — scope to own property
-- =============================================
DROP POLICY IF EXISTS "Allow select on announcements" ON public.announcements;
DROP POLICY IF EXISTS "Allow select for authenticated users on announcements" ON public.announcements;

CREATE POLICY "Allow select on announcements" ON public.announcements
  FOR SELECT TO authenticated USING (
    property_id IN (SELECT id FROM public.properties WHERE owner_id = auth.uid())
    OR property_id IN (SELECT property_id FROM public.tenants WHERE user_id = auth.uid())
  );

-- =============================================
-- 3. Fix public.alerts — scope to own property
-- =============================================
DROP POLICY IF EXISTS "Allow select on alerts" ON public.alerts;
DROP POLICY IF EXISTS "Allow select for authenticated users on alerts" ON public.alerts;

CREATE POLICY "Allow select on alerts" ON public.alerts
  FOR SELECT TO authenticated USING (
    property_id IN (SELECT id FROM public.properties WHERE owner_id = auth.uid())
    OR property_id IN (SELECT property_id FROM public.tenants WHERE user_id = auth.uid())
  );

-- =============================================
-- 4. Fix public.issue_messages SELECT — scope to own property issues
-- =============================================
DROP POLICY IF EXISTS "Users view issue messages" ON public.issue_messages;

CREATE POLICY "Users view issue messages" ON public.issue_messages
  FOR SELECT TO authenticated USING (
    issue_id IN (
      SELECT mr.id FROM public.maintenance_requests mr
      JOIN public.properties p ON p.id = mr.property_id
      WHERE p.owner_id = auth.uid()
    )
    OR issue_id IN (
      SELECT mr.id FROM public.maintenance_requests mr
      JOIN public.tenants t ON t.id = mr.tenant_id
      WHERE t.user_id = auth.uid()
    )
  );

-- =============================================
-- 5. Fix public.issue_messages INSERT — require issue belongs to user
-- =============================================
DROP POLICY IF EXISTS "Users insert issue messages" ON public.issue_messages;

CREATE POLICY "Users insert issue messages" ON public.issue_messages
  FOR INSERT TO authenticated WITH CHECK (
    sender_id = auth.uid()
    AND (
      issue_id IN (
        SELECT mr.id FROM public.maintenance_requests mr
        JOIN public.properties p ON p.id = mr.property_id
        WHERE p.owner_id = auth.uid()
      )
      OR issue_id IN (
        SELECT mr.id FROM public.maintenance_requests mr
        JOIN public.tenants t ON t.id = mr.tenant_id
        WHERE t.user_id = auth.uid()
      )
    )
  );

-- =============================================
-- 6. Create maintenance-photos storage bucket
-- =============================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('maintenance-photos', 'maintenance-photos', false)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload maintenance photos
DROP POLICY IF EXISTS "Tenants upload maintenance photos" ON storage.objects;
CREATE POLICY "Tenants upload maintenance photos" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'maintenance-photos'
  );

-- Allow authenticated users to view maintenance photos
DROP POLICY IF EXISTS "Users view maintenance photos" ON storage.objects;
CREATE POLICY "Users view maintenance photos" ON storage.objects
  FOR SELECT TO authenticated USING (
    bucket_id = 'maintenance-photos'
  );
