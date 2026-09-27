import { supabase } from "./supabaseClient.js";
import { isValidAge, isValidGender, isValidUsername } from "./dom.js";
import {
  applyDocumentLanguage,
  getSavedLanguage,
  landingTranslations,
  saveLanguage
} from "./i18n.js";

function t(language) {
  return landingTranslations[language] || landingTranslations.uz;
}

function currentLanguage() {
  const select = document.getElementById("languageSelect");
  return select?.value || "uz";
}

function setLoggedOutUi() {
  const loginBtn = document.getElementById("loginBtn");
  const mainLoginBtn = document.getElementById("mainLoginBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const profileBox = document.getElementById("profileBox");

  if (loginBtn) loginBtn.style.display = "inline-block";
  if (mainLoginBtn) mainLoginBtn.style.display = "inline-block";
  if (logoutBtn) logoutBtn.style.display = "none";
  if (profileBox) profileBox.style.display = "none";
}

function setLoggedInUi() {
  const loginBtn = document.getElementById("loginBtn");
  const mainLoginBtn = document.getElementById("mainLoginBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const profileBox = document.getElementById("profileBox");

  if (loginBtn) loginBtn.style.display = "none";
  if (mainLoginBtn) mainLoginBtn.style.display = "none";
  if (logoutBtn) logoutBtn.style.display = "inline-block";
  if (profileBox) {
    profileBox.style.display = "block";
    profileBox.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

function applyLandingLanguage(language) {
  const copy = t(language);
  applyDocumentLanguage(language);
  saveLanguage(language);

  const map = {
    title: copy.title,
    subtitle: copy.subtitle,
    sectionTitle: copy.sectionTitle,
    sectionSubtitle: copy.sectionSubtitle,
    loginBtn: copy.login,
    logoutBtn: copy.logout,
    mainLoginBtn: copy.start,
    usernameLabel: copy.username,
    nameLabel: copy.name,
    ageLabel: copy.age,
    genderLabel: copy.gender,
    saveBtn: copy.save,
    profileTitle: copy.profile,
    profileText: copy.profileText,
    videoTitle: copy.video,
    videoText: copy.videoText,
    chatTitle: copy.chat,
    chatText: copy.chatText
  };

  Object.entries(map).forEach(([id, value]) => {
    const node = document.getElementById(id);
    if (node) node.textContent = value;
  });

  const username = document.getElementById("username");
  const nameInput = document.getElementById("nameInput");
  const ageInput = document.getElementById("ageInput");
  const genderSelect = document.getElementById("genderSelect");
  const usernameHint = document.getElementById("usernameHint");

  if (username) username.placeholder = copy.usernamePlaceholder;
  if (nameInput) nameInput.placeholder = copy.namePlaceholder;
  if (ageInput) ageInput.placeholder = copy.agePlaceholder;
  if (usernameHint) usernameHint.textContent = copy.usernameHint;

  if (genderSelect && genderSelect.options.length >= 3) {
    genderSelect.options[0].textContent = copy.genderPlaceholder;
    genderSelect.options[1].textContent = copy.male;
    genderSelect.options[2].textContent = copy.female;
  }
}

function googleMeta(user) {
  return {
    name: user.user_metadata?.full_name || user.user_metadata?.name || "User",
    avatar: user.user_metadata?.avatar_url || user.user_metadata?.picture || ""
  };
}

function isProfileComplete(profile) {
  return Boolean(
    profile &&
      isValidAge(Number(profile.age)) &&
      isValidGender(profile.gender) &&
      isValidUsername(profile.username)
  );
}

async function login() {
  const result = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: window.location.origin + "/"
    }
  });

  if (result.error) {
    alert(result.error.message);
  }
}

async function logout() {
  await supabase.auth.signOut();
  setLoggedOutUi();
}

async function loadProfile(user) {
  if (!user) {
    setLoggedOutUi();
    return;
  }

  const { name, avatar } = googleMeta(user);
  const avatarEl = document.getElementById("avatar");
  const fullName = document.getElementById("fullName");
  const email = document.getElementById("email");
  const username = document.getElementById("username");
  const nameInput = document.getElementById("nameInput");
  const ageInput = document.getElementById("ageInput");
  const genderSelect = document.getElementById("genderSelect");

  if (avatarEl) avatarEl.src = avatar;
  if (fullName) fullName.textContent = name;
  if (email) email.textContent = user.email || "";

  const profileResult = await supabase
    .from("profiles")
    .select('username, "full name", "avatar url", age, gender')
    .eq("id", user.id)
    .maybeSingle();

  if (profileResult.error) {
    console.error(profileResult.error);
    setLoggedInUi();
    return;
  }

  const profile = profileResult.data;

  if (isProfileComplete(profile)) {
    window.location.href = "dashboard.html";
    return;
  }

  setLoggedInUi();

  const savedName = profile?.["full name"] || profile?.full_name || "";
  const savedAvatar = profile?.["avatar url"] || profile?.avatar_url || "";

  if (username) username.value = profile?.username || "";
  if (nameInput) nameInput.value = savedName || name;
  if (ageInput) ageInput.value = profile?.age || "";
  if (genderSelect) genderSelect.value = profile?.gender || "";
  if (avatarEl && savedAvatar) avatarEl.src = savedAvatar;
  if (fullName && savedName) fullName.textContent = savedName;
}

async function saveProfile() {
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return;

  const copy = t(currentLanguage());
  const status = document.getElementById("status");
  const username = document.getElementById("username")?.value.trim() || "";
  const newName = document.getElementById("nameInput")?.value.trim() || "";
  const ageRaw = document.getElementById("ageInput")?.value;
  const newAge = ageRaw ? Number(ageRaw) : null;
  const newGender = document.getElementById("genderSelect")?.value || "";
  const { avatar } = googleMeta(user);

  if (status) status.textContent = copy.saving;

  if (!isValidUsername(username)) {
    if (status) status.textContent = copy.error + copy.usernameHint;
    return;
  }

  if (!isValidAge(newAge)) {
    if (status) status.textContent = copy.error + "18-100";
    return;
  }

  if (!isValidGender(newGender)) {
    if (status) status.textContent = copy.error + copy.genderPlaceholder;
    return;
  }

  const updateResult = await supabase.from("profiles").upsert(
    {
      id: user.id,
      username,
      "full name": newName,
      "avatar url": avatar,
      age: newAge,
      gender: newGender
    },
    { onConflict: "id" }
  );

  if (updateResult.error) {
    if (status) {
      status.textContent =
        updateResult.error.code === "23505"
          ? copy.error + copy.username
          : copy.error + updateResult.error.message;
    }
    return;
  }

  const fullName = document.getElementById("fullName");
  if (fullName) fullName.textContent = newName || "User";
  if (status) status.textContent = copy.saved;

  window.setTimeout(() => {
    window.location.href = "dashboard.html";
  }, 400);
}

export function initLandingPage() {
  const languageSelect = document.getElementById("languageSelect");
  const savedLanguage = getSavedLanguage(landingTranslations);

  if (languageSelect) {
    languageSelect.value = savedLanguage;
    languageSelect.addEventListener("change", () => {
      applyLandingLanguage(languageSelect.value);
    });
  }

  applyLandingLanguage(savedLanguage);

  document.getElementById("loginBtn")?.addEventListener("click", login);
  document.getElementById("mainLoginBtn")?.addEventListener("click", login);
  document.getElementById("logoutBtn")?.addEventListener("click", logout);
  document.getElementById("saveBtn")?.addEventListener("click", saveProfile);

  supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === "TOKEN_REFRESHED" || event === "USER_UPDATED") return;
    await loadProfile(session?.user || null);
  });
}
