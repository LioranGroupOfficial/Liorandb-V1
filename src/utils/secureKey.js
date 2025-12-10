import crypto from "crypto";

export function getMasterKey() {
  let key = process.env.LIORANDB_MASTER_KEY;

  if (!key) {
    throw new Error(
      "Master encryption key missing! Set LIORANDB_MASTER_KEY in system environment variables."
    );
  }

  key = key.trim();

  if (key.length !== 64) {
    throw new Error("Invalid master key length (should be 64 hex chars / 256-bit).");
  }

  return key;
}
