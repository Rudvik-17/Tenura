-- =========================================================
-- Migration 024: Storage Bucket Security & Table RLS Fixes (Phase 3)
-- =========================================================

-- =========================================================
-- 1. Storage Buckets: Harden Visibility
-- =========================================================

-- Ensure all 4 buckets exist
INSERT INTO storage.buckets (id, name, public)
VALUES 
  ('maintenance-photos', 'maintenance-photos', false),
  ('leases', 'leases', false),
  ('avatars', 'avatars', true),
  ('properties', 'properties', true)
ON CONFLICT (id) DO UPDATE SET 
  public = EXCLUDED.public;

-- Make sure leases bucket is strictly private (protects legal signatures & PII)
UPDATE storage.buckets SET public = false WHERE id = 'leases';
UPDATE storage.buckets SET public = false WHERE id = 'maintenance-photos';
UPDATE storage.buckets SET public = true WHERE id = 'avatars';
UPDATE storage.buckets SET public = true WHERE id = 'properties';

-- =========================================================
-- 2. Storage Policies: Clean Up Old Overly Permissive Policies
-- =========================================================

DROP POLICY IF EXISTS "Auth Manage avatars" ON storage.objects;
DROP POLICY IF EXISTS "Auth Manage properties" ON storage.objects;
DROP POLICY IF EXISTS "Public Access avatars" ON storage.objects;
DROP POLICY IF EXISTS "Public Access properties" ON storage.objects;
DROP POLICY IF EXISTS "Tenants upload maintenance photos" ON storage.objects;
DROP POLICY IF EXISTS "Users view maintenance photos" ON storage.objects;
DROP POLICY IF EXISTS "Owners and tenants view own lease documents" ON storage.objects;
DROP POLICY IF EXISTS "Tenants upload own maintenance photos" ON storage.objects;
DROP POLICY IF EXISTS "Owners and tenants view maintenance photos" ON storage.objects;
DROP POLICY IF EXISTS "Users upload own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users update own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users delete own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Owners manage property photos" ON storage.objects;

-- =========================================================
-- 3. Storage Policies: Avatars Bucket
-- =========================================================

-- Anyone can view avatars (public profile icons)
CREATE POLICY "Public Access avatars" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'avatars');

-- Authenticated users can only upload their own avatar
CREATE POLICY "Users upload own avatar" ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR name LIKE auth.uid()::text || '%'
    )
  );

-- Authenticated users can update only their own avatar
CREATE POLICY "Users update own avatar" ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR name LIKE auth.uid()::text || '%'
    )
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR name LIKE auth.uid()::text || '%'
    )
  );

-- Authenticated users can delete only their own avatar
CREATE POLICY "Users delete own avatar" ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR name LIKE auth.uid()::text || '%'
    )
  );

-- =========================================================
-- 4. Storage Policies: Properties Bucket
-- =========================================================

-- Anyone can view property images (listings, resident portal)
CREATE POLICY "Public Access properties" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'properties');

-- Only verified owners can upload/modify photos for properties they own
CREATE POLICY "Owners manage property photos" ON storage.objects
  FOR ALL
  TO authenticated
  USING (
    bucket_id = 'properties'
    AND EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.owner_id = auth.uid()
        AND (
          (storage.foldername(name))[1] = p.id::text
          OR name LIKE p.id::text || '%'
        )
    )
  )
  WITH CHECK (
    bucket_id = 'properties'
    AND EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.owner_id = auth.uid()
        AND (
          (storage.foldername(name))[1] = p.id::text
          OR name LIKE p.id::text || '%'
        )
    )
  );

-- =========================================================
-- 5. Storage Policies: Maintenance Photos Bucket (Private)
-- =========================================================

-- Tenants can upload photos scoped to their tenant or user ID
CREATE POLICY "Tenants upload own maintenance photos" ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'maintenance-photos'
    AND (
      (storage.foldername(name))[1] IN (
        SELECT id::text FROM public.tenants WHERE user_id = auth.uid()
      )
      OR (storage.foldername(name))[1] = auth.uid()::text
    )
  );

-- Tenants see their own photos; Owners see photos for their properties/tenants
CREATE POLICY "Owners and tenants view maintenance photos" ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'maintenance-photos'
    AND (
      -- Tenant who uploaded it
      (storage.foldername(name))[1] IN (
        SELECT id::text FROM public.tenants WHERE user_id = auth.uid()
      )
      OR (storage.foldername(name))[1] = auth.uid()::text
      -- Owner of the tenant
      OR EXISTS (
        SELECT 1 FROM public.tenants t
        WHERE t.owner_id = auth.uid()
          AND (storage.foldername(name))[1] = t.id::text
      )
      -- Owner of the property associated with the maintenance request
      OR EXISTS (
        SELECT 1 FROM public.maintenance_requests mr
        JOIN public.properties p ON p.id = mr.property_id
        WHERE p.owner_id = auth.uid()
          AND (
            mr.photo_url LIKE '%' || name || '%'
            OR (storage.foldername(name))[1] = mr.tenant_id::text
          )
      )
    )
  );

-- =========================================================
-- 6. Storage Policies: Leases Bucket (Private Legal Documents)
-- =========================================================

-- Scoped access: only the tenant on the lease or the property owner can read lease PDFs
CREATE POLICY "Owners and tenants view own lease documents" ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'leases'
    AND (
      -- Tenant viewing their own lease document
      EXISTS (
        SELECT 1 FROM public.leases l
        JOIN public.tenants t ON t.id = l.tenant_id
        WHERE t.user_id = auth.uid()
          AND (
            name = (l.docusign_envelope_id || '.pdf')
            OR name LIKE (l.id::text || '%')
            OR name LIKE (t.id::text || '%')
            OR position(name in l.document_url) > 0
          )
      )
      -- Owner viewing a lease document for their property
      OR EXISTS (
        SELECT 1 FROM public.leases l
        JOIN public.properties p ON p.id = l.property_id
        WHERE p.owner_id = auth.uid()
          AND (
            name = (l.docusign_envelope_id || '.pdf')
            OR name LIKE (l.id::text || '%')
            OR name LIKE (l.tenant_id::text || '%')
            OR position(name in l.document_url) > 0
          )
      )
    )
  );

-- =========================================================
-- 7. Table RLS Enhancements: Maintenance Requests
-- =========================================================

-- Ensure owners can manage requests by property_id OR tenant_id
DROP POLICY IF EXISTS "Owners manage maintenance requests" ON public.maintenance_requests;

CREATE POLICY "Owners manage maintenance requests" ON public.maintenance_requests
  FOR ALL
  TO authenticated
  USING (
    property_id IN (SELECT id FROM public.properties WHERE owner_id = auth.uid())
    OR tenant_id IN (SELECT id FROM public.tenants WHERE owner_id = auth.uid())
  )
  WITH CHECK (
    property_id IN (SELECT id FROM public.properties WHERE owner_id = auth.uid())
    OR tenant_id IN (SELECT id FROM public.tenants WHERE owner_id = auth.uid())
  );

-- =========================================================
-- 8. Table RLS: Drop Legacy Unused Messages Table
-- =========================================================

-- The app uses issue_messages; the legacy empty messages table is removed to eliminate attack surface
DROP TABLE IF EXISTS public.messages CASCADE;
