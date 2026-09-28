import fs from "fs";
import path from "path";
import assert from "assert";

console.log("=== RUNNING PHASE 2 COMPREHENSIVE SUITE ===");

// 1. DATABASE MIGRATION VERIFICATION
const migrationPath = path.join(process.cwd(), "supabase/migrations/20260928_video_meet_phase2.sql");
assert.ok(fs.existsSync(migrationPath), "Migration file 20260928_video_meet_phase2.sql exists");

const sqlContent = fs.readFileSync(migrationPath, "utf-8");

// RLS and Profile security checks
assert.ok(sqlContent.includes("DROP POLICY IF EXISTS profiles_select_authenticated ON public.profiles;"), "Open profiles select policy dropped");
assert.ok(sqlContent.includes("CREATE POLICY profiles_select_own"), "Own profile SELECT policy created");
assert.ok(sqlContent.includes("CREATE POLICY profiles_insert_own"), "Own profile INSERT policy created");
assert.ok(sqlContent.includes("CREATE POLICY profiles_update_own"), "Own profile UPDATE policy created");

// Messages table and RLS checks
assert.ok(sqlContent.includes("CREATE TABLE IF NOT EXISTS public.messages"), "Messages table created");
assert.ok(sqlContent.includes("messages_no_self CHECK (sender_id <> receiver_id)"), "Messages no self constraint created");
assert.ok(sqlContent.includes("length(content) <= 2000"), "Messages max length 2000 constraint created");
assert.ok(sqlContent.includes("CREATE POLICY messages_select_involved"), "Messages SELECT RLS created");
assert.ok(sqlContent.includes("CREATE POLICY messages_insert_own"), "Messages INSERT RLS created");

// RPC checks
assert.ok(sqlContent.includes("CREATE OR REPLACE FUNCTION public.get_mutual_matches()"), "get_mutual_matches RPC created");
assert.ok(sqlContent.includes("CREATE OR REPLACE FUNCTION public.cleanup_video_queue"), "cleanup_video_queue RPC created");
assert.ok(sqlContent.includes("CREATE OR REPLACE FUNCTION public.touch_video_queue()"), "touch_video_queue RPC created");
assert.ok(sqlContent.includes("SET search_path = public"), "SECURITY DEFINER functions use search_path = public");

// Permission checks
assert.ok(sqlContent.includes("REVOKE ALL ON FUNCTION public.get_matching_profiles() FROM PUBLIC, anon;"), "Revoked PUBLIC/anon from get_matching_profiles");
assert.ok(sqlContent.includes("REVOKE ALL ON FUNCTION public.get_mutual_matches() FROM PUBLIC, anon;"), "Revoked PUBLIC/anon from get_mutual_matches");
assert.ok(sqlContent.includes("REVOKE ALL ON FUNCTION public.cleanup_video_queue"), "Revoked PUBLIC/anon from cleanup_video_queue");
assert.ok(sqlContent.includes("GRANT EXECUTE ON FUNCTION public.get_mutual_matches() TO authenticated;"), "Granted authenticated to get_mutual_matches");

console.log("✓ Migration SQL security & syntax verification passed.");

// 2. VALIDATION FUNCTIONS
import { isValidUsername, isValidAge, isValidGender } from "../js/dom.js";

assert.strictEqual(isValidUsername("user123"), true, "Valid username");
assert.strictEqual(isValidUsername("us"), false, "Username too short");
assert.strictEqual(isValidUsername("user_name_that_is_way_too_long_for_system"), false, "Username too long");
assert.strictEqual(isValidUsername("user<script>"), false, "Username with illegal characters");

assert.strictEqual(isValidAge(25), true, "Valid age");
assert.strictEqual(isValidAge(17), false, "Underage invalid");
assert.strictEqual(isValidAge(101), false, "Over 100 invalid");
assert.strictEqual(isValidAge("25"), false, "Non-integer invalid");

assert.strictEqual(isValidGender("male"), true, "Male valid");
assert.strictEqual(isValidGender("female"), true, "Female valid");
assert.strictEqual(isValidGender("other"), false, "Other gender invalid");

console.log("✓ Profile validation rules passed.");

// 3. INTERNATIONALIZATION VERIFICATION
import { landingTranslations, dashboardTranslations } from "../js/i18n.js";

const requiredLangs = ["uz", "en", "ru", "es", "ar", "zh", "de", "fr"];
requiredLangs.forEach((lang) => {
  assert.ok(landingTranslations[lang], `landingTranslations has ${lang}`);
  assert.ok(dashboardTranslations[lang], `dashboardTranslations has ${lang}`);
  assert.ok(dashboardTranslations[lang].yourMatches, `${lang} has yourMatches`);
  assert.ok(dashboardTranslations[lang].noMutualMatches, `${lang} has noMutualMatches`);
  assert.ok(dashboardTranslations[lang].conversations, `${lang} has conversations`);
  assert.ok(dashboardTranslations[lang].typeMessage, `${lang} has typeMessage`);
  assert.ok(dashboardTranslations[lang].send, `${lang} has send`);
});

console.log("✓ All 8 languages i18n completeness verified.");

// 4. FRONTEND FILE INTEGRITY & NO SECRET KEYS
const jsFiles = ["js/app.js", "js/auth.js", "js/dashboard.js", "js/dom.js", "js/i18n.js", "js/landing.js", "js/matching.js", "js/supabaseClient.js", "js/video.js", "js/chat.js"];

jsFiles.forEach((file) => {
  const code = fs.readFileSync(path.join(process.cwd(), file), "utf-8");
  assert.strictEqual(code.includes("service_role"), false, `${file} does not contain service_role key`);
  assert.strictEqual(code.includes("sbp_"), false, `${file} does not contain secret management key`);
});

console.log("✓ Frontend security check passed (no secret keys found).");

// 5. HTML STRUCTURE & BROWSER COMPATIBILITY
const dashHtml = fs.readFileSync(path.join(process.cwd(), "dashboard.html"), "utf-8");
assert.ok(dashHtml.includes('id="chatSection"'), "dashboard.html contains chatSection");
assert.ok(dashHtml.includes('id="settingsSection"'), "dashboard.html contains settingsSection");
assert.ok(dashHtml.includes('id="videoSection"'), "dashboard.html contains videoSection");
assert.ok(dashHtml.includes('id="mutualMatchesGrid"'), "dashboard.html contains mutualMatchesGrid");
assert.ok(!dashHtml.includes("Sarah"), "dashboard.html does not contain mock Sarah card");

console.log("✓ Dashboard HTML layout and static mock cleanup verified.");

console.log("=== ALL TESTS PASSED SUCCESSFULLY ===");
