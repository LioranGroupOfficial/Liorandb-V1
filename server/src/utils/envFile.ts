import fs from "fs";
import path from "path";

type LoadEnvOptions = {
  filePath?: string;
  respectExisting?: boolean;
};

function parseEnvLine(line: string): { key: string; value: string } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("#")) return null;

  const eq = trimmed.indexOf("=");
  if (eq <= 0) return null;

  const key = trimmed.slice(0, eq).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;

  let value = trimmed.slice(eq + 1).trim();
  if (!value) return { key, value: "" };

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return { key, value };
}

function tryLoadFile(filePath: string, respectExisting: boolean) {
  if (!filePath) return false;
  if (!fs.existsSync(filePath)) return false;

  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const kv = parseEnvLine(line);
    if (!kv) continue;
    if (respectExisting && process.env[kv.key] !== undefined) continue;
    process.env[kv.key] = kv.value;
  }
  return true;
}

export function loadEnvFile(opts: LoadEnvOptions = {}) {
  const respectExisting = opts.respectExisting !== false;

  const explicit = opts.filePath || process.env.LIORANDB_ENV_FILE;
  if (explicit && tryLoadFile(path.resolve(explicit), respectExisting)) return;

  const cwdCandidate = path.resolve(process.cwd(), ".env");
  if (tryLoadFile(cwdCandidate, respectExisting)) return;

  const entry = process.argv[1];
  if (entry) {
    const entryCandidate = path.resolve(path.dirname(entry), ".env");
    tryLoadFile(entryCandidate, respectExisting);
  }
}

