// src/server.ts
import app from "./app";

const PORT = 4000;

app.listen(PORT, "0.0.0.0", () => {
  console.log("======================================");
  console.log("🚀 LioranDB Host is LIVE");
  console.log(`📡 Listening on port: ${PORT}`);
  // print all running host IPs
  console.log(`🌐 Host Address: localhost:4000`);
  const os = require("os");
  const networkInterfaces = os.networkInterfaces();
  for (const interfaceName in networkInterfaces) {
    const interfaceInfo = networkInterfaces[interfaceName];
    for (const addressInfo of interfaceInfo) {
      if (addressInfo.family === "IPv4" && !addressInfo.internal) {
        console.log(`🌐 Host Address: ${addressInfo.address}:4000`);
      }
    }
  }
  // console.log(`🧠 Mode: ${process.env.NODE_ENV || "development"}`);
  console.log("======================================");
});
