import { supabase } from "./supabaseClient.js";
import { isValidAge, isValidGender, isValidUsername, profileAvatar, profileDisplayName } from "./dom.js";
import {
  applyDocumentLanguage,
  dashboardTranslations,
  getSavedLanguage,
  saveLanguage
} from "./i18n.js";
import { loadMatchingProfiles, loadMutualMatches } from "./matching.js";
import { initChat, openConversation } from "./chat.js";

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
  const matchesTitle = document.getElementById("matchesTitle");
  const noMutualMatchesMsg = document.getElementById("noMutualMatchesMsg");
  const conversationsTitle = document.getElementById("conversationsTitle");
  const chatMessageInput = document.getElementById("chatMessageInput");
  const sendMessageBtn = document.getElementById("sendMessageBtn");

  if (welcome) welcome.textContent = copy.welcome;
  if (matchingTitle) matchingTitle.textContent = copy.matching;
  if (matchingSubtitle) matchingSubtitle.textContent = copy.subtitle;
  if (empty) empty.textContent = copy.empty;
  if (matchesTitle) matchesTitle.textContent = copy.yourMatches || "❤️ Your Matches";
  if (noMutualMatchesMsg) noMutualMatchesMsg.textContent = copy.noMutualMatches || "No mutual matches yet.";
  if (conversationsTitle) conversationsTitle.textContent = copy.conversations || "Conversations";
  if (chatMessageInput) chatMessageInput.placeholder = copy.typeMessage || "Type a message...";
  if (sendMessageBtn) sendMessageBtn.textContent = copy.send || "Send";

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
    .select('username, "full name", "avatar url", age, gender')
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

  initSettings(user);
  await initChat(user);

  const navHomeBtn = document.getElementById("navHomeBtn");
  const navMatchesBtn = document.getElementById("navMatchesBtn");
  const navChatBtn = document.getElementById("navChatBtn");

  const showHomeSections = () => {
    document.querySelectorAll(".home-section").forEach((s) => {
      if (s.id === "settingsSection" || s.id === "videoSection" || s.id === "chatSection") {
        s.style.display = "none";
      } else {
        s.style.display = "block";
      }
    });
  };

  navHomeBtn?.addEventListener("click", () => {
    showHomeSections();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  navMatchesBtn?.addEventListener("click", () => {
    showHomeSections();
    const matchesSection = document.getElementById("matchesSection");
    if (matchesSection) matchesSection.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  navChatBtn?.addEventListener("click", () => {
    const chatSection = document.getElementById("chatSection");
    if (chatSection) {
      document.querySelectorAll(".home-section").forEach((s) => (s.style.display = "none"));
      chatSection.style.display = "block";
      chatSection.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });

  const grid = document.getElementById("matchingGrid");
  const empty = document.getElementById("emptyMessage");
  const mutualGrid = document.getElementById("mutualMatchesGrid");
  const mutualEmpty = document.getElementById("noMutualMatchesMsg");
  const labels = t(languageSelect?.value || savedLanguage);

  if (grid && empty) {
    await loadMatchingProfiles(grid, empty, labels);
  }

  if (mutualGrid) {
    await loadMutualMatches(
      mutualGrid,
      mutualEmpty,
      labels,
      (partner) => openConversation(partner),
      (partner) => {
        const openVideoBtn = document.getElementById("openVideoBtn");
        if (openVideoBtn) openVideoBtn.click();
      }
    );
  }
}

async function populateSettings(user) {
  const profileResult = await supabase
    .from("profiles")
    .select('username, full_name, "full name", avatar_url, "avatar url", age, gender')
    .eq("id", user.id)
    .maybeSingle();

  const profile = profileResult.data || {};
  const dashUsername = document.getElementById("dashUsername");
  const dashFullName = document.getElementById("dashFullName");
  const dashAge = document.getElementById("dashAge");
  const dashGender = document.getElementById("dashGender");
  const dashAvatarUrl = document.getElementById("dashAvatarUrl");

  if (dashUsername) dashUsername.value = profile.username || "";
  if (dashFullName) dashFullName.value = profile.full_name || profile["full name"] || user.user_metadata?.full_name || "";
  if (dashAge) dashAge.value = profile.age || "";
  if (dashGender) dashGender.value = profile.gender || "";
  if (dashAvatarUrl) dashAvatarUrl.value = profile.avatar_url || profile["avatar url"] || user.user_metadata?.avatar_url || "";
}

function initSettings(user) {
  const openSettingsBtn = document.getElementById("openSettingsBtn");
  const backFromSettingsBtn = document.getElementById("backFromSettingsBtn");
  const settingsSection = document.getElementById("settingsSection");
  const saveSettingsBtn = document.getElementById("saveSettingsBtn");
  const settingsStatus = document.getElementById("settingsStatus");

  if (openSettingsBtn) {
    openSettingsBtn.addEventListener("click", async () => {
      document.querySelectorAll(".home-section").forEach((s) => (s.style.display = "none"));
      if (settingsSection) {
        settingsSection.style.display = "block";
        settingsSection.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      await populateSettings(user);
    });
  }

  if (backFromSettingsBtn) {
    backFromSettingsBtn.addEventListener("click", () => {
      if (settingsSection) settingsSection.style.display = "none";
      document.querySelectorAll(".home-section").forEach((s) => {
        if (s.id !== "settingsSection" && s.id !== "videoSection" && s.id !== "chatSection") {
          s.style.display = "block";
        }
      });
    });
  }

  if (saveSettingsBtn) {
    saveSettingsBtn.addEventListener("click", async () => {
      const username = document.getElementById("dashUsername")?.value.trim() || "";
      const fullName = document.getElementById("dashFullName")?.value.trim() || "";
      const ageRaw = document.getElementById("dashAge")?.value;
      const age = ageRaw ? Number(ageRaw) : null;
      const gender = document.getElementById("dashGender")?.value || "";
      const avatarUrl = document.getElementById("dashAvatarUrl")?.value.trim() || "";

      if (!isValidUsername(username)) {
        if (settingsStatus) settingsStatus.textContent = "Invalid username (3-24 alphanum/_)";
        return;
      }
      if (!isValidAge(age)) {
        if (settingsStatus) settingsStatus.textContent = "Invalid age (must be 18-100)";
        return;
      }
      if (!isValidGender(gender)) {
        if (settingsStatus) settingsStatus.textContent = "Invalid gender selection";
        return;
      }

      if (settingsStatus) settingsStatus.textContent = "Saving...";

      const { error } = await supabase.from("profiles").upsert(
        {
          id: user.id,
          username,
          full_name: fullName,
          "full name": fullName,
          avatar_url: avatarUrl,
          "avatar url": avatarUrl,
          age,
          gender
        },
        { onConflict: "id" }
      );

      if (error) {
        if (settingsStatus) settingsStatus.textContent = "Error: " + error.message;
        return;
      }

      if (settingsStatus) settingsStatus.textContent = "Saved successfully!";
      await loadUser();
    });
  }
}
