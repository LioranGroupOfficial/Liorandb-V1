import crypto from "crypto";
import { getMasterKey } from "./secureKey.js";

const algorithm = "aes-256-gcm";
let ACTIVE_KEY: Buffer = getMasterKey();

export function deriveEncryptionKey(key: string | Buffer): Buffer {
  if (typeof key === "string") {
    return crypto.createHash("sha256").update(key).digest();
  }

  if (Buffer.isBuffer(key)) {
    if (key.length !== 32) {
      throw new Error("Encryption key must be 32 bytes");
    }
    return Buffer.from(key);
  }

  throw new Error("Invalid encryption key format");
}

export function setEncryptionKey(key: string | Buffer): void {
  if (!key) return;
  ACTIVE_KEY = deriveEncryptionKey(key);
}

export function getEncryptionKey(): Buffer {
  return Buffer.from(ACTIVE_KEY);
}

export function encryptStringWithKey(value: string, key: Buffer): string {
  const iv = crypto.randomBytes(16);
  const data = Buffer.from(value, "utf8");
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decryptStringWithKey(enc: string, key: Buffer): string {
  const buf = Buffer.from(enc, "base64");
  const iv = buf.subarray(0, 16);
  const tag = buf.subarray(16, 32);
  const encrypted = buf.subarray(32);

  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final()
  ]);

  return decrypted.toString("utf8");
}

export function encryptDataWithKey(obj: any, key: Buffer): string {
  const json = JSON.stringify(obj);
  if (json.length > 5_000_000) {
    throw new Error("Document too large (>5MB)");
  }

  return encryptStringWithKey(json, key);
}

export function decryptDataWithKey(enc: string, key: Buffer): any {
  return JSON.parse(decryptStringWithKey(enc, key));
}

export function encryptString(value: string): string {
  return encryptStringWithKey(value, ACTIVE_KEY);
}

export function decryptString(enc: string): string {
  return decryptStringWithKey(enc, ACTIVE_KEY);
}

export function encryptData(obj: any): string {
  return encryptDataWithKey(obj, ACTIVE_KEY);
}

export function decryptData(enc: string): any {
  return decryptDataWithKey(enc, ACTIVE_KEY);
}
