import path from "path";
import fs from "fs";
import { LioranDB } from "./core/database.js";

export class LioranManager {
  constructor() {
    this.rootPath = path.join(process.env.LIORANDB_PATH || path.join(process.env.HOME || process.env.USERPROFILE), "LioranDB", "db");

    if (!fs.existsSync(this.rootPath)) {
      fs.mkdirSync(this.rootPath, { recursive: true });
    }

    this.openDBs = new Map();
  }

  async createDatabase(name) {
    const dbPath = path.join(this.rootPath, name);

    if (!fs.existsSync(dbPath)) {
      await fs.promises.mkdir(dbPath, { recursive: true });
    }

    return true;
  }

  async openDatabase(name) {
    const dbPath = path.join(this.rootPath, name);

    if (!fs.existsSync(dbPath)) {
      throw new Error("Database does not exist");
    }

    if (this.openDBs.has(name)) {
      return this.openDBs.get(name);
    }

    const db = new LioranDB(dbPath, name, this);
    this.openDBs.set(name, db);
    return db;
  }

  async closeDatabase(name) {
    if (!this.openDBs.has(name)) return;

    const db = this.openDBs.get(name);

    // Close ALL collections
    for (const [colName, col] of db.collections.entries()) {
      await col.close();
    }

    this.openDBs.delete(name);
  }

  async renameDatabase(oldName, newName) {
    const oldPath = path.join(this.rootPath, oldName);
    const newPath = path.join(this.rootPath, newName);

    if (!fs.existsSync(oldPath)) throw new Error("Database not found");
    if (fs.existsSync(newPath)) throw new Error("New DB already exists");

    // 1️⃣ Close the DB completely (fixes EPERM)
    await this.closeDatabase(oldName);

    // 2️⃣ Rename the directory
    await fs.promises.rename(oldPath, newPath);

    return true;
  }

  async deleteDatabase(name) {
    const dbPath = path.join(this.rootPath, name);

    if (!fs.existsSync(dbPath)) return false;

    await this.closeDatabase(name);

    await fs.promises.rm(dbPath, { recursive: true, force: true });
    return true;
  }

  async listDatabases() {
    return fs.readdirSync(this.rootPath).filter(f =>
      fs.statSync(path.join(this.rootPath, f)).isDirectory()
    );
  }
}
