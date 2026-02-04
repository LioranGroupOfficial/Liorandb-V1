import crypto from "crypto";
import { getMasterKey } from "./secureKey.js";

const algorithm = "aes-256-gcm";
let ACTIVE_KEY: Buffer = getMasterKey();

export function setEncryptionKey(key: string | Buffer): void {
  if (!key) return;

  if (typeof key === "string") {
    ACTIVE_KEY = crypto.createHash("sha256").update(key).digest();
    return;
  }

  if (Buffer.isBuffer(key)) {
    if (key.length !== 32) {
      throw new Error("Encryption key must be 32 bytes");
    }
    ACTIVE_KEY = key;
    return;
  }

  throw new Error("Invalid encryption key format");
}

export function encryptData(obj: any): string {
  const iv = crypto.randomBytes(16);
  const data = Buffer.from(JSON.stringify(obj), "utf8");

  const cipher = crypto.createCipheriv(algorithm, ACTIVE_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decryptData(enc: string): any {
  const buf = Buffer.from(enc, "base64");
  const iv = buf.subarray(0, 16);
  const tag = buf.subarray(16, 32);
  const encrypted = buf.subarray(32);

  const decipher = crypto.createDecipheriv(algorithm, ACTIVE_KEY, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final()
  ]);

  return JSON.parse(decrypted.toString("utf8"));
}
