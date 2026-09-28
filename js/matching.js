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
  const likeButton = el("button", { class: "like-btn", type: "button", text: labels.like || "Like" });
  const nextButton = el("button", { class: "next-btn", type: "button", text: labels.next || "Next" });
  const card = el("div", { class: "person-card" }, [
    el("img", {
      class: "person-avatar",
      src: profileAvatar(profile, "https://i.pravatar.cc/150"),
      alt: profileDisplayName(profile, "")
    }),
    el("h3", { text: profileDisplayName(profile, "") }),
    profile.username ? el("p", { text: "@" + profile.username }) : null,
    el("p", { text: profile.age ? String(profile.age) + " yrs" : "-" }),
    el("div", { class: "actions" }, [likeButton, nextButton])
  ]);

  likeButton.addEventListener("click", async () => {
    likeButton.disabled = true;
    const result = await likeUser(profile.id);
    if (result.error) {
      console.error(result.error);
      likeButton.disabled = false;
      return;
    }
    likeButton.textContent = "❤️ " + (labels.like || "Liked");
    if (onLiked) onLiked(profile, result.duplicate);
  });

  nextButton.addEventListener("click", () => {
    card.remove();
  });

  return card;
}

export function renderMutualMatchCard(profile, labels, onChat, onVideo) {
  const chatButton = el("button", { class: "like-btn", type: "button", text: "💬 " + (labels.chat || "Chat") });
  const videoButton = el("button", { class: "next-btn", type: "button", text: "📹 " + (labels.video || "Video") });

  const card = el("div", { class: "person-card" }, [
    el("img", {
      class: "person-avatar",
      src: profileAvatar(profile, "https://i.pravatar.cc/150"),
      alt: profileDisplayName(profile, "")
    }),
    el("h3", { text: profileDisplayName(profile, "") }),
    profile.username ? el("p", { text: "@" + profile.username }) : null,
    el("p", { text: profile.age ? String(profile.age) + " yrs" : "-" }),
    el("div", { class: "actions" }, [chatButton, videoButton])
  ]);

  chatButton.addEventListener("click", () => {
    if (onChat) onChat(profile);
  });

  videoButton.addEventListener("click", () => {
    if (onVideo) onVideo(profile);
  });

  return card;
}

export async function loadMatchingProfiles(grid, empty, labels, onLiked) {
  const result = await supabase.rpc("get_matching_profiles");

  grid.replaceChildren();

  if (result.error) {
    console.error("Error loading matching profiles:", result.error);
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
    grid.appendChild(renderMatchingCard(profile, labels, onLiked));
  });
}

export async function loadMutualMatches(grid, empty, labels, onChat, onVideo) {
  const result = await supabase.rpc("get_mutual_matches");

  grid.replaceChildren();

  if (result.error) {
    console.error("Error loading mutual matches:", result.error);
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
    grid.appendChild(renderMutualMatchCard(profile, labels, onChat, onVideo));
  });
}
