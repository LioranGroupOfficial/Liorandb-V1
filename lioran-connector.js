import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import io from "socket.io-client";
import wrtc from "wrtc";

// =====================================================================
// MAIN CONNECTOR CLASS - FULLY P2P WHEN isGlobal = true
// =====================================================================
class LioranConnector {
  constructor({ baseURL, apiKey, options = {}, accessKey } = {}) {
    this.isGlobal = options.isGlobal || false;

    // Normal local HTTP mode
    if (!this.isGlobal) {
      if (!baseURL || !apiKey) throw new Error("baseURL and apiKey required in normal mode");
      this.baseURL = baseURL.replace(/\/$/, "");
      this.apiKey = apiKey;
    }

    // Global P2P mode
    if (this.isGlobal) {
      if (!accessKey) throw new Error("Global mode requires accessKey");
      this.accessKey = accessKey;
      this.baseURL = null;
      this.apiKey = null;
    }

    // P2P state
    this.socket = null;
    this.peer = null;
    this.dataChannel = null;
    this.p2pReady = false;
    this.pendingRequests = new Map(); // requestId → { resolve, reject }

    if (this.isGlobal) {
      this._p2pReadyResolve = null;
      this._p2pReadyPromise = new Promise((resolve) => {
        this._p2pReadyResolve = resolve;
      });
      this.connectP2P();
    }
  }

  // =====================================================================
  // P2P CONNECTION SETUP (WebRTC + Socket.IO Signaling)
  // =====================================================================
  async connectP2P() {
    if (!this.isGlobal) throw new Error("P2P only works in global mode");

    return new Promise((resolve, reject) => {
      // Connect to signaling server
      this.socket = io("https://liorandb-server.onrender.com", {
        transports: ["websocket"],
        reconnectionAttempts: 5,
      });

      const roomId = this.accessKey;

      this.socket.on("connect", () => {
        console.log("[P2P] Connected to signaling server");
        this.socket.emit("join-room", roomId);
      });

      this.socket.on("connect_error", (err) => {
        console.error("[P2P] Signaling connection failed:", err);
        reject(err);
      });

      // Create peer connection
      this.peer = new wrtc.RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:global.stun.twilio.com:3478" },
        ],
      });

      // Handle incoming data channel (from host)
      this.peer.ondatachannel = (event) => {
        this.dataChannel = event.channel;
        this.setupDataChannel();
        resolve();
      };

      // Handle ICE candidates
      this.peer.onicecandidate = (event) => {
        if (event.candidate) {
          this.socket.emit("ice-candidate", {
            roomId,
            candidate: event.candidate,
          });
        }
      };

      // Receive offer from host
      this.socket.on("offer", async ({ offer }) => {
        try {
          await this.peer.setRemoteDescription(offer);
          const answer = await this.peer.createAnswer();
          await this.peer.setLocalDescription(answer);
          this.socket.emit("answer", { roomId, answer });
        } catch (err) {
          console.error("[P2P] Offer handling failed:", err);
          reject(err);
        }
      });

      // Receive ICE from host
      this.socket.on("ice-candidate", async ({ candidate }) => {
        if (candidate) {
          try {
            await this.peer.addIceCandidate(candidate);
          } catch (err) {
            console.warn("[P2P] Failed to add ICE candidate:", err);
          }
        }
      });

      this.socket.on("disconnect", () => {
        console.warn("[P2P] Disconnected from signaling server");
        this.p2pReady = false;
      });
    });
  }

  // =====================================================================
  // Setup DataChannel with proper message handling
  // =====================================================================
  setupDataChannel() {
    this.dataChannel.onopen = () => {
      console.log("[P2P] WebRTC DataChannel OPEN - Ready for requests");
      this.p2pReady = true;
      if (this._p2pReadyResolve) {
        this._p2pReadyResolve();
        this._p2pReadyResolve = null;
      }
    };

    this.dataChannel.onclose = () => {
      console.warn("[P2P] DataChannel closed");
      this.p2pReady = false;
      this._p2pReadyPromise = new Promise((resolve) => {
        this._p2pReadyResolve = resolve;
      });
    };

    this.dataChannel.onerror = (err) => {
      console.error("[P2P] DataChannel error:", err);
    };

    this.dataChannel.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.requestId && this.pendingRequests.has(msg.requestId)) {
          const { resolve, reject } = this.pendingRequests.get(msg.requestId);
          this.pendingRequests.delete(msg.requestId);
          if (msg.error) {
            reject(new Error(msg.error));
          } else {
            resolve(msg.result);
          }
        } else {
          console.log("[P2P] Received message:", msg);
        }
      } catch (err) {
        console.error("[P2P] Failed to parse message:", event.data);
      }
    };
  }

  // =====================================================================
  // SEND REQUEST VIA P2P (with proper request/response tracking)
  // =====================================================================
  async p2pRequest(operation, payload = {}) {
    if (!this.isGlobal) throw new Error("p2pRequest only allowed in global mode");
    if (this._p2pReadyPromise) {
      await this._p2pReadyPromise;
    }
    if (!this.p2pReady || !this.dataChannel) {
      throw new Error("P2P connection not ready. Wait for connectP2P() to resolve.");
    }
    if (this.dataChannel.readyState !== "open") {
      throw new Error("DataChannel not open");
    }

    return new Promise((resolve, reject) => {
      const requestId = Math.random().toString(36).substr(2, 9);
      const packet = {
        requestId,
        op: operation,
        payload,
      };

      this.pendingRequests.set(requestId, { resolve, reject });

      try {
        this.dataChannel.send(JSON.stringify(packet));
      } catch (err) {
        this.pendingRequests.delete(requestId);
        reject(err);
      }

      // Optional timeout
      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          reject(new Error("P2P request timeout"));
        }
      }, 10000);
    });
  }

  // =====================================================================
  // GENERIC REQUEST - FULLY P2P IN GLOBAL MODE
  // =====================================================================
  async request(path, method = "GET", body = null) {
    // GLOBAL MODE → Always use P2P
    if (this.isGlobal) {
      return this.p2pRequest("http", {
        path,
        method,
        body: body || undefined,
        apiKey: this.apiKey
      });
    }

    // LOCAL HTTP MODE
    const options = {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
      },
    };

    if (method !== "GET" && body) {
      options.body = JSON.stringify(body);
    }

    const res = await fetch(`${this.baseURL}${path}`, options);
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || `HTTP ${res.status}: Request failed`);
    }

    return data;
  }

  // =====================================================================
  // DATABASE METHODS (All go through P2P in global mode)
  // =====================================================================
  async listDatabases() {
    const res = await this.request("/db", "GET");
    return res.databases || [];
  }

  async createDatabase(name) {
    return this.request("/db", "POST", { name });
  }

  async deleteDatabase(name) {
    return this.request(`/db/${name}`, "DELETE");
  }

  async ensureDBExists(dbName) {
    if (this.isGlobal) return true;
    const dbs = await this.listDatabases();
    if (!dbs.includes(dbName)) await this.createDatabase(dbName);
  }

  async listCollections(dbName) {
    if (this.isGlobal) return [];
    const res = await this.request(`/db/${dbName}/collection`, "GET");
    return res.collections || [];
  }

  async createCollection(dbName, colName) {
    if (this.isGlobal) return true;
    return this.request(`/db/${dbName}/collection`, "POST", { name: colName });
  }

  async ensureCollectionExists(dbName, colName) {
    if (this.isGlobal) return true;
    const cols = await this.listCollections(dbName);
    if (!cols.includes(colName)) await this.createCollection(dbName, colName);
  }

  // =====================================================================
  // DOCUMENT CRUD
  // =====================================================================
  async insertOne(db, col, doc) {
    await this.ensureDBExists(db);
    await this.ensureCollectionExists(db, col);
    return this.request(`/db/${db}/collection/${col}/doc`, "POST", {
      document: doc,
    });
  }

  async find(db, col, query = {}) {
    await this.ensureDBExists(db);
    await this.ensureCollectionExists(db, col);
    const q = encodeURIComponent(JSON.stringify(query));
    const res = await this.request(`/db/${db}/collection/${col}/doc?q=${q}`, "GET");
    return res.documents || [];
  }

  async updateMany(db, col, filter, update) {
    await this.ensureDBExists(db);
    await this.ensureCollectionExists(db, col);
    return this.request(`/db/${db}/collection/${col}/doc`, "PUT", {
      filter,
      update,
    });
  }

  async deleteMany(db, col, filter) {
    await this.ensureDBExists(db);
    await this.ensureCollectionExists(db, col);
    return this.request(`/db/${db}/collection/${col}/doc`, "DELETE", { filter });
  }

  // =====================================================================
  // AUTH (only for local mode)
  // =====================================================================
  async login({ baseURL = "http://localhost:2008", username, password }) {
    if (this.isGlobal) {
      const data = await this.request(`/login`, "POST", {
        username,
        password,
      });
      this.apiKey = data.apiKey;
      return data;
    }
    else {

      const res = await fetch(`${baseURL}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Login failed");
      return data;
    }
  }

  // =====================================================================
  // DESTROY - Cleanly shutdown P2P + Local connections
  // =====================================================================
  destroy() {
    try {
      if (this.dataChannel) {
        try { this.dataChannel.onopen = null; } catch { }
        try { this.dataChannel.onclose = null; } catch { }
        try { this.dataChannel.onerror = null; } catch { }
        try { this.dataChannel.onmessage = null; } catch { }
        try { this.dataChannel.close(); } catch { }
        this.dataChannel = null;
      }

      if (this.peer) {
        try { this.peer.onicecandidate = null; } catch { }
        try { this.peer.ondatachannel = null; } catch { }
        try { this.peer.close(); } catch { }
        this.peer = null;
      }

      if (this.socket) {
        try { this.socket.io.opts.reconnection = false; } catch { }
        try { this.socket.off(); } catch { }
        try { this.socket.removeAllListeners?.(); } catch { }
        try { this.socket.disconnect(); } catch { }
        try { this.socket.io?.engine?.close?.(); } catch { }
        this.socket = null;
      }

      for (const [reqId, { reject }] of this.pendingRequests.entries()) {
        try { reject(new Error("Connection destroyed")); } catch { }
      }
      this.pendingRequests.clear();

      this.p2pReady = false;
      this._p2pReadyResolve = null;
      this._p2pReadyPromise = null;

      console.log("[P2P] Connector destroyed");

    } catch (err) {
      console.error("[P2P] Destroy failed:", err);
    }
  }
}

// =====================================================================
// WRAPPER CLASSES (unchanged)
// =====================================================================
class LioranCollectionWrapper {
  constructor(connector, dbName, collectionName) {
    this.connector = connector;
    this.dbName = dbName;
    this.collectionName = collectionName;
  }

  insertOne(doc) {
    return this.connector.insertOne(this.dbName, this.collectionName, doc);
  }

  find(query = {}) {
    return this.connector.find(this.dbName, this.collectionName, query);
  }

  updateMany(filter, update) {
    return this.connector.updateMany(this.dbName, this.collectionName, filter, update);
  }

  deleteMany(filter) {
    return this.connector.deleteMany(this.dbName, this.collectionName, filter);
  }
}

class LioranDBWrapper {
  constructor(connector, dbName) {
    this.connector = connector;
    this.dbName = dbName;
  }

  collection(name) {
    return new LioranCollectionWrapper(this.connector, this.dbName, name);
  }

  dropDatabase() {
    return this.connector.deleteDatabase(this.dbName);
  }
}

// Add .db() method to prototype
LioranConnector.prototype.db = function (dbName) {
  return new LioranDBWrapper(this, dbName);
};

// Export
export { LioranConnector };