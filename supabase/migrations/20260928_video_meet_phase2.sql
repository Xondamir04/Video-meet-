-- Migration 20260928_video_meet_phase2.sql
-- Additive and Idempotent Phase 2 Database Security and Features Migration

CREATE EXTENSION IF NOT EXISTS pgcrypto;

--------------------------------------------------------------------------------
-- 1. MESSAGES TABLE & CONSTRAINTS
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  receiver_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  content text NOT NULL,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT messages_no_self CHECK (sender_id <> receiver_id),
  CONSTRAINT messages_content_len CHECK (length(content) <= 2000 AND length(trim(content)) > 0)
);

CREATE INDEX IF NOT EXISTS messages_sender_receiver_idx ON public.messages (sender_id, receiver_id);
CREATE INDEX IF NOT EXISTS messages_receiver_sender_idx ON public.messages (receiver_id, sender_id);
CREATE INDEX IF NOT EXISTS messages_created_at_idx ON public.messages (created_at);

--------------------------------------------------------------------------------
-- 2. PROFILES SECURITY & RLS HARDENING
--------------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Drop permissive public select policy if present
DROP POLICY IF EXISTS profiles_select_authenticated ON public.profiles;
DROP POLICY IF EXISTS profiles_select_own ON public.profiles;

-- RLS: Authenticated users can direct-select only their own profile
CREATE POLICY profiles_select_own
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (id = auth.uid());

DROP POLICY IF EXISTS profiles_insert_own ON public.profiles;
CREATE POLICY profiles_insert_own
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS profiles_delete_own ON public.profiles;
CREATE POLICY profiles_delete_own
  ON public.profiles
  FOR DELETE
  TO authenticated
  USING (id = auth.uid());

--------------------------------------------------------------------------------
-- 3. MESSAGES RLS
--------------------------------------------------------------------------------
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS messages_select_involved ON public.messages;
CREATE POLICY messages_select_involved
  ON public.messages
  FOR SELECT
  TO authenticated
  USING (sender_id = auth.uid() OR receiver_id = auth.uid());

DROP POLICY IF EXISTS messages_insert_own ON public.messages;
CREATE POLICY messages_insert_own
  ON public.messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND sender_id <> receiver_id
    AND length(content) <= 2000
    AND length(trim(content)) > 0
    AND EXISTS (
      SELECT 1 FROM public.likes l1 WHERE l1.from_user = auth.uid() AND l1.to_user = receiver_id
    )
    AND EXISTS (
      SELECT 1 FROM public.likes l2 WHERE l2.from_user = receiver_id AND l2.to_user = auth.uid()
    )
  );

--------------------------------------------------------------------------------
-- 4. MUTUAL MATCHES RPC
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_mutual_matches()
RETURNS TABLE (
  id uuid,
  username text,
  full_name text,
  avatar_url text,
  "full name" text,
  "avatar url" text,
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
    COALESCE(p."full name", p.full_name) AS "full name",
    COALESCE(p."avatar url", p.avatar_url) AS "avatar url",
    p.age,
    p.gender
  FROM public.profiles p
  WHERE auth.uid() IS NOT NULL
    AND p.id <> auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.likes l1 WHERE l1.from_user = auth.uid() AND l1.to_user = p.id
    )
    AND EXISTS (
      SELECT 1 FROM public.likes l2 WHERE l2.from_user = p.id AND l2.to_user = auth.uid()
    )
  ORDER BY COALESCE(p.created_at, p."created at") DESC NULLS LAST;
$$;

--------------------------------------------------------------------------------
-- 5. MATCHING PROFILES RPC REFINEMENT
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_matching_profiles()
RETURNS TABLE (
  id uuid,
  username text,
  full_name text,
  avatar_url text,
  "full name" text,
  "avatar url" text,
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
    COALESCE(p."full name", p.full_name) AS "full name",
    COALESCE(p."avatar url", p.avatar_url) AS "avatar url",
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

--------------------------------------------------------------------------------
-- 6. VIDEO QUEUE HEARTBEAT & CLEANUP RPCs
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_video_queue()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.video_queue
  SET updated_at = now()
  WHERE user_id = auth.uid();
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_video_queue(
  p_waiting_timeout_seconds integer DEFAULT 30,
  p_matched_timeout_seconds integer DEFAULT 60
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  v_waiting_limit timestamptz := now() - (p_waiting_timeout_seconds || ' seconds')::interval;
  v_matched_limit timestamptz := now() - (p_matched_timeout_seconds || ' seconds')::interval;
  v_waiting_deleted integer := 0;
  v_matched_deleted integer := 0;
BEGIN
  WITH deleted_waiting AS (
    DELETE FROM public.video_queue
    WHERE status = 'waiting'
      AND updated_at < v_waiting_limit
    RETURNING user_id
  )
  SELECT count(*) INTO v_waiting_deleted FROM deleted_waiting;

  WITH deleted_matched AS (
    DELETE FROM public.video_queue
    WHERE status = 'matched'
      AND updated_at < v_matched_limit
    RETURNING user_id
  )
  SELECT count(*) INTO v_matched_deleted FROM deleted_matched;

  v_count := v_waiting_deleted + v_matched_deleted;
  RETURN v_count;
END;
$$;

--------------------------------------------------------------------------------
-- 7. PERMISSIONS & REALTIME
--------------------------------------------------------------------------------
GRANT SELECT, INSERT ON public.messages TO authenticated;

REVOKE ALL ON FUNCTION public.get_matching_profiles() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_mutual_matches() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.find_video_partner() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.touch_video_queue() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cleanup_video_queue(integer, integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_matching_profiles() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_mutual_matches() TO authenticated;
GRANT EXECUTE ON FUNCTION public.find_video_partner() TO authenticated;
GRANT EXECUTE ON FUNCTION public.touch_video_queue() TO authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_video_queue(integer, integer) TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1
       FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'messages'
     )
  THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  END IF;
END $$;
