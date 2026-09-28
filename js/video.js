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
  let currentPartnerId = null;
  let isCaller = false;
  let isPartnerReady = false;
  let leaving = false;

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
    currentPartnerId = null;
    isCaller = false;
    isPartnerReady = false;
  }

  function startHeartbeat(userId) {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(async () => {
      if (!userId) return;
      await supabase
        .from("video_queue")
        .update({ updated_at: new Date().toISOString() })
        .eq("user_id", userId);
    }, 15000);
  }

  function createPeerConnection() {
    const pc = new RTCPeerConnection(ICE_SERVERS);

    if (localStream) {
      localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
    }

    pc.ontrack = (event) => {
      if (connectionTimeoutTimer) {
        clearTimeout(connectionTimeoutTimer);
        connectionTimeoutTimer = null;
      }
      remoteVideo.srcObject = event.streams[0];
      videoStatus.textContent = "Connected.";
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
        if (connectionTimeoutTimer) {
          clearTimeout(connectionTimeoutTimer);
          connectionTimeoutTimer = null;
        }
        videoStatus.textContent = "Connected.";
      } else if (["disconnected", "failed", "closed"].includes(pc.connectionState)) {
        videoStatus.textContent = "Connection lost.";
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
    currentPartnerId = partnerId;
    isCaller = asCaller;
    isPartnerReady = false;
    videoStatus.textContent = "Partner found. Handshaking...";

    const cameraReady = await startCamera();
    if (!cameraReady) return;

    peerConnection = createPeerConnection();

    // Set connection timeout (15s max before retry)
    if (connectionTimeoutTimer) clearTimeout(connectionTimeoutTimer);
    connectionTimeoutTimer = setTimeout(async () => {
      if (peerConnection && peerConnection.connectionState !== "connected") {
        videoStatus.textContent = "Connection timeout. Retrying next partner...";
        await nextVideoPartner();
      }
    }, 15000);

    signalingChannel = supabase.channel("video-" + sessionId, {
      config: { broadcast: { self: false } }
    });

    signalingChannel.on("broadcast", { event: "signal" }, async ({ payload }) => {
      if (!peerConnection || !payload) return;

      if (payload.kind === "ready") {
        isPartnerReady = true;
        // Reply with ACK if received ready
        signalingChannel.send({
          type: "broadcast",
          event: "signal",
          payload: { kind: "ack" }
        });
        if (isCaller) {
          await sendOffer();
        }
      } else if (payload.kind === "ack") {
        isPartnerReady = true;
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
      if (status === "SUBSCRIBED") {
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

    videoStatus.textContent = "Looking for a partner...";

    // Run queue cleanup RPC before searching
    await supabase.rpc("cleanup_stale_video_queue");

    const joinResult = await supabase.from("video_queue").upsert(
      { user_id: currentUser.id, status: "waiting", session_id: null, partner_id: null, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );

    if (joinResult.error) {
      console.error("Queue error:", joinResult.error);
      videoStatus.textContent = "Could not join the video queue.";
      return;
    }

    startHeartbeat(currentUser.id);
    listenForMatch(currentUser.id);

    async function tryMatch() {
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
      await supabase.rpc("cleanup_stale_video_queue");
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
    const homeSection = document.getElementById("homeSection");
    if (homeSection) homeSection.style.display = "block";
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  openVideoBtn?.addEventListener("click", () => {
    const sections = ["homeSection", "matchesSection", "chatSection", "settingsSection", "videoSection"];
    sections.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.display = id === "videoSection" ? "block" : "none";
    });
    const videoSection = document.getElementById("videoSection");
    if (videoSection) {
      videoSection.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });

  window.addEventListener("beforeunload", async () => {
    if (currentSessionId && signalingChannel) {
      signalingChannel.send({
        type: "broadcast",
        event: "signal",
        payload: { kind: "partner-left" }
      });
    }
    const userResult = await supabase.auth.getUser();
    if (userResult.data.user?.id) {
      navigator.sendBeacon && navigator.sendBeacon("/api/leaveQueue");
    }
  });
}
