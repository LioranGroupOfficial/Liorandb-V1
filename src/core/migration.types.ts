import type { LioranDB } from "./database.js";

export type MigrationVersion = string;

export type MigrationFn = (db: LioranDB) => Promise<void>;

export interface Migration {
  from: MigrationVersion;
  to: MigrationVersion;
  run: MigrationFn;
}

export interface MigrationRecord {
  version: MigrationVersion;
  appliedAt: number;
}

export interface MigrationMeta {
  id?: string;
  currentVersion: MigrationVersion;
  history: MigrationRecord[];
}