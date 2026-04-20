import { MigrationMeta } from "./migration.types.js";
import type { LioranDB } from "./database.js";

const MIGRATION_COLLECTION = "__migrations__";
const MIGRATION_KEY = "__migration_meta__";

export class MigrationStore {
  constructor(private db: LioranDB) {}

  async get(): Promise<MigrationMeta> {
    const col = this.db.collection<MigrationMeta>(MIGRATION_COLLECTION);
    const meta = await col.findOne((d: MigrationMeta) => d.id === MIGRATION_KEY);
    return (
      meta ?? {
        currentVersion: "v1",
        history: []
      }
    );
  }

  async set(meta: MigrationMeta): Promise<void> {
    const col = this.db.collection<MigrationMeta>(MIGRATION_COLLECTION);
    const existing = await col.findOne((d: MigrationMeta) => d.id === MIGRATION_KEY);
    if (existing) {
      await col.updateOne(existing._id, { ...meta, id: MIGRATION_KEY });
    } else {
      await col.insertOne({ ...meta, id: MIGRATION_KEY });
    }
  }

  async updateVersion(version: string): Promise<void> {
    const meta = await this.get();
    meta.currentVersion = version;
    meta.history.push({
      version,
      appliedAt: Date.now()
    });
    await this.set(meta);
  }
}
