-- Migration 011: Owner Community RLS Policies and User Profile Columns
-- Add missing email and phone columns to users table
ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS email TEXT,
ADD COLUMN IF NOT EXISTS phone TEXT;

-- Policy to allow authenticated users to read user profiles (needed for tenants to view owner contact card)
-- Note: If "Users can read own row" exists, this policy expands select permissions for all authenticated users.
CREATE POLICY "Allow select for authenticated users on users" ON public.users
    FOR SELECT TO authenticated
    USING (true);

-- Allow owners to insert and delete announcements for their properties
CREATE POLICY "Allow insert for owners on announcements" ON public.announcements
    FOR INSERT TO authenticated
    WITH CHECK (
        property_id IN (SELECT id FROM public.properties WHERE owner_id = auth.uid())
    );

CREATE POLICY "Allow delete for owners on announcements" ON public.announcements
    FOR DELETE TO authenticated
    USING (
        property_id IN (SELECT id FROM public.properties WHERE owner_id = auth.uid())
    );

-- Allow owners to insert and delete alerts for their properties
CREATE POLICY "Allow insert for owners on alerts" ON public.alerts
    FOR INSERT TO authenticated
    WITH CHECK (
        property_id IN (SELECT id FROM public.properties WHERE owner_id = auth.uid())
    );

CREATE POLICY "Allow delete for owners on alerts" ON public.alerts
    FOR DELETE TO authenticated
    USING (
        property_id IN (SELECT id FROM public.properties WHERE owner_id = auth.uid())
    );
