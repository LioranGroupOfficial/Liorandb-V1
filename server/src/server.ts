// src/server.ts
import app from "./app";

const PORT = 4000;

app.listen(PORT, () => {
  console.log("======================================");
  console.log("🚀 LioranDB Host is LIVE");
  console.log(`📡 Listening on port: ${PORT}`);
  console.log(`🧠 Mode: ${process.env.NODE_ENV || "development"}`);
  console.log("======================================");
});
