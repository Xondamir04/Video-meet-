CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  username text,
  "full name" text,
  "avatar url" text,
  age integer,
  gender text,
  "created at" timestamptz DEFAULT now(),
  full_name text,
  avatar_url text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.likes (
  from_user uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  to_user uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT likes_from_to_unique UNIQUE (from_user, to_user),
  CONSTRAINT likes_no_self CHECK (from_user <> to_user)
);

CREATE TABLE IF NOT EXISTS public.video_queue (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'waiting',
  session_id uuid,
  partner_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  updated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS username text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS "full name" text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS "avatar url" text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS age integer;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS gender text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS "created at" timestamptz DEFAULT now();
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS full_name text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

ALTER TABLE public.likes ADD COLUMN IF NOT EXISTS from_user uuid;
ALTER TABLE public.likes ADD COLUMN IF NOT EXISTS to_user uuid;
ALTER TABLE public.likes ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

ALTER TABLE public.video_queue ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.video_queue ADD COLUMN IF NOT EXISTS status text DEFAULT 'waiting';
ALTER TABLE public.video_queue ADD COLUMN IF NOT EXISTS session_id uuid;
ALTER TABLE public.video_queue ADD COLUMN IF NOT EXISTS partner_id uuid;
ALTER TABLE public.video_queue ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE public.video_queue ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

UPDATE public.profiles
SET "full name" = full_name
WHERE "full name" IS NULL AND full_name IS NOT NULL;

UPDATE public.profiles
SET full_name = "full name"
WHERE full_name IS NULL AND "full name" IS NOT NULL;

UPDATE public.profiles
SET "avatar url" = avatar_url
WHERE "avatar url" IS NULL AND avatar_url IS NOT NULL;

UPDATE public.profiles
SET avatar_url = "avatar url"
WHERE avatar_url IS NULL AND "avatar url" IS NOT NULL;

UPDATE public.profiles
SET "created at" = created_at
WHERE "created at" IS NULL AND created_at IS NOT NULL;

UPDATE public.profiles
SET created_at = "created at"
WHERE created_at IS NULL AND "created at" IS NOT NULL;

UPDATE public.video_queue
SET status = 'waiting'
WHERE status IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_pkey'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_id_fkey'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_id_fkey
      FOREIGN KEY (id) REFERENCES auth.users (id) ON DELETE CASCADE;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'likes_from_to_unique'
      AND conrelid = 'public.likes'::regclass
  ) THEN
    ALTER TABLE public.likes
      ADD CONSTRAINT likes_from_to_unique UNIQUE (from_user, to_user);
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'likes_no_self'
      AND conrelid = 'public.likes'::regclass
  ) THEN
    ALTER TABLE public.likes
      ADD CONSTRAINT likes_no_self CHECK (from_user <> to_user);
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'likes_from_user_fkey'
      AND conrelid = 'public.likes'::regclass
  ) THEN
    ALTER TABLE public.likes
      ADD CONSTRAINT likes_from_user_fkey
      FOREIGN KEY (from_user) REFERENCES auth.users (id) ON DELETE CASCADE;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'likes_to_user_fkey'
      AND conrelid = 'public.likes'::regclass
  ) THEN
    ALTER TABLE public.likes
      ADD CONSTRAINT likes_to_user_fkey
      FOREIGN KEY (to_user) REFERENCES auth.users (id) ON DELETE CASCADE;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'video_queue_pkey'
      AND conrelid = 'public.video_queue'::regclass
  ) THEN
    ALTER TABLE public.video_queue ADD CONSTRAINT video_queue_pkey PRIMARY KEY (user_id);
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'video_queue_user_id_key'
      AND conrelid = 'public.video_queue'::regclass
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.video_queue'::regclass
      AND contype IN ('p', 'u')
      AND pg_get_constraintdef(oid) ILIKE '%user_id%'
  ) THEN
    ALTER TABLE public.video_queue
      ADD CONSTRAINT video_queue_user_id_key UNIQUE (user_id);
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'video_queue_user_id_fkey'
      AND conrelid = 'public.video_queue'::regclass
  ) THEN
    ALTER TABLE public.video_queue
      ADD CONSTRAINT video_queue_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'video_queue_partner_id_fkey'
      AND conrelid = 'public.video_queue'::regclass
  ) THEN
    ALTER TABLE public.video_queue
      ADD CONSTRAINT video_queue_partner_id_fkey
      FOREIGN KEY (partner_id) REFERENCES auth.users (id) ON DELETE SET NULL;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS profiles_username_idx ON public.profiles (username);
CREATE INDEX IF NOT EXISTS profiles_gender_idx ON public.profiles (gender);
CREATE INDEX IF NOT EXISTS profiles_age_idx ON public.profiles (age);
CREATE INDEX IF NOT EXISTS likes_from_user_idx ON public.likes (from_user);
CREATE INDEX IF NOT EXISTS likes_to_user_idx ON public.likes (to_user);
CREATE INDEX IF NOT EXISTS video_queue_status_idx ON public.video_queue (status);
CREATE INDEX IF NOT EXISTS video_queue_waiting_idx ON public.video_queue (updated_at) WHERE status = 'waiting';

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_queue ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.video_queue REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'profiles_select_authenticated'
  ) THEN
    CREATE POLICY profiles_select_authenticated
      ON public.profiles
      FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'profiles_insert_own'
  ) THEN
    CREATE POLICY profiles_insert_own
      ON public.profiles
      FOR INSERT
      TO authenticated
      WITH CHECK (id = auth.uid());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'profiles_update_own'
  ) THEN
    CREATE POLICY profiles_update_own
      ON public.profiles
      FOR UPDATE
      TO authenticated
      USING (id = auth.uid())
      WITH CHECK (id = auth.uid());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'likes'
      AND policyname = 'likes_select_involved'
  ) THEN
    CREATE POLICY likes_select_involved
      ON public.likes
      FOR SELECT
      TO authenticated
      USING (from_user = auth.uid() OR to_user = auth.uid());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'likes'
      AND policyname = 'likes_insert_own'
  ) THEN
    CREATE POLICY likes_insert_own
      ON public.likes
      FOR INSERT
      TO authenticated
      WITH CHECK (from_user = auth.uid() AND from_user <> to_user);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'likes'
      AND policyname = 'likes_delete_own'
  ) THEN
    CREATE POLICY likes_delete_own
      ON public.likes
      FOR DELETE
      TO authenticated
      USING (from_user = auth.uid());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'video_queue'
      AND policyname = 'video_queue_select_own'
  ) THEN
    CREATE POLICY video_queue_select_own
      ON public.video_queue
      FOR SELECT
      TO authenticated
      USING (user_id = auth.uid());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'video_queue'
      AND policyname = 'video_queue_insert_own'
  ) THEN
    CREATE POLICY video_queue_insert_own
      ON public.video_queue
      FOR INSERT
      TO authenticated
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'video_queue'
      AND policyname = 'video_queue_update_own'
  ) THEN
    CREATE POLICY video_queue_update_own
      ON public.video_queue
      FOR UPDATE
      TO authenticated
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'video_queue'
      AND policyname = 'video_queue_delete_own'
  ) THEN
    CREATE POLICY video_queue_delete_own
      ON public.video_queue
      FOR DELETE
      TO authenticated
      USING (user_id = auth.uid());
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.set_video_queue_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS video_queue_set_updated_at ON public.video_queue;
CREATE TRIGGER video_queue_set_updated_at
  BEFORE UPDATE ON public.video_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.set_video_queue_updated_at();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (
    id,
    username,
    "full name",
    "avatar url",
    full_name,
    avatar_url,
    "created at",
    created_at
  )
  VALUES (
    NEW.id,
    NULL,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', NEW.raw_user_meta_data->>'picture'),
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', NEW.raw_user_meta_data->>'picture'),
    now(),
    now()
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'on_auth_user_created'
      AND tgrelid = 'auth.users'::regclass
  ) THEN
    CREATE TRIGGER on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW
      EXECUTE FUNCTION public.handle_new_user();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'get_matching_profiles'
      AND p.pronargs = 0
  ) THEN
    CREATE FUNCTION public.get_matching_profiles()
    RETURNS TABLE (
      id uuid,
      username text,
      "full name" text,
      "avatar url" text,
      age integer,
      gender text
    )
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public
    AS $fn$
      SELECT
        p.id,
        p.username,
        COALESCE(p."full name", p.full_name) AS "full name",
        COALESCE(p."avatar url", p.avatar_url) AS "avatar url",
        p.age,
        p.gender
      FROM public.profiles p
      WHERE auth.uid() IS NOT NULL
        AND p.id <> auth.uid()
        AND p.age IS NOT NULL
        AND COALESCE(p.gender, '') <> ''
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
      ORDER BY COALESCE(p."created at", p.created_at) DESC NULLS LAST
      LIMIT 50;
    $fn$;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'find_video_partner'
      AND p.pronargs = 0
  ) THEN
    CREATE FUNCTION public.find_video_partner()
    RETURNS TABLE (
      session_id uuid,
      partner_id uuid
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $fn$
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
    $fn$;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.likes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.video_queue TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_matching_profiles() TO authenticated;
GRANT EXECUTE ON FUNCTION public.find_video_partner() TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1
       FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'video_queue'
     )
  THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.video_queue;
  END IF;
END $$;
