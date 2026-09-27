import { supabase } from "./supabaseClient.js";
import { profileAvatar, profileDisplayName } from "./dom.js";
import {
  applyDocumentLanguage,
  dashboardTranslations,
  getSavedLanguage,
  saveLanguage
} from "./i18n.js";
import { loadMatchingProfiles } from "./matching.js";

function t(language) {
  return dashboardTranslations[language] || dashboardTranslations.uz;
}

function applyDashboardLanguage(language) {
  const copy = t(language);
  applyDocumentLanguage(language);
  saveLanguage(language);

  const welcome = document.querySelector(".topbar strong");
  const matchingTitle = document.getElementById("matchingTitle");
  const matchingSubtitle = document.getElementById("matchingSubtitle");
  const empty = document.getElementById("emptyMessage");

  if (welcome) welcome.textContent = copy.welcome;
  if (matchingTitle) matchingTitle.textContent = copy.matching;
  if (matchingSubtitle) matchingSubtitle.textContent = copy.subtitle;
  if (empty) empty.textContent = copy.empty;

  const buttons = document.querySelectorAll(".nav > button");
  if (buttons[0]) buttons[0].textContent = copy.home;
  if (buttons[1]) buttons[1].textContent = copy.matches;
  if (buttons[2]) buttons[2].textContent = copy.video;
  if (buttons[3]) buttons[3].textContent = copy.chat;

  const secondaryButtons = document.querySelectorAll("#secondaryNav > button");
  if (secondaryButtons[0]) secondaryButtons[0].textContent = copy.stories;
  if (secondaryButtons[1]) secondaryButtons[1].textContent = copy.vip;
  if (secondaryButtons[2]) secondaryButtons[2].textContent = copy.settings;
  if (secondaryButtons[3]) secondaryButtons[3].textContent = copy.logout;
}

async function loadUser() {
  const result = await supabase.auth.getUser();
  const user = result.data.user;

  if (!user) {
    window.location.href = "/";
    return null;
  }

  const profileResult = await supabase
    .from("profiles")
    .select("username, full_name, avatar_url, age, gender")
    .eq("id", user.id)
    .maybeSingle();

  if (profileResult.error) {
    console.error(profileResult.error);
    return user;
  }

  const profile = profileResult.data || {};
  const userName = document.getElementById("userName");
  const userAvatar = document.getElementById("userAvatar");
  const displayName = profileDisplayName(profile, user.user_metadata?.full_name || "User");
  const avatar = profileAvatar(
    profile,
    user.user_metadata?.avatar_url || user.user_metadata?.picture || ""
  );

  if (userName) userName.textContent = displayName;
  if (userAvatar) userAvatar.src = avatar;

  if (!profile.age || !profile.gender || !profile.username) {
    window.location.href = "/";
    return null;
  }

  return user;
}

export async function initDashboardPage() {
  const languageSelect = document.getElementById("languageSelect");
  const savedLanguage = getSavedLanguage(dashboardTranslations);

  if (languageSelect) {
    languageSelect.value = savedLanguage;
    languageSelect.addEventListener("change", () => {
      applyDashboardLanguage(languageSelect.value);
      const grid = document.getElementById("matchingGrid");
      const empty = document.getElementById("emptyMessage");
      if (grid && empty) {
        loadMatchingProfiles(grid, empty, t(languageSelect.value));
      }
    });
  }

  applyDashboardLanguage(savedLanguage);

  document.getElementById("logoutBtn")?.addEventListener("click", async () => {
    await supabase.auth.signOut();
    window.location.href = "/";
  });

  const mobileMenuBtn = document.getElementById("mobileMenuBtn");
  const secondaryNav = document.getElementById("secondaryNav");
  if (mobileMenuBtn && secondaryNav) {
    mobileMenuBtn.addEventListener("click", () => {
      secondaryNav.classList.toggle("open");
    });
  }

  const user = await loadUser();
  if (!user) return;

  const grid = document.getElementById("matchingGrid");
  const empty = document.getElementById("emptyMessage");
  if (grid && empty) {
    await loadMatchingProfiles(grid, empty, t(languageSelect?.value || savedLanguage));
  }
}
