import path from "path";
import fs from "fs";
import { Collection } from "./collection.js";
import type { LioranManager } from "../LioranManager.js";

export class LioranDB {
  basePath: string;
  dbName: string;
  manager: LioranManager;
  collections: Map<string, Collection>;

  constructor(basePath: string, dbName: string, manager: LioranManager) {
    this.basePath = basePath;
    this.dbName = dbName;
    this.manager = manager;
    this.collections = new Map();

    if (!fs.existsSync(basePath)) {
      fs.mkdirSync(basePath, { recursive: true });
    }
  }

  collection<T = any>(name: string): Collection<T> {
    if (this.collections.has(name)) {
      return this.collections.get(name)!;
    }

    const colPath = path.join(this.basePath, name);

    if (!fs.existsSync(colPath)) {
      fs.mkdirSync(colPath, { recursive: true });
    }

    const col = new Collection<T>(colPath);
    this.collections.set(name, col);
    return col;
  }

  async createCollection(name: string): Promise<boolean> {
    const colPath = path.join(this.basePath, name);

    if (fs.existsSync(colPath)) {
      throw new Error("Collection already exists");
    }

    await fs.promises.mkdir(colPath, { recursive: true });
    this.collections.set(name, new Collection(colPath));
    return true;
  }

  async deleteCollection(name: string): Promise<boolean> {
    const colPath = path.join(this.basePath, name);

    if (!fs.existsSync(colPath)) {
      throw new Error("Collection does not exist");
    }

    if (this.collections.has(name)) {
      await this.collections.get(name)!.close();
      this.collections.delete(name);
    }

    await fs.promises.rm(colPath, { recursive: true, force: true });
    return true;
  }

  async renameCollection(oldName: string, newName: string): Promise<boolean> {
    const oldPath = path.join(this.basePath, oldName);
    const newPath = path.join(this.basePath, newName);

    if (!fs.existsSync(oldPath)) throw new Error("Collection does not exist");
    if (fs.existsSync(newPath)) throw new Error("New collection name exists");

    if (this.collections.has(oldName)) {
      await this.collections.get(oldName)!.close();
      this.collections.delete(oldName);
    }

    await fs.promises.rename(oldPath, newPath);
    this.collections.set(newName, new Collection(newPath));
    return true;
  }

  async dropCollection(name: string): Promise<boolean> {
    return this.deleteCollection(name);
  }

  async listCollections(): Promise<string[]> {
    const dirs = await fs.promises.readdir(this.basePath, {
      withFileTypes: true
    });

    return dirs.filter(d => d.isDirectory()).map(d => d.name);
  }
}
