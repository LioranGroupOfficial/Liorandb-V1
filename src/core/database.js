import path from "path";
import fs from "fs";
import { Collection } from "./collection.js";

export class LioranDB {
  constructor(basePath, dbName, manager) {
    this.basePath = basePath;
    this.dbName = dbName;
    this.manager = manager;
    this.collections = new Map();

    if (!fs.existsSync(basePath)) {
      fs.mkdirSync(basePath, { recursive: true });
    }
  }

  /** Get or auto-create collection object */
  collection(name) {
    if (this.collections.has(name)) {
      return this.collections.get(name);
    }

    const colPath = path.join(this.basePath, name);

    // auto-create directory
    if (!fs.existsSync(colPath)) {
      fs.mkdirSync(colPath, { recursive: true });
    }

    const col = new Collection(colPath);
    this.collections.set(name, col);
    return col;
  }

  /** Create collection manually */
  async createCollection(name) {
    const colPath = path.join(this.basePath, name);

    if (fs.existsSync(colPath)) {
      throw new Error("Collection already exists");
    }

    // create folder
    await fs.promises.mkdir(colPath, { recursive: true });

    // load into memory map
    const col = new Collection(colPath);
    this.collections.set(name, col);

    return true;
  }

  /** Delete collection fully */
  async deleteCollection(name) {
    const colPath = path.join(this.basePath, name);

    if (!fs.existsSync(colPath)) {
      throw new Error("Collection does not exist");
    }

    // close LevelDB instance if opened
    if (this.collections.has(name)) {
      await this.collections.get(name).close().catch(() => {});
      this.collections.delete(name);
    }

    // force delete directory
    await fs.promises.rm(colPath, { recursive: true, force: true });

    return true;
  }

  /** Rename collection */
  async renameCollection(oldName, newName) {
    const oldPath = path.join(this.basePath, oldName);
    const newPath = path.join(this.basePath, newName);

    if (!fs.existsSync(oldPath)) throw new Error("Collection does not exist");
    if (fs.existsSync(newPath)) throw new Error("New collection name exists");

    if (this.collections.has(oldName)) {
      await this.collections.get(oldName).close().catch(() => {});
      this.collections.delete(oldName);
    }

    await fs.promises.rename(oldPath, newPath);

    const newCol = new Collection(newPath);
    this.collections.set(newName, newCol);

    return true;
  }

  /** Drop a collection (alias deleteCollection) */
  async dropCollection(name) {
    return this.deleteCollection(name);
  }

  /** List all collections */
  async listCollections() {
    const dirs = await fs.promises.readdir(this.basePath, { withFileTypes: true });

    return dirs
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);
  }
}
