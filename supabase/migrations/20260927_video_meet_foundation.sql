UPDATE public.profiles
SET
  full_name = COALESCE(full_name, "full name"),
  "full name" = COALESCE("full name", full_name),
  avatar_url = COALESCE(avatar_url, "avatar url"),
  "avatar url" = COALESCE("avatar url", avatar_url),
  created_at = COALESCE(created_at, "created at"),
  "created at" = COALESCE("created at", created_at);

UPDATE public.profiles
SET age = NULL
WHERE age IS NOT NULL
  AND (age < 18 OR age > 100);

UPDATE public.profiles
SET gender = NULL
WHERE gender IS NOT NULL
  AND gender NOT IN ('male', 'female');

UPDATE public.profiles
SET username = NULL
WHERE username IS NOT NULL
  AND username !~ '^[A-Za-z0-9_]{3,24}$';

UPDATE public.video_queue
SET status = 'waiting'
WHERE status IS NULL
   OR status NOT IN ('waiting', 'matched');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_age_range'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_age_range
      CHECK (age IS NULL OR (age >= 18 AND age <= 100));
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_gender_values'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_gender_values
      CHECK (gender IS NULL OR gender IN ('male', 'female'));
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_username_format'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_username_format
      CHECK (username IS NULL OR username ~ '^[A-Za-z0-9_]{3,24}$');
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'video_queue_status_values'
      AND conrelid = 'public.video_queue'::regclass
  ) THEN
    ALTER TABLE public.video_queue
      ADD CONSTRAINT video_queue_status_values
      CHECK (status IN ('waiting', 'matched'));
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE username IS NOT NULL
    GROUP BY lower(username)
    HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_lower_uidx
      ON public.profiles (lower(username))
      WHERE username IS NOT NULL;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.sync_profile_columns()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.id := OLD.id;
    NEW.created_at := COALESCE(OLD.created_at, OLD."created at", NEW.created_at, now());
    NEW."created at" := NEW.created_at;
  ELSE
    NEW.created_at := COALESCE(NEW.created_at, NEW."created at", now());
    NEW."created at" := NEW.created_at;
  END IF;

  NEW.full_name := NULLIF(btrim(COALESCE(NEW.full_name, NEW."full name")), '');
  NEW."full name" := NEW.full_name;

  NEW.avatar_url := NULLIF(btrim(COALESCE(NEW.avatar_url, NEW."avatar url")), '');
  NEW."avatar url" := NEW.avatar_url;

  NEW.username := NULLIF(btrim(NEW.username), '');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_sync_columns ON public.profiles;
CREATE TRIGGER profiles_sync_columns
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_profile_columns();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
  v_avatar text;
BEGIN
  v_name := NULLIF(btrim(COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name')), '');
  v_avatar := NULLIF(btrim(COALESCE(NEW.raw_user_meta_data->>'avatar_url', NEW.raw_user_meta_data->>'picture')), '');

  INSERT INTO public.profiles (
    id,
    username,
    full_name,
    avatar_url,
    "full name",
    "avatar url",
    created_at,
    "created at"
  )
  VALUES (
    NEW.id,
    NULL,
    v_name,
    v_avatar,
    v_name,
    v_avatar,
    now(),
    now()
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_matching_profiles()
RETURNS TABLE (
  id uuid,
  username text,
  full_name text,
  avatar_url text,
  age integer,
  gender text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.username,
    COALESCE(p.full_name, p."full name") AS full_name,
    COALESCE(p.avatar_url, p."avatar url") AS avatar_url,
    p.age,
    p.gender
  FROM public.profiles p
  WHERE auth.uid() IS NOT NULL
    AND p.id <> auth.uid()
    AND p.age IS NOT NULL
    AND p.gender IN ('male', 'female')
    AND p.gender IS DISTINCT FROM (
      SELECT me.gender
      FROM public.profiles me
      WHERE me.id = auth.uid()
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.likes l
      WHERE l.from_user = auth.uid()
        AND l.to_user = p.id
    )
  ORDER BY COALESCE(p.created_at, p."created at") DESC NULLS LAST
  LIMIT 50;
$$;

CREATE OR REPLACE FUNCTION public.find_video_partner()
RETURNS TABLE (
  session_id uuid,
  partner_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid := auth.uid();
  v_partner uuid;
  v_session uuid;
BEGIN
  IF v_me IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.video_queue
  SET status = 'waiting',
      session_id = NULL,
      partner_id = NULL,
      updated_at = now()
  WHERE user_id = v_me
    AND status IS DISTINCT FROM 'waiting';

  INSERT INTO public.video_queue (user_id, status, session_id, partner_id, updated_at, created_at)
  VALUES (v_me, 'waiting', NULL, NULL, now(), now())
  ON CONFLICT (user_id) DO NOTHING;

  PERFORM 1
  FROM public.video_queue
  WHERE user_id = v_me
  FOR UPDATE;

  SELECT q.session_id, q.partner_id
  INTO v_session, v_partner
  FROM public.video_queue q
  WHERE q.user_id = v_me
    AND q.status = 'matched'
    AND q.session_id IS NOT NULL
    AND q.partner_id IS NOT NULL;

  IF v_session IS NOT NULL THEN
    session_id := v_session;
    partner_id := v_partner;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT q.user_id
  INTO v_partner
  FROM public.video_queue q
  WHERE q.status = 'waiting'
    AND q.user_id <> v_me
  ORDER BY q.updated_at ASC NULLS LAST, q.user_id ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF v_partner IS NULL THEN
    RETURN;
  END IF;

  v_session := gen_random_uuid();

  UPDATE public.video_queue
  SET status = 'matched',
      session_id = v_session,
      partner_id = v_partner,
      updated_at = now()
  WHERE user_id = v_me;

  UPDATE public.video_queue
  SET status = 'matched',
      session_id = v_session,
      partner_id = v_me,
      updated_at = now()
  WHERE user_id = v_partner;

  session_id := v_session;
  partner_id := v_partner;
  RETURN NEXT;
END;
$$;

DROP POLICY IF EXISTS profiles_select_authenticated ON public.profiles;
DROP POLICY IF EXISTS profiles_select_own ON public.profiles;

CREATE POLICY profiles_select_own
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (id = auth.uid());

REVOKE ALL ON FUNCTION public.get_matching_profiles() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_matching_profiles() FROM anon;
REVOKE ALL ON FUNCTION public.find_video_partner() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.find_video_partner() FROM anon;

GRANT EXECUTE ON FUNCTION public.get_matching_profiles() TO authenticated;
GRANT EXECUTE ON FUNCTION public.find_video_partner() TO authenticated;
