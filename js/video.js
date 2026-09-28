import { supabase } from "./supabaseClient.js";

const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
  ]
};

export function initVideoChat() {
  const findPartnerBtn = document.getElementById("findPartnerBtn");
  const nextPartnerBtn = document.getElementById("nextPartnerBtn");
  const leaveVideoBtn = document.getElementById("leaveVideoBtn");
  const backFromVideoBtn = document.getElementById("backFromVideoBtn");
  const openVideoBtn = document.getElementById("openVideoBtn");
  const videoStatus = document.getElementById("videoStatus");
  const localVideo = document.getElementById("localVideo");
  const remoteVideo = document.getElementById("remoteVideo");

  if (!findPartnerBtn || !videoStatus || !localVideo || !remoteVideo) return;

  let localStream = null;
  let peerConnection = null;
  let signalingChannel = null;
  let queueChannel = null;
  let waitingRetryTimer = null;
  let heartbeatTimer = null;
  let connectionTimeoutTimer = null;
  let currentSessionId = null;
  let isCaller = false;
  let leaving = false;
  let isHandshakeComplete = false;

  async function startCamera() {
    if (localStream) return true;

    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localVideo.srcObject = localStream;
      return true;
    } catch (error) {
      console.error("Camera error:", error);
      videoStatus.textContent = "Camera or microphone permission is required.";
      return false;
    }
  }

  function stopCamera() {
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
      localStream = null;
    }
    localVideo.srcObject = null;
  }

  function clearTimers() {
    if (waitingRetryTimer) {
      clearInterval(waitingRetryTimer);
      waitingRetryTimer = null;
    }
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (connectionTimeoutTimer) {
      clearTimeout(connectionTimeoutTimer);
      connectionTimeoutTimer = null;
    }
  }

  function startHeartbeat() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(async () => {
      try {
        await supabase.rpc("touch_video_queue");
      } catch (err) {
        console.error("Heartbeat error:", err);
      }
    }, 10000);
  }

  function unsubscribeQueueChannel() {
    if (queueChannel) {
      supabase.removeChannel(queueChannel);
      queueChannel = null;
    }
  }

  function unsubscribeSignalingChannel() {
    if (signalingChannel) {
      supabase.removeChannel(signalingChannel);
      signalingChannel = null;
    }
  }

  function closePeerConnection() {
    if (peerConnection) {
      peerConnection.onicecandidate = null;
      peerConnection.ontrack = null;
      peerConnection.onconnectionstatechange = null;
      peerConnection.close();
      peerConnection = null;
    }
    remoteVideo.srcObject = null;
  }

  function resetCallState() {
    clearTimers();
    unsubscribeQueueChannel();
    unsubscribeSignalingChannel();
    closePeerConnection();
    currentSessionId = null;
    isCaller = false;
    isHandshakeComplete = false;
  }

  function createPeerConnection() {
    const pc = new RTCPeerConnection(ICE_SERVERS);

    if (localStream) {
      localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
    }

    pc.ontrack = (event) => {
      remoteVideo.srcObject = event.streams[0];
      videoStatus.textContent = "Connected.";
      if (connectionTimeoutTimer) {
        clearTimeout(connectionTimeoutTimer);
        connectionTimeoutTimer = null;
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && signalingChannel) {
        signalingChannel.send({
          type: "broadcast",
          event: "signal",
          payload: { kind: "ice-candidate", candidate: event.candidate }
        });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        videoStatus.textContent = "Connected.";
        if (connectionTimeoutTimer) {
          clearTimeout(connectionTimeoutTimer);
          connectionTimeoutTimer = null;
        }
      } else if (["disconnected", "failed", "closed"].includes(pc.connectionState)) {
        videoStatus.textContent = "Connection lost. Reconnecting...";
      }
    };

    return pc;
  }

  async function sendOffer() {
    if (!peerConnection || !signalingChannel) return;
    try {
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      signalingChannel.send({
        type: "broadcast",
        event: "signal",
        payload: { kind: "offer", sdp: offer }
      });
    } catch (err) {
      console.error("Offer creation error:", err);
    }
  }

  async function startSignaling(sessionId, partnerId, asCaller) {
    currentSessionId = sessionId;
    isCaller = asCaller;
    isHandshakeComplete = false;
    videoStatus.textContent = "Partner found. Performing handshake...";

    const cameraReady = await startCamera();
    if (!cameraReady) return;

    peerConnection = createPeerConnection();
    startHeartbeat();

    // 15s connection timeout
    connectionTimeoutTimer = setTimeout(async () => {
      if (!peerConnection || peerConnection.connectionState !== "connected") {
        videoStatus.textContent = "Connection timed out. Retrying...";
        await nextVideoPartner();
      }
    }, 15000);

    signalingChannel = supabase.channel("video-" + sessionId, {
      config: { broadcast: { self: false } }
    });

    signalingChannel.on("broadcast", { event: "signal" }, async ({ payload }) => {
      if (!peerConnection || !payload) return;

      if (payload.kind === "ready") {
        // Partner is ready, acknowledge
        signalingChannel.send({
          type: "broadcast",
          event: "signal",
          payload: { kind: "ack" }
        });
        if (isCaller && !isHandshakeComplete) {
          isHandshakeComplete = true;
          videoStatus.textContent = "Connecting video...";
          await sendOffer();
        }
      } else if (payload.kind === "ack") {
        // Handshake acknowledged
        isHandshakeComplete = true;
        videoStatus.textContent = "Connecting video...";
        if (isCaller) {
          await sendOffer();
        }
      } else if (payload.kind === "offer") {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        signalingChannel.send({
          type: "broadcast",
          event: "signal",
          payload: { kind: "answer", sdp: answer }
        });
      } else if (payload.kind === "answer") {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      } else if (payload.kind === "ice-candidate") {
        try {
          await peerConnection.addIceCandidate(payload.candidate);
        } catch (error) {
          console.error("ICE candidate error:", error);
        }
      } else if (payload.kind === "partner-left") {
        videoStatus.textContent = "Partner left the call.";
        closePeerConnection();
        unsubscribeSignalingChannel();
        currentSessionId = null;
      }
    });

    signalingChannel.subscribe(async (status) => {
      if (status === "SUBSCRIBED" && signalingChannel) {
        // Send ready handshake
        signalingChannel.send({
          type: "broadcast",
          event: "signal",
          payload: { kind: "ready" }
        });
      }
    });
  }

  function listenForMatch(userId) {
    queueChannel = supabase
      .channel("queue-" + userId)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "video_queue", filter: "user_id=eq." + userId },
        (payload) => {
          const row = payload.new;
          if (row.status === "matched" && row.session_id) {
            clearTimers();
            unsubscribeQueueChannel();
            startSignaling(row.session_id, row.partner_id, false);
          }
        }
      )
      .subscribe();
  }

  async function findVideoPartner() {
    const userResult = await supabase.auth.getUser();
    const currentUser = userResult.data.user;

    if (!currentUser) {
      window.location.href = "/";
      return;
    }

    const cameraReady = await startCamera();
    if (!cameraReady) return;

    videoStatus.textContent = "Cleaning up stale queue & searching...";

    // Run secure cleanup RPC for stale waiting/matched entries
    try {
      await supabase.rpc("cleanup_video_queue", {
        p_waiting_timeout_seconds: 30,
        p_matched_timeout_seconds: 60
      });
    } catch (err) {
      console.error("Cleanup queue error:", err);
    }

    const joinResult = await supabase.from("video_queue").upsert(
      { user_id: currentUser.id, status: "waiting", session_id: null, partner_id: null, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );

    if (joinResult.error) {
      console.error("Queue error:", joinResult.error);
      videoStatus.textContent = "Could not join the video queue.";
      return;
    }

    startHeartbeat();
    listenForMatch(currentUser.id);

    async function tryMatch() {
      // Touch heartbeat
      await supabase.rpc("touch_video_queue").catch(() => {});

      const partnerResult = await supabase.rpc("find_video_partner");

      if (partnerResult.error) {
        console.error("Partner error:", partnerResult.error);
        return;
      }

      const partners = partnerResult.data || [];

      if (partners.length > 0) {
        clearTimers();
        unsubscribeQueueChannel();
        startSignaling(partners[0].session_id, partners[0].partner_id, true);
      } else {
        videoStatus.textContent = "No partner yet. Waiting...";
      }
    }

    await tryMatch();

    if (!currentSessionId) {
      waitingRetryTimer = setInterval(tryMatch, 4000);
    }
  }

  async function leaveVideoQueue() {
    if (leaving) return;
    leaving = true;

    const userResult = await supabase.auth.getUser();
    const currentUser = userResult.data.user;

    if (signalingChannel && currentSessionId) {
      signalingChannel.send({
        type: "broadcast",
        event: "signal",
        payload: { kind: "partner-left" }
      });
    }

    if (currentUser) {
      await supabase.from("video_queue").delete().eq("user_id", currentUser.id);
    }

    resetCallState();
    stopCamera();
    videoStatus.textContent = "Left video chat.";
    leaving = false;
  }

  async function nextVideoPartner() {
    await leaveVideoQueue();
    videoStatus.textContent = "Looking for a new partner...";
    await findVideoPartner();
  }

  findPartnerBtn.addEventListener("click", findVideoPartner);
  nextPartnerBtn?.addEventListener("click", nextVideoPartner);
  leaveVideoBtn?.addEventListener("click", leaveVideoQueue);

  backFromVideoBtn?.addEventListener("click", async () => {
    await leaveVideoQueue();
    const videoSection = document.getElementById("videoSection");
    if (videoSection) videoSection.style.display = "none";
    document.querySelectorAll(".home-section").forEach((section) => {
      if (section.id !== "videoSection" && section.id !== "settingsSection" && section.id !== "chatSection") {
        section.style.display = "block";
      }
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  openVideoBtn?.addEventListener("click", () => {
    document.querySelectorAll(".home-section").forEach((section) => {
      section.style.display = "none";
    });
    const videoSection = document.getElementById("videoSection");
    if (videoSection) {
      videoSection.style.display = "block";
      videoSection.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });

  window.addEventListener("beforeunload", () => {
    if (currentSessionId && signalingChannel) {
      signalingChannel.send({
        type: "broadcast",
        event: "signal",
        payload: { kind: "partner-left" }
      });
    }
  });
}
