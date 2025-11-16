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

  collection(name) {
    if (this.collections.has(name)) {
      return this.collections.get(name);
    }

    const colPath = path.join(this.basePath, name);
    const col = new Collection(colPath);
    this.collections.set(name, col);
    return col;
  }

  async renameCollection(oldName, newName) {
    const oldPath = path.join(this.basePath, oldName);
    const newPath = path.join(this.basePath, newName);

    if (!fs.existsSync(oldPath)) throw new Error("Collection does not exist");
    if (fs.existsSync(newPath)) throw new Error("New collection name exists");

    // 1️⃣ Close open ClassicLevel instance
    if (this.collections.has(oldName)) {
      await this.collections.get(oldName).close();
      this.collections.delete(oldName);
    }

    // 2️⃣ Rename directory safely
    await fs.promises.rename(oldPath, newPath);

    // 3️⃣ Reopen under new name
    const newCol = new Collection(newPath);
    this.collections.set(newName, newCol);

    return true;
  }

  async dropCollection(name) {
    const p = path.join(this.basePath, name);

    if (!fs.existsSync(p)) return false;

    // close first
    if (this.collections.has(name)) {
      await this.collections.get(name).close();
      this.collections.delete(name);
    }

    await fs.promises.rm(p, { recursive: true, force: true });
    return true;
  }
}
