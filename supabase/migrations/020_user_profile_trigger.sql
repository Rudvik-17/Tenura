-- =========================================================
-- Migration 020: User Profile Auto-Sync Trigger & Backfill (Phase 2A)
-- =========================================================

-- Function to handle new user registration in auth.users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, role)
  VALUES (
    new.id,
    new.email,
    COALESCE(new.raw_user_meta_data->>'full_name', ''),
    COALESCE(new.raw_user_meta_data->>'role', 'tenant')
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = CASE 
      WHEN public.users.full_name IS NULL OR public.users.full_name = '' 
      THEN EXCLUDED.full_name 
      ELSE public.users.full_name 
    END;
  RETURN new;
END;
$$;

-- Create trigger on auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Backfill existing public.users records with email and name from auth.users
UPDATE public.users u
SET 
  email = COALESCE(u.email, au.email),
  full_name = CASE 
    WHEN u.full_name IS NULL OR u.full_name = '' 
    THEN COALESCE(au.raw_user_meta_data->>'full_name', split_part(au.email, '@', 1))
    ELSE u.full_name 
  END
FROM auth.users au
WHERE u.id = au.id
  AND (u.email IS NULL OR u.full_name IS NULL OR u.full_name = '');
