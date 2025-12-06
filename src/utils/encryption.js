import crypto from "crypto";
import { getMasterKey } from "./secureKey.js";

const algorithm = "aes-256-gcm";
const key = Buffer.from(getMasterKey(), "hex");

export function encryptData(plainObj) {
  const iv = crypto.randomBytes(16); // random 16-byte IV
  const data = Buffer.from(JSON.stringify(plainObj), "utf8");

  const cipher = crypto.createCipheriv(algorithm, key, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();

  // store as iv + tag + data, base64 encoded
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decryptData(encStr) {
  const buf = Buffer.from(encStr, "base64");
  const iv = buf.slice(0, 16);
  const tag = buf.slice(16, 32);
  const encrypted = buf.slice(32);

  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return JSON.parse(decrypted.toString("utf8"));
}
