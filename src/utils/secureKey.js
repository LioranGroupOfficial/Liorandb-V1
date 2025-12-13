import crypto from "crypto";
import os from "os";

/**
 * Returns a 256-bit master key derived from machine hardware.
 * No env vars. No files. Machine-bound.
 */
export function getMasterKey() {
  const hardwareFingerprint = [
    os.hostname(),
    os.platform(),
    os.arch(),
    os.cpus()?.[0]?.model || "unknown-cpu",
    os.cpus()?.length.toString() || "0",
    os.totalmem().toString()
  ].join("|");

  return crypto
    .createHash("sha256")
    .update(hardwareFingerprint)
    .digest(); // 32 bytes
}
