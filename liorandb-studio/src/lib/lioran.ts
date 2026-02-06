import { LioranClient } from '@liorandb/driver';
import { Database, Collection, Document } from '@/types';

let clientInstance: LioranClient | null = null;

export class LioranDBService {
  private static client: LioranClient | null = null;

  static async initialize(uri: string): Promise<void> {
    try {
      this.client = new LioranClient(uri);
      await this.client.connect();
    } catch (error) {
      throw new Error(`Failed to connect to LioranDB: ${error}`);
    }
  }

  static isConnected(): boolean {
    return this.client !== null;
  }

  static getClient(): LioranClient | null {
    return this.client;
  }

  static disconnect(): void {
    this.client = null;
  }

  // Database Operations
  static async listDatabases(): Promise<Database[]> {
    if (!this.client) throw new Error('Client not connected');
    try {
      const dbs = await this.client.listDatabases();
      return dbs as Database[];
    } catch (error) {
      throw new Error(`Failed to list databases: ${error}`);
    }
  }

  static async createDatabase(name: string): Promise<void> {
    if (!this.client) throw new Error('Client not connected');
    try {
      await this.client.createDatabase(name);
    } catch (error) {
      throw new Error(`Failed to create database: ${error}`);
    }
  }

  static async dropDatabase(name: string): Promise<void> {
    if (!this.client) throw new Error('Client not connected');
    try {
      await this.client.dropDatabase(name);
    } catch (error) {
      throw new Error(`Failed to drop database: ${error}`);
    }
  }

  static async renameDatabase(oldName: string, newName: string): Promise<void> {
    if (!this.client) throw new Error('Client not connected');
    try {
      await this.client.renameDatabase(oldName, newName);
    } catch (error) {
      throw new Error(`Failed to rename database: ${error}`);
    }
  }

  // Collection Operations
  static async listCollections(dbName: string): Promise<Collection[]> {
    if (!this.client) throw new Error('Client not connected');
    try {
      const db = this.client.db(dbName);
      const collections = await db.listCollections();
      return collections as Collection[];
    } catch (error) {
      throw new Error(`Failed to list collections: ${error}`);
    }
  }

  static async createCollection(dbName: string, name: string): Promise<void> {
    if (!this.client) throw new Error('Client not connected');
    try {
      const db = this.client.db(dbName);
      await db.createCollection(name);
    } catch (error) {
      throw new Error(`Failed to create collection: ${error}`);
    }
  }

  static async dropCollection(dbName: string, name: string): Promise<void> {
    if (!this.client) throw new Error('Client not connected');
    try {
      const db = this.client.db(dbName);
      await db.dropCollection(name);
    } catch (error) {
      throw new Error(`Failed to drop collection: ${error}`);
    }
  }

  static async renameCollection(
    dbName: string,
    oldName: string,
    newName: string
  ): Promise<void> {
    if (!this.client) throw new Error('Client not connected');
    try {
      const db = this.client.db(dbName);
      await db.renameCollection(oldName, newName);
    } catch (error) {
      throw new Error(`Failed to rename collection: ${error}`);
    }
  }

  // Document Operations
  static async find(
    dbName: string,
    collectionName: string,
    filter?: Record<string, any>,
    limit: number = 100
  ): Promise<{ documents: Document[]; count: number }> {
    if (!this.client) throw new Error('Client not connected');
    try {
      const db = this.client.db(dbName);
      const collection = db.collection(collectionName);
      const documents = await collection.find(filter || {});
      return {
        documents: documents.slice(0, limit) as Document[],
        count: documents.length,
      };
    } catch (error) {
      throw new Error(`Failed to find documents: ${error}`);
    }
  }

  static async findOne(
    dbName: string,
    collectionName: string,
    filter: Record<string, any>
  ): Promise<Document | null> {
    if (!this.client) throw new Error('Client not connected');
    try {
      const db = this.client.db(dbName);
      const collection = db.collection(collectionName);
      const doc = await collection.findOne(filter);
      return (doc as Document) || null;
    } catch (error) {
      throw new Error(`Failed to find document: ${error}`);
    }
  }

  static async insertOne(
    dbName: string,
    collectionName: string,
    doc: Document
  ): Promise<string> {
    if (!this.client) throw new Error('Client not connected');
    try {
      const db = this.client.db(dbName);
      const collection = db.collection(collectionName);
      const result = await collection.insertOne(doc);
      return result as unknown as string;
    } catch (error) {
      throw new Error(`Failed to insert document: ${error}`);
    }
  }

  static async insertMany(
    dbName: string,
    collectionName: string,
    docs: Document[]
  ): Promise<string[]> {
    if (!this.client) throw new Error('Client not connected');
    try {
      const db = this.client.db(dbName);
      const collection = db.collection(collectionName);
      const result = await collection.insertMany(docs);
      return result as unknown as string[];
    } catch (error) {
      throw new Error(`Failed to insert documents: ${error}`);
    }
  }

  static async updateMany(
    dbName: string,
    collectionName: string,
    filter: Record<string, any>,
    update: Record<string, any>
  ): Promise<number> {
    if (!this.client) throw new Error('Client not connected');
    try {
      const db = this.client.db(dbName);
      const collection = db.collection(collectionName);
      const result = await collection.updateMany(filter, update);
      return result as unknown as number;
    } catch (error) {
      throw new Error(`Failed to update documents: ${error}`);
    }
  }

  static async deleteMany(
    dbName: string,
    collectionName: string,
    filter: Record<string, any>
  ): Promise<number> {
    if (!this.client) throw new Error('Client not connected');
    try {
      const db = this.client.db(dbName);
      const collection = db.collection(collectionName);
      const result = await collection.deleteMany(filter);
      return result as unknown as number;
    } catch (error) {
      throw new Error(`Failed to delete documents: ${error}`);
    }
  }

  static async count(
    dbName: string,
    collectionName: string,
    filter?: Record<string, any>
  ): Promise<number> {
    if (!this.client) throw new Error('Client not connected');
    try {
      const db = this.client.db(dbName);
      const collection = db.collection(collectionName);
      const count = await collection.count(filter || {});
      return count as unknown as number;
    } catch (error) {
      throw new Error(`Failed to count documents: ${error}`);
    }
  }

  static async stats(
    dbName: string,
    collectionName: string
  ): Promise<Record<string, any>> {
    if (!this.client) throw new Error('Client not connected');
    try {
      const db = this.client.db(dbName);
      const collection = db.collection(collectionName);
      const stats = await collection.stats();
      return stats as Record<string, any>;
    } catch (error) {
      throw new Error(`Failed to get collection stats: ${error}`);
    }
  }
}
