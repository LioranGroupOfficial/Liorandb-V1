import crypto from "crypto";
import os from "os";

export function getMasterKey(): Buffer {
  const fingerprint = [
    os.hostname(),
    os.platform(),
    os.arch(),
    os.cpus()?.[0]?.model ?? "unknown",
    os.cpus()?.length ?? 0,
    os.totalmem()
  ].join("|");

  return crypto.createHash("sha256").update(fingerprint).digest();
}
