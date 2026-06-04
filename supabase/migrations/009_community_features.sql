-- Create announcements table
CREATE TABLE IF NOT EXISTS public.announcements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id UUID REFERENCES public.properties(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create alerts table
CREATE TABLE IF NOT EXISTS public.alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id UUID REFERENCES public.properties(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'info', -- 'info', 'warning', 'urgent'
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;

-- Select policies (accessible to any authenticated users)
CREATE POLICY "Allow select for authenticated users on announcements" ON public.announcements
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow select for authenticated users on alerts" ON public.alerts
    FOR SELECT TO authenticated USING (true);

-- Insert seed data associated with the demo property
DO $$
DECLARE
    demo_prop_id UUID;
BEGIN
    -- Try to find the demo property "Sterling Heights" or get the first property
    SELECT id INTO demo_prop_id FROM public.properties WHERE name = 'Sterling Heights' LIMIT 1;
    
    IF demo_prop_id IS NULL THEN
        SELECT id INTO demo_prop_id FROM public.properties LIMIT 1;
    END IF;
    
    -- Insert demo announcements
    IF NOT EXISTS (SELECT 1 FROM public.announcements) THEN
        INSERT INTO public.announcements (property_id, title, content, created_at)
        VALUES 
            (demo_prop_id, 'Pool Renovation Schedule', 'The community swimming pool will undergo routine maintenance and renovation starting June 10th. It will be closed for 5 days. We appreciate your cooperation as we improve our amenities.', NOW() - INTERVAL '1 day'),
            (demo_prop_id, 'Annual Fire Safety Inspection', 'Please note that our annual building fire safety and alarm system inspection will take place on June 15th between 9:00 AM and 4:00 PM. Alarms will be tested briefly throughout the day.', NOW() - INTERVAL '3 days'),
            (demo_prop_id, 'New Resident Recycling Guidelines', 'We have updated our recycling guidelines to help reduce contamination. Please ensure cardboard is flattened and no plastic bags are thrown in the blue bins. Check the new guides in the laundry room.', NOW() - INTERVAL '5 days');
    END IF;

    -- Insert demo alerts
    IF NOT EXISTS (SELECT 1 FROM public.alerts) THEN
        INSERT INTO public.alerts (property_id, title, content, type, created_at)
        VALUES 
            (demo_prop_id, 'Water Outage Alert', 'Emergency water main repair is scheduled for Block B on June 6th from 1:00 PM to 3:00 PM. Water supply will be temporarily shut off during these hours.', 'urgent', NOW()),
            (demo_prop_id, 'Scheduled Power Maintenance', 'We are conducting electrical grid maintenance on June 8th between 2:00 AM and 4:00 AM. Expect brief power fluctuations during this window.', 'warning', NOW() - INTERVAL '12 hours'),
            (demo_prop_id, 'Elevator Serviced & Restored', 'The elevator in Block A has been fully serviced by engineers and is now back in normal operation. Thank you for your patience.', 'info', NOW() - INTERVAL '1 day');
    END IF;
END $$;
