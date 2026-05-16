type DotPath = string;

export type DocMigrationStep =
  | { type: "renameField"; from: DotPath; to: DotPath }
  | { type: "deleteField"; path: DotPath }
  | { type: "setDefault"; path: DotPath; value: any }
  | { type: "moveField"; from: DotPath; to: DotPath }
  | { type: "set"; path: DotPath; value: any };

export type CollectionDocMigrationsConfig = {
  enabled?: boolean;
  currentVersion: number;
  writeBackOnRead?: boolean;
  migrations: Array<{
    from: number;
    to: number;
    steps: DocMigrationStep[];
  }>;
};

type DbMetaShape = {
  collectionDocMigrations?: Record<string, CollectionDocMigrationsConfig>;
};

function isPlainObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function getDbMeta(db: any): DbMetaShape {
  return ((db as any).meta ?? {}) as DbMetaShape;
}

function saveDbMeta(db: any) {
  (db as any).saveMeta?.();
}

export function getCollectionDocMigrations(db: any, col: string): CollectionDocMigrationsConfig | null {
  const meta = getDbMeta(db);
  return meta.collectionDocMigrations?.[col] ?? null;
}

export function setCollectionDocMigrations(db: any, col: string, config: CollectionDocMigrationsConfig | null) {
  const meta = getDbMeta(db);
  if (!meta.collectionDocMigrations) meta.collectionDocMigrations = {};

  if (!config) {
    delete meta.collectionDocMigrations[col];
    if (Object.keys(meta.collectionDocMigrations).length === 0) {
      delete meta.collectionDocMigrations;
    }
    saveDbMeta(db);
    return;
  }

  meta.collectionDocMigrations[col] = config;
  saveDbMeta(db);
}

function splitPath(path: string) {
  return String(path || "")
    .split(".")
    .map((s) => s.trim())
    .filter(Boolean);
}

function getAt(obj: any, path: string) {
  const parts = splitPath(path);
  let cur = obj;
  for (const p of parts) {
    if (!isPlainObject(cur) && !Array.isArray(cur)) return undefined;
    cur = (cur as any)[p];
  }
  return cur;
}

function hasAt(obj: any, path: string) {
  const parts = splitPath(path);
  let cur = obj;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!isPlainObject(cur) && !Array.isArray(cur)) return false;
    if (!(p in (cur as any))) return false;
    cur = (cur as any)[p];
  }
  return true;
}

function setAt(obj: any, path: string, value: any) {
  const parts = splitPath(path);
  if (parts.length === 0) return;
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (!isPlainObject((cur as any)[p])) (cur as any)[p] = {};
    cur = (cur as any)[p];
  }
  (cur as any)[parts[parts.length - 1]] = value;
}

function deleteAt(obj: any, path: string) {
  const parts = splitPath(path);
  if (parts.length === 0) return;
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (!isPlainObject(cur) && !Array.isArray(cur)) return;
    cur = (cur as any)[p];
  }
  if (!isPlainObject(cur) && !Array.isArray(cur)) return;
  delete (cur as any)[parts[parts.length - 1]];
}

function applySteps(doc: any, steps: DocMigrationStep[]) {
  for (const step of steps) {
    if (!step || typeof step !== "object") continue;

    if (step.type === "renameField" || step.type === "moveField") {
      if (!hasAt(doc, step.from)) continue;
      const v = getAt(doc, step.from);
      deleteAt(doc, step.from);
      setAt(doc, step.to, v);
      continue;
    }

    if (step.type === "deleteField") {
      deleteAt(doc, step.path);
      continue;
    }

    if (step.type === "setDefault") {
      if (!hasAt(doc, step.path)) setAt(doc, step.path, step.value);
      continue;
    }

    if (step.type === "set") {
      setAt(doc, step.path, step.value);
      continue;
    }
  }
}

export function migrateDocIfNeeded(
  rawDoc: any,
  config: CollectionDocMigrationsConfig | null
): { doc: any; changed: boolean; fromVersion: number | null; toVersion: number | null } {
  if (!config || config.enabled === false) {
    return { doc: rawDoc, changed: false, fromVersion: null, toVersion: null };
  }

  const currentVersion = Number(config.currentVersion);
  if (!Number.isFinite(currentVersion) || currentVersion <= 0) {
    return { doc: rawDoc, changed: false, fromVersion: null, toVersion: null };
  }

  if (!rawDoc || typeof rawDoc !== "object") {
    return { doc: rawDoc, changed: false, fromVersion: null, toVersion: null };
  }

  const initialV = Number((rawDoc as any).__v ?? 0);
  const startV = Number.isFinite(initialV) ? initialV : 0;

  if (startV >= currentVersion) {
    return { doc: rawDoc, changed: false, fromVersion: startV, toVersion: startV };
  }

  const nextDoc = Array.isArray(rawDoc) ? [...rawDoc] : { ...(rawDoc as any) };
  let v = startV;
  let changed = false;

  // Apply migrations in a loop until we reach currentVersion or no rule exists.
  // Protect against cycles.
  const maxHops = Math.max(25, (config.migrations?.length ?? 0) + 5);
  for (let hop = 0; hop < maxHops && v < currentVersion; hop++) {
    const step = config.migrations.find((m) => m.from === v);
    if (!step) break;

    applySteps(nextDoc, step.steps || []);
    v = step.to;
    changed = true;
    (nextDoc as any).__v = v;
  }

  if (v < currentVersion) {
    // If we couldn't reach currentVersion, leave doc at best-effort migrated version.
    return { doc: nextDoc, changed, fromVersion: startV, toVersion: v };
  }

  return { doc: nextDoc, changed, fromVersion: startV, toVersion: v };
}

