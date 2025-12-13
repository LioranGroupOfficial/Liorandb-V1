import fs from "fs";
import path from "path";

const LOG_DIR = path.join(process.cwd(), "logs");

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function getLogFilePath() {
  const now = new Date();

  const date = now.toISOString().split("T")[0]; // YYYY-MM-DD
  const hour = String(now.getHours()).padStart(2, "0"); // HH

  return path.join(LOG_DIR, `${date}_${hour}.log`);
}

export function hostLog(message: string) {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ${message}\n`;

  // Write to file
  fs.appendFileSync(getLogFilePath(), logLine, "utf8");

  // Print to console
  console.log(logLine.trim());
}
