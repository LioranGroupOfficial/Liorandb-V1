import crypto from "crypto";
import fs from "fs";
import path from "path";

const SECRET_FILE_NAME = "secret.key";
const MIN_SECRET_LENGTH = 64;

function resolveProjectRoot() {
  const cwd = process.cwd();

  if (path.basename(cwd).toLowerCase() === "server") {
    return path.resolve(cwd, "..");
  }

  return cwd;
}

export function getSecretFilePath() {
  return path.join(resolveProjectRoot(), SECRET_FILE_NAME);
}

function isValidSecret(value: string) {
  return typeof value === "string"
    && value.trim().length >= MIN_SECRET_LENGTH
    && /^[A-Za-z0-9._\-]+$/.test(value.trim());
}

function generateSecret() {
  return crypto.randomBytes(48).toString("base64url");
}

export function ensurePersistentSecret() {
  const secretFilePath = getSecretFilePath();

  if (fs.existsSync(secretFilePath)) {
    const existing = fs.readFileSync(secretFilePath, "utf8").trim();

    if (isValidSecret(existing)) {
      return existing;
    }
  }

  const secret = generateSecret();
  fs.writeFileSync(secretFilePath, secret, { encoding: "utf8" });
  return secret;
}
