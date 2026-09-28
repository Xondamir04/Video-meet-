import { supabase } from "./supabaseClient.js";
import { el, profileAvatar, profileDisplayName } from "./dom.js";

export async function likeUser(profileId) {
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return { error: new Error("Not signed in") };

  const result = await supabase.from("likes").insert({
    from_user: user.id,
    to_user: profileId
  });

  if (result.error && result.error.code === "23505") {
    return { error: null, duplicate: true };
  }

  return result;
}

export function renderMatchingCard(profile, labels, onLiked) {
  const likeButton = el("button", { class: "like-btn", type: "button", text: labels.like });
  const nextButton = el("button", { class: "next-btn", type: "button", text: labels.next });
  const card = el("div", { class: "person-card" }, [
    el("img", {
      class: "person-avatar",
      src: profileAvatar(profile),
      alt: profileDisplayName(profile, "")
    }),
    el("h3", { text: profileDisplayName(profile, "") }),
    profile.username ? el("p", { text: "@" + profile.username }) : null,
    el("p", { text: profile.age ? String(profile.age) : "-" }),
    el("div", { class: "actions" }, [likeButton, nextButton])
  ]);

  likeButton.addEventListener("click", async () => {
    const result = await likeUser(profile.id);
    if (result.error) {
      console.error(result.error);
      return;
    }
    likeButton.textContent = labels.like;
    likeButton.disabled = true;
    if (onLiked) onLiked(profile, result.duplicate);
  });

  nextButton.addEventListener("click", () => {
    card.remove();
  });

  return card;
}

export async function loadMatchingProfiles(grid, empty, labels) {
  const result = await supabase.rpc("get_matching_profiles");

  grid.replaceChildren();

  if (result.error) {
    console.error(result.error);
    empty.style.display = "block";
    return;
  }

  const profiles = result.data || [];

  if (profiles.length === 0) {
    empty.style.display = "block";
    return;
  }

  empty.style.display = "none";
  profiles.forEach((profile) => {
    grid.appendChild(renderMatchingCard(profile, labels));
  });
}

export function renderMutualMatchCard(profile, labels, onOpenChat, onOpenVideo) {
  const chatBtn = el("button", {
    class: "like-btn",
    type: "button",
    text: labels.chat || "💬 Chat"
  });

  const videoBtn = el("button", {
    class: "next-btn",
    type: "button",
    text: labels.video || "📹 Video"
  });

  const card = el("div", { class: "person-card" }, [
    el("img", {
      class: "person-avatar",
      src: profileAvatar(profile),
      alt: profileDisplayName(profile, "")
    }),
    el("h3", { text: profileDisplayName(profile, "") }),
    profile.username ? el("p", { text: "@" + profile.username }) : null,
    el("p", { text: "💚 Matched" }),
    el("div", { class: "actions" }, [chatBtn, videoBtn])
  ]);

  chatBtn.addEventListener("click", () => {
    if (onOpenChat) onOpenChat(profile);
  });

  videoBtn.addEventListener("click", () => {
    if (onOpenVideo) onOpenVideo(profile);
  });

  return card;
}

export async function loadMutualMatches(grid, empty, labels, onOpenChat, onOpenVideo) {
  if (!grid) return;
  const result = await supabase.rpc("get_mutual_matches");

  grid.replaceChildren();

  if (result.error) {
    console.error(result.error);
    if (empty) empty.style.display = "block";
    return;
  }

  const matches = result.data || [];

  if (matches.length === 0) {
    if (empty) empty.style.display = "block";
    return;
  }

  if (empty) empty.style.display = "none";
  matches.forEach((profile) => {
    grid.appendChild(renderMutualMatchCard(profile, labels, onOpenChat, onOpenVideo));
  });
}
