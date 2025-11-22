// silent-socketio-host.js
import { io } from "socket.io-client";
import { LioranManager, getBaseDBFolder } from "./src/index.js";
import fs from "fs";
import path from "path";
import wrtc from "wrtc";
import fetch from "node-fetch";

/**
 * Configuration
 */
const SIGNALING_URL = process.env.SIGNALING_URL || "https://liorandb-server.onrender.com";
const LIORAN_LOCAL_PORT = process.env.LIORAN_LOCAL_PORT || 2007;
const MAX_ROOM_LEN = 64;

/**
 * Load user.json safely
 */
function loadUserData() {
  try {
    const baseFolder = getBaseDBFolder();
    const filePath = path.join(baseFolder, "user.json");
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

/**
 * Sanitize room name
 */
function sanitizeRoomName(accessKey) {
  if (!accessKey) return "lioran-unknown";
  return String(accessKey)
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .substring(0, MAX_ROOM_LEN);
}

/**
 * Execute DB operation via LioranManager or fallback to local HTTP API
 */
async function executeHttpRequest({ path, method = "GET", body, apiKey }) {
  const url = `http://localhost:2008${path}`;
  const options = {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    timeout: 30_000,
  };

  if (method !== "GET" && body !== undefined) {
    options.body = JSON.stringify(body);
  }

  try {
    const res = await fetch(url, options);
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return { ok: false, error: data.error || `HTTP ${res.status}` };
    }
    return { ok: true, result: data };
  } catch (err) {
    return { ok: false, error: `Fetch failed: ${err.message}` };
  }
}

async function executeOperation(op, payload) {
  // 1. Try LioranManager first (preferred)
  if (typeof LioranManager?.handleOperation === "function") {
    try {
      const result = await LioranManager.handleOperation(op, payload);
      return { ok: true, result };
    } catch (err) {
      // Fall through to HTTP
    }
  }

  // 2. Only "http" operation is supported over P2P
  if (op === "http" && payload?.path) {
    return await executeHttpRequest(payload);
  }

  return { ok: false, error: "unsupported-operation" };
}

/**
 * Main P2P Host (Silent Mode)
 */
export function connectSilentSocketIOHost() {
  const userData = loadUserData();
  if (!userData?.accessKey) {
    console.log("silent-socketio-host: no valid user.json or accessKey found. Not starting.");
    return null;
  }

  const roomId = sanitizeRoomName(userData.accessKey);

  console.log(`-----------------------------------------------------------\nsilent-socketio-host: accessKey = ${userData.accessKey}\n-----------------------------------------------------------\n`);

  console.log(`silent-socketio-host: Hosting P2P room "${roomId}" → ${SIGNALING_URL}`);

  const socket = io(SIGNALING_URL, {
    transports: ["websocket"],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 3000,
  });

  let peer;
  let dataChannel;
  let channelOpen = false;

  function attachPeerEvents() {
    peer.onicecandidate = (e) => {
      if (e.candidate) {
        socket.emit("ice-candidate", { roomId, candidate: e.candidate });
      }
    };
  }

  function attachDataChannelEvents() {
    dataChannel.onopen = () => {
      channelOpen = true;
      console.log("P2P DataChannel OPEN - Client connected");
    };

    dataChannel.onclose = () => {
      channelOpen = false;
      console.log("P2P DataChannel CLOSED – rebuilding...");
      rebuildPeer();
    };

    dataChannel.onerror = (err) => {
      console.error("P2P DataChannel error:", err.error?.message || err);
    };

    dataChannel.onmessage = async (event) => {
      if (!event.data) return;

      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (e) {
        try { dataChannel.send(JSON.stringify({ error: "invalid-json" })); } catch (_) { }
        return;
      }

      const { requestId, op, payload } = msg;

      if (!op) {
        try {
          dataChannel.send(JSON.stringify({
            requestId,
            error: "missing-op"
          }));
        } catch (_) { }
        return;
      }

      const result = await executeOperation(op, payload);

      const response = {
        requestId,
        result: result.ok ? result.result : undefined,
        error: result.ok ? undefined : (result.error || "unknown-error"),
      };

      try {
        dataChannel.send(JSON.stringify(response));
      } catch (e) {
      }
    };
  }

  function createPeer() {
    peer = new wrtc.RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:global.stun.twilio.com:3478" },
      ],
    });

    dataChannel = peer.createDataChannel("db-channel", {
      negotiated: false,
      id: 1,
    });

    attachPeerEvents();
    attachDataChannelEvents();
  }

  function rebuildPeer() {
    try { dataChannel?.close(); } catch (e) { }
    try { peer?.close(); } catch (e) { }

    channelOpen = false;

    createPeer();

    socket.emit("join-room", roomId);
  }

  createPeer();

  // === ICE & Signaling ===

  socket.on("connect", async () => {
    const res = await fetch("https://liorandb-server.onrender.com/user/socketId", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ socketId: socket.id, accessKey: loadUserData().accessKey }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error("Failed to update socketId:", data.error || `HTTP ${res.status}`);
      return;
    }

    socket.emit("join-room", roomId);
  });

  // Client joined → create and send offer
  socket.on("peer-joined", async () => {
    try {
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      socket.emit("offer", { roomId, offer });
    } catch (err) {
      console.error("Failed to create offer:", err);
    }
  });

  // Client sent answer
  socket.on("answer", async ({ answer }) => {
    try {
      await peer.setRemoteDescription(answer);
    } catch (err) {
      console.error("Failed to set remote description:", err);
    }
  });

  // Client sent ICE candidate
  socket.on("ice-candidate", async ({ candidate }) => {
    try {
      if (candidate) await peer.addIceCandidate(candidate);
    } catch (err) {
      // ignore invalid candidates
    }
  });

  // Graceful shutdown
  const shutdown = () => {
    try { dataChannel.onopen = null; } catch (e) { }
    try { dataChannel.onclose = null; } catch (e) { }
    try { dataChannel.onerror = null; } catch (e) { }
    try { dataChannel.onmessage = null; } catch (e) { }
    try { dataChannel.close(); } catch (e) { }
    try { peer.onicecandidate = null; } catch (e) { }
    try { peer.close(); } catch (e) { }
    try { socket.io.opts.reconnection = false; } catch (e) { }
    try { socket.off(); } catch (e) { }
    try { socket.removeAllListeners?.(); } catch (e) { }
    try { socket.disconnect(); } catch (e) { }
    try { socket.io?.engine?.close?.(); } catch (e) { }
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("SIGHUP", shutdown);

  return {
    socket,
    peer,
    dataChannel,
    isConnected: () => channelOpen,
    roomId,
  };
}

// Auto-start if run directly
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.includes("silent-socketio-host.js")) {
  connectSilentSocketIOHost();
}