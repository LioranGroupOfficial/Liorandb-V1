import path from "path";
import fs from "fs";
import { LioranDB } from "./core/database.js";

export class LioranManager {
  constructor() {
    this.rootPath = path.join(
      process.env.LIORANDB_PATH ||
        path.join(process.env.HOME || process.env.USERPROFILE),
      "LioranDB",
      "db"
    );

    if (!fs.existsSync(this.rootPath)) {
      fs.mkdirSync(this.rootPath, { recursive: true });
    }

    this.openDBs = new Map();
  }

  // -----------------------------------------
  // MongoDB-style: client.db("name")
  // Auto-create database if not exists
  // -----------------------------------------
  async db(name) {
    return this.openDatabase(name);
  }

  // -----------------------------------------
  // Create a new database (returns db instance)
  // -----------------------------------------
  async createDatabase(name) {
    const dbPath = path.join(this.rootPath, name);

    if (fs.existsSync(dbPath)) {
      throw new Error(`Database "${name}" already exists`);
    }

    await fs.promises.mkdir(dbPath, { recursive: true });
    return this.openDatabase(name);
  }

  // -----------------------------------------
  // Open DB - AUTO CREATE if missing
  // -----------------------------------------
  async openDatabase(name) {
    const dbPath = path.join(this.rootPath, name);

    // Auto-create if not exists
    if (!fs.existsSync(dbPath)) {
      await fs.promises.mkdir(dbPath, { recursive: true });
    }

    if (this.openDBs.has(name)) {
      return this.openDBs.get(name);
    }

    const db = new LioranDB(dbPath, name, this);
    this.openDBs.set(name, db);

    return db;
  }

  // -----------------------------------------
  // Close database
  // -----------------------------------------
  async closeDatabase(name) {
    if (!this.openDBs.has(name)) return;

    const db = this.openDBs.get(name);

    for (const [, col] of db.collections.entries()) {
      await col.close();
    }

    this.openDBs.delete(name);
  }

  // -----------------------------------------
  // Rename database
  // -----------------------------------------
  async renameDatabase(oldName, newName) {
    const oldPath = path.join(this.rootPath, oldName);
    const newPath = path.join(this.rootPath, newName);

    if (!fs.existsSync(oldPath)) throw new Error(`Database "${oldName}" not found`);
    if (fs.existsSync(newPath)) throw new Error(`Database "${newName}" already exists`);

    await this.closeDatabase(oldName);
    await fs.promises.rename(oldPath, newPath);

    return true;
  }

  // -----------------------------------------
  // Delete / Drop database
  // -----------------------------------------
  async deleteDatabase(name) {
    return this.dropDatabase(name);
  }

  async dropDatabase(name) {
    const dbPath = path.join(this.rootPath, name);

    if (!fs.existsSync(dbPath)) return false;

    await this.closeDatabase(name);
    await fs.promises.rm(dbPath, { recursive: true, force: true });

    return true;
  }

  // -----------------------------------------
  // List all databases
  // -----------------------------------------
  async listDatabases() {
    const items = await fs.promises.readdir(this.rootPath, { withFileTypes: true });
    return items.filter(i => i.isDirectory()).map(i => i.name);
  }
}
