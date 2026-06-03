-- Issue messages table for in-app owner <-> tenant chat per maintenance issue
-- Run in: https://supabase.com/dashboard/project/olswwdunaivwxefelasc/sql

CREATE TABLE IF NOT EXISTS public.issue_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id uuid NOT NULL REFERENCES public.maintenance_requests(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sender_name text NOT NULL,
  sender_role text NOT NULL CHECK (sender_role IN ('owner', 'tenant')),
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.issue_messages ENABLE ROW LEVEL SECURITY;

-- Owner can read messages for issues on their properties
CREATE POLICY "Owner reads messages for own property issues" ON public.issue_messages
  FOR SELECT USING (
    issue_id IN (
      SELECT mr.id FROM public.maintenance_requests mr
      JOIN public.properties p ON p.id = mr.property_id
      WHERE p.owner_id = auth.uid()
    )
  );

-- Tenant can read messages for issues they created
CREATE POLICY "Tenant reads messages for own issues" ON public.issue_messages
  FOR SELECT USING (
    issue_id IN (
      SELECT mr.id FROM public.maintenance_requests mr
      JOIN public.tenants t ON t.id = mr.tenant_id
      WHERE t.user_id = auth.uid()
    )
  );

-- Owner can send messages on their property issues
CREATE POLICY "Owner sends messages for own property issues" ON public.issue_messages
  FOR INSERT WITH CHECK (
    auth.uid() = sender_id
    AND issue_id IN (
      SELECT mr.id FROM public.maintenance_requests mr
      JOIN public.properties p ON p.id = mr.property_id
      WHERE p.owner_id = auth.uid()
    )
  );

-- Tenant can send messages on their own issues
CREATE POLICY "Tenant sends messages for own issues" ON public.issue_messages
  FOR INSERT WITH CHECK (
    auth.uid() = sender_id
    AND issue_id IN (
      SELECT mr.id FROM public.maintenance_requests mr
      JOIN public.tenants t ON t.id = mr.tenant_id
      WHERE t.user_id = auth.uid()
    )
  );

-- Index for fast per-issue lookups
CREATE INDEX IF NOT EXISTS issue_messages_issue_id_created_at_idx
  ON public.issue_messages (issue_id, created_at DESC);
