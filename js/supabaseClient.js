import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

export const supabaseUrl = "https://edixhhalohowfbfvijlw.supabase.co";
export const supabaseKey = "sb_publishable_VgxbW_5NGpmoQTOs0ydxQw_JvGY49Mz";

export const supabase = createClient(supabaseUrl, supabaseKey);
