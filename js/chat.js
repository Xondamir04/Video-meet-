import { supabase } from "./supabaseClient.js";
import { el, profileAvatar, profileDisplayName } from "./dom.js";

let activePartner = null;
let currentUser = null;
let chatChannel = null;

export async function initChat(user) {
  currentUser = user;

  const backFromChatBtn = document.getElementById("backFromChatBtn");
  const chatSection = document.getElementById("chatSection");
  const messageInput = document.getElementById("chatMessageInput");
  const sendBtn = document.getElementById("sendMessageBtn");
  const charCounter = document.getElementById("chatCharCounter");
  const statusEl = document.getElementById("chatStatus");

  if (backFromChatBtn && chatSection) {
    backFromChatBtn.addEventListener("click", () => {
      chatSection.style.display = "none";
      if (chatChannel) {
        supabase.removeChannel(chatChannel);
        chatChannel = null;
      }
      document.querySelectorAll(".home-section").forEach((s) => {
        if (s.id !== "settingsSection" && s.id !== "videoSection" && s.id !== "chatSection") {
          s.style.display = "block";
        }
      });
    });
  }

  if (messageInput && charCounter) {
    messageInput.addEventListener("input", () => {
      const len = messageInput.value.length;
      charCounter.textContent = `${len} / 2000`;
      if (sendBtn) {
        sendBtn.disabled = !activePartner || len === 0 || len > 2000;
      }
    });

    messageInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
  }

  if (sendBtn) {
    sendBtn.addEventListener("click", sendMessage);
  }

  await refreshChatMatchesList();
}

export async function refreshChatMatchesList() {
  const listContainer = document.getElementById("chatMatchesList");
  if (!listContainer || !currentUser) return;

  const result = await supabase.rpc("get_mutual_matches");
  listContainer.replaceChildren();

  if (result.error || !result.data || result.data.length === 0) {
    listContainer.appendChild(
      el("div", {
        style: "color:#6b7280;font-size:13px;padding:10px;",
        text: "No mutual matches yet."
      })
    );
    return;
  }

  result.data.forEach((partner) => {
    const item = el(
      "div",
      {
        style:
          "display:flex;align-items:center;gap:10px;padding:10px;border-radius:12px;cursor:pointer;background:" +
          (activePartner?.id === partner.id ? "#eef2ff" : "#f9fafb"),
        onclick: () => openConversation(partner)
      },
      [
        el("img", {
          src: profileAvatar(partner),
          alt: profileDisplayName(partner, ""),
          style: "width:36px;height:36px;border-radius:50%;object-fit:cover;"
        }),
        el("div", { style: "overflow:hidden;" }, [
          el("div", {
            style: "font-weight:bold;font-size:14px;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;",
            text: profileDisplayName(partner, "")
          }),
          partner.username
            ? el("div", { style: "font-size:12px;color:#6b7280;", text: "@" + partner.username })
            : null
        ])
      ]
    );
    listContainer.appendChild(item);
  });
}

export async function openConversation(partner) {
  if (!currentUser) return;
  activePartner = partner;

  const chatSection = document.getElementById("chatSection");
  if (chatSection) {
    document.querySelectorAll(".home-section").forEach((s) => (s.style.display = "none"));
    chatSection.style.display = "block";
    chatSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const activeHeader = document.getElementById("activeChatHeader");
  const messageInput = document.getElementById("chatMessageInput");
  const sendBtn = document.getElementById("sendMessageBtn");
  const container = document.getElementById("chatMessagesContainer");

  if (activeHeader) {
    activeHeader.replaceChildren(
      el("div", { style: "display:flex;align-items:center;gap:10px;" }, [
        el("img", {
          src: profileAvatar(partner),
          alt: profileDisplayName(partner, ""),
          style: "width:32px;height:32px;border-radius:50%;object-fit:cover;"
        }),
        el("span", { text: profileDisplayName(partner, "") }),
        partner.username ? el("span", { style: "color:#6b7280;font-size:13px;", text: "(@ " + partner.username + ")" }) : null
      ])
    );
  }

  if (messageInput) {
    messageInput.disabled = false;
    messageInput.value = "";
    messageInput.focus();
  }
  if (sendBtn) {
    sendBtn.disabled = true;
  }

  if (container) {
    container.replaceChildren(
      el("div", { style: "text-align:center;color:#6b7280;padding:20px;", text: "Loading messages..." })
    );
  }

  await refreshChatMatchesList();

  // Load message history
  const { data: messages, error } = await supabase
    .from("messages")
    .select("*")
    .or(
      `and(sender_id.eq.${currentUser.id},receiver_id.eq.${partner.id}),and(sender_id.eq.${partner.id},receiver_id.eq.${currentUser.id})`
    )
    .order("created_at", { ascending: true });

  if (container) {
    container.replaceChildren();
    if (error) {
      console.error(error);
      container.appendChild(
        el("div", { style: "color:#ef4444;text-align:center;padding:10px;", text: "Failed to load messages." })
      );
    } else if (!messages || messages.length === 0) {
      container.appendChild(
        el("div", { style: "text-align:center;color:#6b7280;padding:20px;", text: "No messages yet. Say hi!" })
      );
    } else {
      messages.forEach((msg) => appendMessage(msg));
    }
    container.scrollTop = container.scrollHeight;
  }

  // Subscribe to Realtime messages
  if (chatChannel) {
    supabase.removeChannel(chatChannel);
  }

  chatChannel = supabase
    .channel(`messages-${currentUser.id}-${partner.id}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages" },
      (payload) => {
        const msg = payload.new;
        if (
          (msg.sender_id === currentUser.id && msg.receiver_id === partner.id) ||
          (msg.sender_id === partner.id && msg.receiver_id === currentUser.id)
        ) {
          appendMessage(msg);
        }
      }
    )
    .subscribe();
}

function appendMessage(msg) {
  const container = document.getElementById("chatMessagesContainer");
  if (!container) return;

  const isMe = msg.sender_id === currentUser?.id;
  const timeStr = msg.created_at ? new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "";

  const msgBubble = el(
    "div",
    {
      style: `max-width:70%;padding:10px 14px;border-radius:16px;margin-bottom:8px;font-size:14px;line-height:1.4;word-break:break-word;align-self:${
        isMe ? "flex-end" : "flex-start"
      };background:${isMe ? "#2563eb" : "#ffffff"};color:${isMe ? "#ffffff" : "#111827"};border:${
        isMe ? "none" : "1px solid #e5e7eb"
      };box-shadow:0 1px 2px rgba(0,0,0,0.05);`
    },
    [
      el("div", { text: msg.content }),
      el("div", {
        style: `font-size:10px;margin-top:4px;text-align:right;opacity:0.75;color:${isMe ? "#ffffff" : "#6b7280"};`,
        text: timeStr
      })
    ]
  );

  container.appendChild(msgBubble);
  container.scrollTop = container.scrollHeight;
}

async function sendMessage() {
  const input = document.getElementById("chatMessageInput");
  const sendBtn = document.getElementById("sendMessageBtn");
  const statusEl = document.getElementById("chatStatus");

  if (!input || !activePartner || !currentUser) return;
  const content = input.value.trim();

  if (!content || content.length > 2000) return;

  if (sendBtn) sendBtn.disabled = true;
  if (statusEl) statusEl.textContent = "Sending...";

  const { error } = await supabase.from("messages").insert({
    sender_id: currentUser.id,
    receiver_id: activePartner.id,
    content: content
  });

  if (error) {
    console.error("Message send error:", error);
    if (statusEl) statusEl.textContent = "Error: " + error.message;
    if (sendBtn) sendBtn.disabled = false;
    return;
  }

  input.value = "";
  const charCounter = document.getElementById("chatCharCounter");
  if (charCounter) charCounter.textContent = "0 / 2000";
  if (statusEl) statusEl.textContent = "";
}
