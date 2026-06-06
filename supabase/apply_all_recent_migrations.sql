-- =========================================================================
-- ESTATELOGIC - CONSOLIDATED DATABASE MIGRATION FOR ANNOUNCEMENTS & ALERTS
-- Run this in your Supabase SQL Editor:
-- https://supabase.com/dashboard/project/olswwdunaivwxefelasc/sql
-- =========================================================================

-- 1. Create announcements table
CREATE TABLE IF NOT EXISTS public.announcements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id UUID REFERENCES public.properties(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Create alerts table
CREATE TABLE IF NOT EXISTS public.alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id UUID REFERENCES public.properties(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'info', -- 'info', 'warning', 'urgent'
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Add missing columns to public.users for office contacts
ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS email TEXT,
ADD COLUMN IF NOT EXISTS phone TEXT;

-- 4. Add missing columns to maintenance_requests for the wizard form
ALTER TABLE public.maintenance_requests 
ADD COLUMN IF NOT EXISTS location_type TEXT,
ADD COLUMN IF NOT EXISTS location_details TEXT,
ADD COLUMN IF NOT EXISTS category TEXT,
ADD COLUMN IF NOT EXISTS contact_preference TEXT,
ADD COLUMN IF NOT EXISTS has_animal BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS entry_note TEXT,
ADD COLUMN IF NOT EXISTS allow_entry BOOLEAN DEFAULT false;

-- 5. Enable Row-Level Security (RLS)
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;

-- 6. Setup general SELECT policies (accessible to any authenticated users)
CREATE POLICY "Allow select for authenticated users on announcements" ON public.announcements
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow select for authenticated users on alerts" ON public.alerts
    FOR SELECT TO authenticated USING (true);

-- 7. Setup SELECT policy for users table so tenants can read owner contact cards
CREATE POLICY "Allow select for authenticated users on users" ON public.users
    FOR SELECT TO authenticated USING (true);

-- 8. Setup Owner-Specific INSERT & DELETE policies for announcements
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

-- 9. Setup Owner-Specific INSERT & DELETE policies for alerts
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

-- 10. Seed initial community announcements and alerts
DO $$
DECLARE
    demo_prop_id UUID;
BEGIN
    -- Find the demo property "Sterling Heights" or get the first property
    SELECT id INTO demo_prop_id FROM public.properties WHERE name = 'Sterling Heights' LIMIT 1;
    
    IF demo_prop_id IS NULL THEN
        SELECT id INTO demo_prop_id FROM public.properties LIMIT 1;
    END IF;
    
    IF demo_prop_id IS NOT NULL THEN
        -- Seed Announcements
        IF NOT EXISTS (SELECT 1 FROM public.announcements) THEN
            INSERT INTO public.announcements (property_id, title, content, created_at)
            VALUES 
                (demo_prop_id, 'Pool Renovation Schedule', 'The community swimming pool will undergo routine maintenance and renovation starting June 10th. It will be closed for 5 days. We appreciate your cooperation as we improve our amenities.', NOW() - INTERVAL '1 day'),
                (demo_prop_id, 'Annual Fire Safety Inspection', 'Please note that our annual building fire safety and alarm system inspection will take place on June 15th between 9:00 AM and 4:00 PM. Alarms will be tested briefly throughout the day.', NOW() - INTERVAL '3 days'),
                (demo_prop_id, 'New Resident Recycling Guidelines', 'We have updated our recycling guidelines to help reduce contamination. Please ensure cardboard is flattened and no plastic bags are thrown in the blue bins. Check the new guides in the laundry room.', NOW() - INTERVAL '5 days');
        END IF;

        -- Seed Alerts
        IF NOT EXISTS (SELECT 1 FROM public.alerts) THEN
            INSERT INTO public.alerts (property_id, title, content, type, created_at)
            VALUES 
                (demo_prop_id, 'Water Outage Alert', 'Emergency water main repair is scheduled for Block B on June 6th from 1:00 PM to 3:00 PM. Water supply will be temporarily shut off during these hours.', 'urgent', NOW()),
                (demo_prop_id, 'Scheduled Power Maintenance', 'We are conducting electrical grid maintenance on June 8th between 2:00 AM and 4:00 AM. Expect brief power fluctuations during this window.', 'warning', NOW() - INTERVAL '12 hours'),
                (demo_prop_id, 'Elevator Serviced & Restored', 'The elevator in Block A has been fully serviced by engineers and is now back in normal operation. Thank you for your patience.', 'info', NOW() - INTERVAL '1 day');
        END IF;
    END IF;
END $$;
