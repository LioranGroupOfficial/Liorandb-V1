import { ClassicLevel } from "classic-level";
import { matchDocument, applyUpdate } from "./query.js";
import { v4 as uuid } from "uuid";
import { encryptData, decryptData } from "../utils/encryption.js";

export class Collection {
  constructor(dir) {
    this.dir = dir;
    this.db = new ClassicLevel(dir, { valueEncoding: "json" });

    // Queue system
    this.queue = Promise.resolve(); // start with a resolved promise
  }

  // Queue wrapper
  _enqueue(task) {
    // Add task to the queue
    this.queue = this.queue.then(() => task()).catch(console.error);
    return this.queue;
  }

  async close() {
    if (this.db) {
      try {
        await this.db.close();
      } catch (err) {
        console.warn("Warning: close() failed", err);
      }
    }
  }

  async insertOne(doc) {
    return this._enqueue(async () => {
      const _id = doc._id ?? uuid();
      const final = { _id, ...doc };
      const encrypted = encryptData(final);
      await this.db.put(String(_id), encrypted);
      return final;
    });
  }

  async insertMany(docs = []) {
    return this._enqueue(async () => {
      const ops = [];
      const out = [];

      for (const d of docs) {
        const _id = d._id ?? uuid();
        const final = { _id, ...d };
        const encrypted = encryptData(final);
        ops.push({ type: "put", key: String(_id), value: encrypted });
        out.push(final);
      }

      await this.db.batch(ops);
      return out;
    });
  }

  async find(query = {}) {
    return this._enqueue(async () => {
      const out = [];
      for await (const [, encValue] of this.db.iterator()) {
        const value = decryptData(encValue);
        if (matchDocument(value, query)) out.push(value);
      }
      return out;
    });
  }

  async findOne(query = {}) {
    return this._enqueue(async () => {
      for await (const [, encValue] of this.db.iterator()) {
        const value = decryptData(encValue);
        if (matchDocument(value, query)) return value;
      }
      return null;
    });
  }

  async updateOne(filter = {}, update = {}, options = { upsert: false }) {
    return this._enqueue(async () => {
      for await (const [key, encValue] of this.db.iterator()) {
        const value = decryptData(encValue);
        if (matchDocument(value, filter)) {
          const updated = applyUpdate(value, update);
          updated._id = value._id;
          const encrypted = encryptData(updated);
          await this.db.put(key, encrypted);
          return updated;
        }
      }

      if (options.upsert) {
        const newDoc = applyUpdate(filter, update);
        newDoc._id = newDoc._id ?? uuid();
        const encrypted = encryptData(newDoc);
        await this.db.put(String(newDoc._id), encrypted);
        return newDoc;
      }

      return null;
    });
  }

  async updateMany(filter = {}, update = {}) {
    return this._enqueue(async () => {
      const updated = [];
      for await (const [key, encValue] of this.db.iterator()) {
        const value = decryptData(encValue);
        if (matchDocument(value, filter)) {
          const newDoc = applyUpdate(value, update);
          newDoc._id = value._id;
          const encrypted = encryptData(newDoc);
          await this.db.put(key, encrypted);
          updated.push(newDoc);
        }
      }
      return updated;
    });
  }

  async deleteOne(filter = {}) {
    return this._enqueue(async () => {
      for await (const [key, encValue] of this.db.iterator()) {
        const value = decryptData(encValue);
        if (matchDocument(value, filter)) {
          await this.db.del(key);
          return true;
        }
      }
      return false;
    });
  }

  async deleteMany(filter = {}) {
    return this._enqueue(async () => {
      let count = 0;
      for await (const [key, encValue] of this.db.iterator()) {
        const value = decryptData(encValue);
        if (matchDocument(value, filter)) {
          await this.db.del(key);
          count++;
        }
      }
      return count;
    });
  }

  async countDocuments(filter = {}) {
    return this._enqueue(async () => {
      let c = 0;
      for await (const [, encValue] of this.db.iterator()) {
        const value = decryptData(encValue);
        if (matchDocument(value, filter)) c++;
      }
      return c;
    });
  }
}
