-- Phase 2 Database Migration: Profiles Security, Mutual Matches, Messages/Chat, Video Queue Cleanup, and RPC Hardening

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. PROFILES SECURITY HARDENING & PRIVILEGES
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.profiles FROM PUBLIC;
REVOKE ALL ON TABLE public.profiles FROM anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.profiles TO authenticated;

DROP POLICY IF EXISTS profiles_select_authenticated ON public.profiles;
DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
DROP POLICY IF EXISTS profiles_insert_own ON public.profiles;
DROP POLICY IF EXISTS profiles_update_own ON public.profiles;

CREATE POLICY profiles_select_own
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (id = auth.uid());

CREATE POLICY profiles_insert_own
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (id = auth.uid());

CREATE POLICY profiles_update_own
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- 2. MESSAGES TABLE & SECURITY
CREATE TABLE IF NOT EXISTS public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  receiver_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  content text NOT NULL,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT messages_no_self CHECK (sender_id <> receiver_id),
  CONSTRAINT messages_content_length CHECK (char_length(content) > 0 AND char_length(content) <= 2000)
);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS messages_sender_receiver_idx ON public.messages (sender_id, receiver_id);
CREATE INDEX IF NOT EXISTS messages_created_at_idx ON public.messages (created_at);

DROP POLICY IF EXISTS messages_select_involved ON public.messages;
DROP POLICY IF EXISTS messages_insert_own ON public.messages;

CREATE POLICY messages_select_involved
  ON public.messages
  FOR SELECT
  TO authenticated
  USING (
    (sender_id = auth.uid() OR receiver_id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.likes l1
      WHERE l1.from_user = sender_id AND l1.to_user = receiver_id
    )
    AND EXISTS (
      SELECT 1 FROM public.likes l2
      WHERE l2.from_user = receiver_id AND l2.to_user = sender_id
    )
  );

CREATE POLICY messages_insert_own
  ON public.messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND sender_id <> receiver_id
    AND char_length(content) <= 2000
    AND EXISTS (
      SELECT 1 FROM public.likes l1
      WHERE l1.from_user = sender_id AND l1.to_user = receiver_id
    )
    AND EXISTS (
      SELECT 1 FROM public.likes l2
      WHERE l2.from_user = receiver_id AND l2.to_user = sender_id
    )
  );

REVOKE ALL ON TABLE public.messages FROM PUBLIC;
REVOKE ALL ON TABLE public.messages FROM anon;
GRANT SELECT, INSERT ON TABLE public.messages TO authenticated;

-- Realtime for messages
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

-- 3. DROP EXISTING FUNCTIONS TO ALLOW RETURN TYPE RE-DEFINITION
DROP FUNCTION IF EXISTS public.get_matching_profiles();
DROP FUNCTION IF EXISTS public.get_mutual_matches();
DROP FUNCTION IF EXISTS public.find_video_partner();
DROP FUNCTION IF EXISTS public.cleanup_stale_video_queue();

-- 4. MATCHING & MUTUAL MATCHES RPCs
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
  ORDER BY COALESCE(p.created_at, p."created at") DESC NULLS LAST
  LIMIT 50;
$$;

CREATE OR REPLACE FUNCTION public.get_mutual_matches()
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
    AND EXISTS (
      SELECT 1 FROM public.likes l1
      WHERE l1.from_user = auth.uid() AND l1.to_user = p.id
    )
    AND EXISTS (
      SELECT 1 FROM public.likes l2
      WHERE l2.from_user = p.id AND l2.to_user = auth.uid()
    )
  ORDER BY COALESCE(p.created_at, p."created at") DESC NULLS LAST;
$$;

-- 5. VIDEO QUEUE CLEANUP & HARDENING
CREATE OR REPLACE FUNCTION public.cleanup_stale_video_queue()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Remove waiting records inactive for over 1 minute
  DELETE FROM public.video_queue
  WHERE status = 'waiting'
    AND updated_at < (now() - interval '1 minute');

  -- Remove matched records inactive for over 10 minutes
  DELETE FROM public.video_queue
  WHERE status = 'matched'
    AND updated_at < (now() - interval '10 minutes');
END;
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

  -- Clean up old stale queue records
  PERFORM public.cleanup_stale_video_queue();

  UPDATE public.video_queue
  SET status = 'waiting',
      session_id = NULL,
      partner_id = NULL,
      updated_at = now()
  WHERE user_id = v_me
    AND status IS DISTINCT FROM 'waiting';

  INSERT INTO public.video_queue (user_id, status, session_id, partner_id, updated_at, created_at)
  VALUES (v_me, 'waiting', NULL, NULL, now(), now())
  ON CONFLICT (user_id) DO UPDATE
  SET status = 'waiting',
      session_id = NULL,
      partner_id = NULL,
      updated_at = now();

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

-- 6. RPC SECURITY & EXECUTE PERMISSIONS
REVOKE ALL ON FUNCTION public.get_matching_profiles() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_matching_profiles() FROM anon;
REVOKE ALL ON FUNCTION public.get_mutual_matches() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_mutual_matches() FROM anon;
REVOKE ALL ON FUNCTION public.find_video_partner() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.find_video_partner() FROM anon;
REVOKE ALL ON FUNCTION public.cleanup_stale_video_queue() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cleanup_stale_video_queue() FROM anon;

GRANT EXECUTE ON FUNCTION public.get_matching_profiles() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_mutual_matches() TO authenticated;
GRANT EXECUTE ON FUNCTION public.find_video_partner() TO authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_stale_video_queue() TO authenticated;
