import { ClassicLevel } from "classic-level";
import { matchDocument, applyUpdate } from "./query.js";
import { v4 as uuid } from "uuid";

export class Collection {
  constructor(dir) {
    this.dir = dir;
    this.db = new ClassicLevel(dir, { valueEncoding: "json" });
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
    const _id = doc._id ?? uuid();
    const final = { _id, ...doc };
    await this.db.put(String(_id), final);
    return final;
  }

  async insertMany(docs = []) {
    const out = [];
    for (const d of docs) {
      out.push(await this.insertOne(d));
    }
    return out;
  }

  async find(query = {}) {
    const out = [];
    for await (const [, value] of this.db.iterator()) {
      if (matchDocument(value, query)) out.push(value);
    }
    return out;
  }

  async findOne(query = {}) {
    for await (const [, value] of this.db.iterator()) {
      if (matchDocument(value, query)) return value;
    }
    return null;
  }

  async updateOne(filter = {}, update = {}, options = { upsert: false }) {
    for await (const [key, value] of this.db.iterator()) {
      if (matchDocument(value, filter)) {
        const updated = applyUpdate(value, update);
        updated._id = value._id;
        await this.db.put(key, updated);
        return updated;
      }
    }

    if (options.upsert) {
      const newDoc = applyUpdate(filter, update);
      newDoc._id = newDoc._id ?? uuid();
      await this.db.put(String(newDoc._id), newDoc);
      return newDoc;
    }

    return null;
  }

  async updateMany(filter = {}, update = {}) {
    const updated = [];
    for await (const [key, value] of this.db.iterator()) {
      if (matchDocument(value, filter)) {
        const newDoc = applyUpdate(value, update);
        newDoc._id = value._id;
        await this.db.put(key, newDoc);
        updated.push(newDoc);
      }
    }
    return updated;
  }

  async deleteOne(filter = {}) {
    for await (const [key, value] of this.db.iterator()) {
      if (matchDocument(value, filter)) {
        await this.db.del(key);
        return true;
      }
    }
    return false;
  }

  async deleteMany(filter = {}) {
    let count = 0;
    for await (const [key, value] of this.db.iterator()) {
      if (matchDocument(value, filter)) {
        await this.db.del(key);
        count++;
      }
    }
    return count;
  }

  async countDocuments(filter = {}) {
    let c = 0;
    for await (const [, value] of this.db.iterator()) {
      if (matchDocument(value, filter)) c++;
    }
    return c;
  }
}
