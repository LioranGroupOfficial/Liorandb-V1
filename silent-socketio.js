// silent-socketio.js
import { io } from "socket.io-client";

export function connectSilentSocketIO() {
  try {
    const socket = io("http://localhost:5000", {
      transports: ["websocket"],
      reconnection: true,
      autoConnect: true,
    });

    // No console.log -> completely hidden
    socket.on("connect", () => {});
    socket.on("disconnect", () => {});
    socket.on("connect_error", () => {});
    socket.on("message", () => {});

    return socket;
  } catch (err) {
    // stay silent
  }
}
