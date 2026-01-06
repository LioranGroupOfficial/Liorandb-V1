import crypto from "crypto";
import { getMasterKey } from "./secureKey.js";

const algorithm = "aes-256-gcm";

// 🔐 Runtime-configurable key
let ACTIVE_KEY = getMasterKey();

/**
 * Allows LioranManager to inject a custom encryption key
 */
export function setEncryptionKey(key) {
  if (!key) return;

  if (typeof key === "string") {
    ACTIVE_KEY = crypto.createHash("sha256").update(key).digest();
    return;
  }

  if (Buffer.isBuffer(key)) {
    if (key.length !== 32) {
      throw new Error("Encryption key must be 32 bytes (256-bit)");
    }
    ACTIVE_KEY = key;
    return;
  }

  throw new Error("Invalid encryption key format");
}

export function encryptData(plainObj) {
  const iv = crypto.randomBytes(16);
  const data = Buffer.from(JSON.stringify(plainObj), "utf8");

  const cipher = crypto.createCipheriv(algorithm, ACTIVE_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decryptData(encStr) {
  const buf = Buffer.from(encStr, "base64");
  const iv = buf.slice(0, 16);
  const tag = buf.slice(16, 32);
  const encrypted = buf.slice(32);

  const decipher = crypto.createDecipheriv(algorithm, ACTIVE_KEY, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final()
  ]);

  return JSON.parse(decrypted.toString("utf8"));
}
