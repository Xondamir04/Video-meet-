import { supabase } from "./supabaseClient.js";
import { profileAvatar, profileDisplayName, isValidAge, isValidGender, isValidUsername } from "./dom.js";
import {
  applyDocumentLanguage,
  dashboardTranslations,
  getSavedLanguage,
  saveLanguage
} from "./i18n.js";
import { loadMatchingProfiles, loadMutualMatches } from "./matching.js";
import { initChatModule, loadMutualMatchesForChat, selectChatPartner, sendMessage, cleanupChat } from "./chat.js";

function t(language) {
  return dashboardTranslations[language] || dashboardTranslations.uz;
}

function applyDashboardLanguage(language) {
  const copy = t(language);
  applyDocumentLanguage(language);
  saveLanguage(language);

  const welcomeText = document.getElementById("welcomeText");
  const matchingTitle = document.getElementById("matchingTitle");
  const matchingSubtitle = document.getElementById("matchingSubtitle");
  const empty = document.getElementById("emptyMessage");
  const mutualMatchesTitle = document.getElementById("mutualMatchesTitle");
  const emptyMatchesMessage = document.getElementById("emptyMatchesMessage");
  const chatTitle = document.getElementById("chatTitle");
  const chatMatchesHeading = document.getElementById("chatMatchesHeading");
  const chatSelectPrompt = document.getElementById("chatSelectPrompt");
  const noChatMatches = document.getElementById("noChatMatches");
  const settingsTitle = document.getElementById("settingsTitle");
  const settingsUsernameLabel = document.getElementById("settingsUsernameLabel");
  const settingsFullNameLabel = document.getElementById("settingsFullNameLabel");
  const settingsAgeLabel = document.getElementById("settingsAgeLabel");
  const settingsGenderLabel = document.getElementById("settingsGenderLabel");
  const settingsAvatarLabel = document.getElementById("settingsAvatarLabel");
  const saveSettingsBtn = document.getElementById("saveSettingsBtn");
  const storiesTitle = document.getElementById("storiesTitle");
  const seeAllStories = document.getElementById("seeAllStories");
  const storyYouText = document.getElementById("storyYouText");

  if (welcomeText) welcomeText.textContent = copy.welcome || "Welcome to Video Meet";
  if (matchingTitle) matchingTitle.textContent = copy.matching || "People for You";
  if (matchingSubtitle) matchingSubtitle.textContent = copy.subtitle || "Find new people who match you.";
  if (empty) empty.textContent = copy.empty || "No matching people found yet.";
  if (mutualMatchesTitle) mutualMatchesTitle.textContent = copy.matches || "Your Mutual Matches";
  if (emptyMatchesMessage) emptyMatchesMessage.textContent = copy.noMutualMatches || "No mutual matches yet.";
  if (chatTitle) chatTitle.textContent = copy.chat || "Chat";
  if (chatMatchesHeading) chatMatchesHeading.textContent = copy.matches || "Mutual Matches";
  if (chatSelectPrompt) chatSelectPrompt.textContent = copy.selectChatPartnerPrompt || "Select a match to start chatting";
  if (noChatMatches) noChatMatches.textContent = copy.noMutualMatches || "No mutual matches yet.";
  if (settingsTitle) settingsTitle.textContent = copy.settings || "Profile Settings";
  if (settingsUsernameLabel) settingsUsernameLabel.textContent = copy.username || "Username";
  if (settingsFullNameLabel) settingsFullNameLabel.textContent = copy.name || "Full Name";
  if (settingsAgeLabel) settingsAgeLabel.textContent = copy.age || "Age";
  if (settingsGenderLabel) settingsGenderLabel.textContent = copy.gender || "Gender";
  if (settingsAvatarLabel) settingsAvatarLabel.textContent = copy.avatarUrl || "Avatar URL";
  if (saveSettingsBtn) saveSettingsBtn.textContent = copy.save || "Save Settings";
  if (storiesTitle) storiesTitle.textContent = copy.stories || "Stories";
  if (seeAllStories) seeAllStories.textContent = copy.seeAll || "See all";
  if (storyYouText) storyYouText.textContent = copy.you || "You";

  const navHomeBtn = document.getElementById("navHomeBtn");
  const navMatchesBtn = document.getElementById("navMatchesBtn");
  const openVideoBtn = document.getElementById("openVideoBtn");
  const navChatBtn = document.getElementById("navChatBtn");
  const navStoriesBtn = document.getElementById("navStoriesBtn");
  const navVipBtn = document.getElementById("navVipBtn");
  const navSettingsBtn = document.getElementById("navSettingsBtn");
  const logoutBtn = document.getElementById("logoutBtn");

  if (navHomeBtn) navHomeBtn.textContent = "🏠 " + (copy.home || "Home");
  if (navMatchesBtn) navMatchesBtn.textContent = "❤️ " + (copy.matches || "Matches");
  if (openVideoBtn) openVideoBtn.textContent = "📹 " + (copy.video || "Video");
  if (navChatBtn) navChatBtn.textContent = "💬 " + (copy.chat || "Chat");
  if (navStoriesBtn) navStoriesBtn.textContent = "📖 " + (copy.stories || "Stories");
  if (navVipBtn) navVipBtn.textContent = "💎 " + (copy.vip || "VIP");
  if (navSettingsBtn) navSettingsBtn.textContent = "⚙️ " + (copy.settings || "Settings");
  if (logoutBtn) logoutBtn.textContent = "🚪 " + (copy.logout || "Logout");
}

let currentUser = null;
let currentProfile = null;

async function loadUser() {
  const result = await supabase.auth.getUser();
  currentUser = result.data.user;

  if (!currentUser) {
    window.location.href = "/";
    return null;
  }

  const profileResult = await supabase
    .from("profiles")
    .select('id, username, "full name", full_name, "avatar url", avatar_url, age, gender')
    .eq("id", currentUser.id)
    .maybeSingle();

  if (profileResult.error) {
    console.error(profileResult.error);
    return currentUser;
  }

  currentProfile = profileResult.data || {};
  const userName = document.getElementById("userName");
  const userAvatar = document.getElementById("userAvatar");
  const storyUserAvatar = document.getElementById("storyUserAvatar");

  const displayName = profileDisplayName(currentProfile, currentUser.user_metadata?.full_name || "User");
  const avatar = profileAvatar(
    currentProfile,
    currentUser.user_metadata?.avatar_url || currentUser.user_metadata?.picture || "https://i.pravatar.cc/150"
  );

  if (userName) userName.textContent = displayName;
  if (userAvatar) userAvatar.src = avatar;
  if (storyUserAvatar) storyUserAvatar.src = avatar;

  if (!currentProfile.age || !currentProfile.gender || !currentProfile.username) {
    window.location.href = "/";
    return null;
  }

  populateSettingsForm(currentProfile, currentUser);

  return currentUser;
}

function populateSettingsForm(profile, user) {
  const settingUsername = document.getElementById("settingUsername");
  const settingFullName = document.getElementById("settingFullName");
  const settingAge = document.getElementById("settingAge");
  const settingGender = document.getElementById("settingGender");
  const settingAvatar = document.getElementById("settingAvatar");

  if (settingUsername) settingUsername.value = profile.username || "";
  if (settingFullName) settingFullName.value = profile.full_name || profile["full name"] || user.user_metadata?.full_name || "";
  if (settingAge) settingAge.value = profile.age || "";
  if (settingGender) settingGender.value = profile.gender || "";
  if (settingAvatar) settingAvatar.value = profile.avatar_url || profile["avatar url"] || user.user_metadata?.avatar_url || "";
}

async function saveSettings() {
  if (!currentUser) return;

  const copy = t(document.getElementById("languageSelect")?.value || "uz");
  const statusEl = document.getElementById("settingsStatus");

  const username = document.getElementById("settingUsername")?.value.trim() || "";
  const fullName = document.getElementById("settingFullName")?.value.trim() || "";
  const age = Number(document.getElementById("settingAge")?.value);
  const gender = document.getElementById("settingGender")?.value || "";
  const avatarUrl = document.getElementById("settingAvatar")?.value.trim() || "";

  if (statusEl) statusEl.textContent = copy.saving || "Saving...";

  if (!isValidUsername(username)) {
    if (statusEl) statusEl.textContent = (copy.error || "Error: ") + (copy.usernameHint || "3-24 characters");
    return;
  }

  if (!isValidAge(age)) {
    if (statusEl) statusEl.textContent = (copy.error || "Error: ") + "Age must be between 18 and 100";
    return;
  }

  if (!isValidGender(gender)) {
    if (statusEl) statusEl.textContent = (copy.error || "Error: ") + "Please select valid gender";
    return;
  }

  const updateData = {
    id: currentUser.id,
    username,
    full_name: fullName,
    "full name": fullName,
    age,
    gender,
    avatar_url: avatarUrl,
    "avatar url": avatarUrl
  };

  const result = await supabase.from("profiles").upsert(updateData, { onConflict: "id" });

  if (result.error) {
    if (statusEl) {
      statusEl.textContent = result.error.code === "23505"
        ? (copy.error || "Error: ") + "Username already taken"
        : (copy.error || "Error: ") + result.error.message;
    }
    return;
  }

  if (statusEl) statusEl.textContent = copy.saved || "Settings saved!";
  await loadUser();
}

function showSection(sectionId) {
  const sections = ["homeSection", "matchesSection", "chatSection", "settingsSection", "videoSection"];
  sections.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = id === sectionId ? "block" : "none";
  });

  const navBtns = {
    homeSection: "navHomeBtn",
    matchesSection: "navMatchesBtn",
    videoSection: "openVideoBtn",
    chatSection: "navChatBtn",
    settingsSection: "navSettingsBtn"
  };

  Object.entries(navBtns).forEach(([sec, btnId]) => {
    const btn = document.getElementById(btnId);
    if (btn) {
      if (sec === sectionId) btn.classList.add("active");
      else btn.classList.remove("active");
    }
  });

  const secondaryNav = document.getElementById("secondaryNav");
  if (secondaryNav) secondaryNav.classList.remove("open");
}

export async function initDashboardPage() {
  const languageSelect = document.getElementById("languageSelect");
  const savedLanguage = getSavedLanguage(dashboardTranslations);

  if (languageSelect) {
    languageSelect.value = savedLanguage;
    languageSelect.addEventListener("change", () => {
      const lang = languageSelect.value;
      applyDashboardLanguage(lang);
      refreshData();
    });
  }

  applyDashboardLanguage(savedLanguage);

  document.getElementById("logoutBtn")?.addEventListener("click", async () => {
    cleanupChat();
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

  document.getElementById("navHomeBtn")?.addEventListener("click", () => showSection("homeSection"));
  document.getElementById("navMatchesBtn")?.addEventListener("click", () => {
    showSection("matchesSection");
    refreshMutualMatches();
  });
  document.getElementById("navChatBtn")?.addEventListener("click", () => {
    showSection("chatSection");
    refreshChatSection();
  });
  document.getElementById("navSettingsBtn")?.addEventListener("click", () => showSection("settingsSection"));
  document.getElementById("saveSettingsBtn")?.addEventListener("click", saveSettings);

  const user = await loadUser();
  if (!user) return;

  await initChatModule();

  const chatForm = document.getElementById("chatForm");
  const chatInput = document.getElementById("chatInput");

  if (chatForm && chatInput) {
    chatForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const content = chatInput.value;
      if (!content.trim()) return;

      const res = await sendMessage(content);
      if (!res.error) {
        chatInput.value = "";
      } else {
        alert(res.error.message);
      }
    });
  }

  await refreshData();
}

async function refreshData() {
  const lang = document.getElementById("languageSelect")?.value || "uz";
  const labels = t(lang);

  const matchingGrid = document.getElementById("matchingGrid");
  const emptyMessage = document.getElementById("emptyMessage");
  if (matchingGrid && emptyMessage) {
    await loadMatchingProfiles(matchingGrid, emptyMessage, labels, () => {
      refreshMutualMatches();
    });
  }

  await refreshMutualMatches();
}

async function refreshMutualMatches() {
  const lang = document.getElementById("languageSelect")?.value || "uz";
  const labels = t(lang);

  const mutualGrid = document.getElementById("mutualMatchesGrid");
  const emptyMatchesMessage = document.getElementById("emptyMatchesMessage");

  if (mutualGrid && emptyMatchesMessage) {
    await loadMutualMatches(
      mutualGrid,
      emptyMatchesMessage,
      labels,
      (partner) => {
        showSection("chatSection");
        refreshChatSection(partner);
      },
      (partner) => {
        showSection("videoSection");
      }
    );
  }
}

async function refreshChatSection(selectedPartner = null) {
  const lang = document.getElementById("languageSelect")?.value || "uz";
  const labels = t(lang);

  const userList = document.getElementById("chatUserList");
  const noMatches = document.getElementById("noChatMatches");

  if (userList) {
    const matches = await loadMutualMatchesForChat(userList, noMatches, labels);
    if (selectedPartner) {
      selectChatPartner(selectedPartner, labels);
    } else if (matches.length > 0) {
      selectChatPartner(matches[0], labels);
    }
  }
}
