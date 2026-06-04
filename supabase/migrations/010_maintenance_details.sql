-- Add new columns for detailed maintenance requests
ALTER TABLE public.maintenance_requests 
ADD COLUMN IF NOT EXISTS location_type TEXT,
ADD COLUMN IF NOT EXISTS location_details TEXT,
ADD COLUMN IF NOT EXISTS category TEXT,
ADD COLUMN IF NOT EXISTS contact_preference TEXT,
ADD COLUMN IF NOT EXISTS has_animal BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS entry_note TEXT,
ADD COLUMN IF NOT EXISTS allow_entry BOOLEAN DEFAULT false;
