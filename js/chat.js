import { supabase } from "./supabaseClient.js";
import { el, profileAvatar, profileDisplayName } from "./dom.js";

let currentUserId = null;
let activePartner = null;
let realtimeChannel = null;

export async function initChatModule() {
  const userResult = await supabase.auth.getUser();
  currentUserId = userResult.data.user?.id || null;
}

export async function loadMutualMatchesForChat(container, emptyEl, labels) {
  if (!currentUserId) return [];

  const result = await supabase.rpc("get_mutual_matches");
  container.replaceChildren();

  if (result.error) {
    console.error("Error loading mutual matches for chat:", result.error);
    if (emptyEl) emptyEl.style.display = "block";
    return [];
  }

  const matches = result.data || [];

  if (matches.length === 0) {
    if (emptyEl) emptyEl.style.display = "block";
    return [];
  }

  if (emptyEl) emptyEl.style.display = "none";

  matches.forEach((partner) => {
    const item = el("div", {
      class: "chat-user-item",
      style: "display:flex;align-items:center;gap:10px;padding:12px;border-radius:12px;cursor:pointer;background:#f9fafb;margin-bottom:8px;border:1px solid #e5e7eb;"
    }, [
      el("img", {
        src: profileAvatar(partner, "https://i.pravatar.cc/100"),
        style: "width:42px;height:42px;border-radius:50%;object-fit:cover;"
      }),
      el("div", { style: "flex:1;min-width:0;" }, [
        el("div", { style: "font-weight:bold;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;", text: profileDisplayName(partner) }),
        partner.username ? el("div", { style: "font-size:12px;color:#6b7280;", text: "@" + partner.username }) : null
      ])
    ]);

    item.addEventListener("click", () => {
      document.querySelectorAll(".chat-user-item").forEach((el) => {
        el.style.background = "#f9fafb";
        el.style.borderColor = "#e5e7eb";
      });
      item.style.background = "#eef2ff";
      item.style.borderColor = "#2563eb";
      selectChatPartner(partner, labels);
    });

    container.appendChild(item);
  });

  return matches;
}

export async function selectChatPartner(partner, labels) {
  activePartner = partner;

  const chatHeader = document.getElementById("chatHeader");
  const chatMessages = document.getElementById("chatMessages");
  const chatForm = document.getElementById("chatForm");

  if (chatHeader) {
    chatHeader.replaceChildren(
      el("div", { style: "display:flex;align-items:center;gap:12px;" }, [
        el("img", {
          src: profileAvatar(partner, "https://i.pravatar.cc/100"),
          style: "width:40px;height:40px;border-radius:50%;object-fit:cover;"
        }),
        el("div", {}, [
          el("strong", { style: "font-size:16px;", text: profileDisplayName(partner) }),
          partner.username ? el("div", { style: "font-size:12px;color:#6b7280;", text: "@" + partner.username }) : null
        ])
      ])
    );
  }

  if (chatForm) {
    chatForm.style.display = "flex";
  }

  if (chatMessages) {
    chatMessages.replaceChildren();
  }

  await loadMessages(partner.id);
  subscribeToMessages(partner.id);
}

async function loadMessages(partnerId) {
  const chatMessages = document.getElementById("chatMessages");
  if (!chatMessages || !currentUserId) return;

  const result = await supabase
    .from("messages")
    .select("id, sender_id, receiver_id, content, created_at")
    .or(
      `and(sender_id.eq.${currentUserId},receiver_id.eq.${partnerId}),and(sender_id.eq.${partnerId},receiver_id.eq.${currentUserId})`
    )
    .order("created_at", { ascending: true })
    .limit(100);

  if (result.error) {
    console.error("Error loading messages:", result.error);
    return;
  }

  const messages = result.data || [];
  messages.forEach((msg) => {
    appendMessage(msg);
  });

  scrollToBottom();
}

function appendMessage(msg) {
  const chatMessages = document.getElementById("chatMessages");
  if (!chatMessages) return;

  const isMe = msg.sender_id === currentUserId;
  const msgBubble = el("div", {
    style: `max-width:70%;padding:10px 14px;border-radius:16px;margin-bottom:10px;word-break:break-word;font-size:14px;line-height:1.4;${
      isMe
        ? "margin-left:auto;background:#2563eb;color:white;border-bottom-right-radius:4px;"
        : "margin-right:auto;background:#f3f4f6;color:#111827;border-bottom-left-radius:4px;"
    }`
  }, [
    el("div", { text: msg.content }),
    el("div", {
      style: `font-size:10px;margin-top:4px;text-align:right;${isMe ? "color:rgba(255,255,255,0.75);" : "color:#9ca3af;"}`,
      text: msg.created_at ? new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""
    })
  ]);

  chatMessages.appendChild(msgBubble);
  scrollToBottom();
}

function scrollToBottom() {
  const chatMessages = document.getElementById("chatMessages");
  if (chatMessages) {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
}

function subscribeToMessages(partnerId) {
  if (realtimeChannel) {
    supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }

  realtimeChannel = supabase
    .channel("chat-" + partnerId)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages"
      },
      (payload) => {
        const newMsg = payload.new;
        if (
          (newMsg.sender_id === currentUserId && newMsg.receiver_id === partnerId) ||
          (newMsg.sender_id === partnerId && newMsg.receiver_id === currentUserId)
        ) {
          // Prevent duplicates if already appended locally
          const existing = document.querySelector(`[data-msg-id="${newMsg.id}"]`);
          if (!existing) {
            appendMessage(newMsg);
          }
        }
      }
    )
    .subscribe();
}

export async function sendMessage(content) {
  const trimmed = content.trim();
  if (!trimmed || !activePartner || !currentUserId) return { error: new Error("Invalid parameters") };

  if (trimmed.length > 2000) {
    return { error: new Error("Message exceeds maximum length of 2000 characters.") };
  }

  const result = await supabase.from("messages").insert({
    sender_id: currentUserId,
    receiver_id: activePartner.id,
    content: trimmed
  }).select().single();

  if (result.error) {
    console.error("Error sending message:", result.error);
    return result;
  }

  if (result.data) {
    appendMessage(result.data);
  }

  return { error: null };
}

export function cleanupChat() {
  if (realtimeChannel) {
    supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
  activePartner = null;
}
