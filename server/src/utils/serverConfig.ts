import fs from "fs";
import path from "path";
import { getBaseDBFolder } from "@liorandb/core";

export type ServerRestartCommand = {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
};

export type ServerConfigFileV1 = {
  version: 1;
  baseUrl: string;
  stopEndpoint: string;
  restart?: ServerRestartCommand;
  lastStartedAt?: string;
  lastStoppedAt?: string;
};

const SERVER_CONFIG_FILE_NAME = "server.json";

export function getServerConfigPath() {
  return path.join(getBaseDBFolder(), SERVER_CONFIG_FILE_NAME);
}

export function readServerConfig(): ServerConfigFileV1 | null {
  const file = getServerConfigPath();
  if (!fs.existsSync(file)) return null;

  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.version !== 1) return null;
    if (typeof parsed.baseUrl !== "string") return null;
    if (typeof parsed.stopEndpoint !== "string") return null;
    return parsed as ServerConfigFileV1;
  } catch {
    return null;
  }
}

export function writeServerConfig(config: ServerConfigFileV1) {
  const file = getServerConfigPath();
  const dir = path.dirname(file);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2), { encoding: "utf8" });
  fs.renameSync(tmp, file);
}

