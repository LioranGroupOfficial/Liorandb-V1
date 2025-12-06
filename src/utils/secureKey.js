import fs from "fs";
import path from "path";
import crypto from "crypto";
import { getBaseDBFolder } from "./rootpath.js";

const KEY_FILE = path.join(getBaseDBFolder(), ".secureKey");

export function getMasterKey() {
  if (!fs.existsSync(KEY_FILE)) {
    // generate 32-byte random key (256-bit)
    const key = crypto.randomBytes(32).toString("hex");
    fs.writeFileSync(KEY_FILE, key, { encoding: "utf8", mode: 0o600 });
    return key;
  }

  const key = fs.readFileSync(KEY_FILE, "utf8").trim();
  return key;
}
