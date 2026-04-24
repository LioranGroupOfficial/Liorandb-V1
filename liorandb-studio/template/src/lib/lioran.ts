import { LioranClient } from '@liorandb/driver';
import { Collection, Database, Document, LioranUser } from '@/types';
import { parseConnectionUri } from '@/lib/utils';

type InitializeOptions =
  | { mode: 'uri' }
  | { mode: 'credentials'; username: string; password: string }
  | { mode: 'token'; token: string };

interface SessionSnapshot {
  token: string | null;
  user: LioranUser | null;
  uri: string | null;
}

export class LioranDBService {
  private static client: LioranClient | null = null;
  private static session: SessionSnapshot = {
    token: null,
    user: null,
    uri: null,
  };

  static async initialize(uri: string, options: InitializeOptions = { mode: 'uri' }): Promise<SessionSnapshot> {
    const parsed = parseConnectionUri(uri);
    const normalizedUri = parsed.uri;

    this.client = new LioranClient(normalizedUri);

    if (options.mode === 'credentials') {
      await this.client.login(options.username, options.password);
    } else if (options.mode === 'token') {
      this.client.setToken(options.token);
    } else if (parsed.protocol === 'lioran' || parsed.protocol === 'liorandb') {
      await this.client.connect();
    } else {
      throw new Error(
        'An http(s) URI needs either a username/password login or an existing token.'
      );
    }

    this.session = {
      token: this.client.getToken(),
      user: (this.client.getUser() as LioranUser | null) ?? null,
      uri: normalizedUri,
    };

    return this.session;
  }

  static async restore(uri: string, token: string): Promise<SessionSnapshot> {
    return this.initialize(uri, { mode: 'token', token });
  }

  static isConnected(): boolean {
    return Boolean(this.client?.isAuthenticated());
  }

  static getClient(): LioranClient | null {
    return this.client;
  }

  static getSession(): SessionSnapshot {
    return this.session;
  }

  static disconnect(): void {
    this.client?.logout();
    this.client = null;
    this.session = {
      token: null,
      user: null,
      uri: null,
    };
  }

  static async getHostInfo() {
    if (!this.client) throw new Error('Client not connected');
    return this.client.info();
  }

  static async getHealth() {
    if (!this.client) throw new Error('Client not connected');
    return this.client.health();
  }

  static async listDatabases(): Promise<Database[]> {
    if (!this.client) throw new Error('Client not connected');

    const dbs = await this.client.listDatabases();
    const stats = await Promise.allSettled(
      dbs.map(async (name) => this.client!.databaseStats(String(name)))
    );

    return dbs.map((name, index) => {
      const stat = stats[index];
      const dbName = String(name);

      if (stat.status === 'fulfilled') {
        return {
          name: dbName,
          collections: stat.value.collections,
          documents: stat.value.documents,
        };
      }

      return { name: dbName };
    });
  }

  static async createDatabase(name: string): Promise<void> {
    if (!this.client) throw new Error('Client not connected');
    await this.client.createDatabase(name);
  }

  static async dropDatabase(name: string): Promise<void> {
    if (!this.client) throw new Error('Client not connected');
    await this.client.dropDatabase(name);
  }

  static async listCollections(dbName: string): Promise<Collection[]> {
    if (!this.client) throw new Error('Client not connected');

    const db = this.client.db(dbName);
    const collections = await db.listCollections();
    const stats = await Promise.allSettled(
      collections.map(async (name) => db.collection(name).stats())
    );

    return collections.map((name, index) => {
      const stat = stats[index];

      if (stat.status === 'fulfilled') {
        return { name, count: stat.value.documents };
      }

      return { name };
    });
  }

  static async createCollection(dbName: string, name: string): Promise<void> {
    if (!this.client) throw new Error('Client not connected');
    await this.client.db(dbName).createCollection(name);
  }

  static async dropCollection(dbName: string, name: string): Promise<void> {
    if (!this.client) throw new Error('Client not connected');
    await this.client.db(dbName).dropCollection(name);
  }

  static async renameCollection(dbName: string, oldName: string, newName: string): Promise<void> {
    if (!this.client) throw new Error('Client not connected');
    await this.client.db(dbName).renameCollection(oldName, newName);
  }

  static async find(
    dbName: string,
    collectionName: string,
    filter: Record<string, unknown> = {},
    limit = 100
  ): Promise<{ documents: Document[]; count: number }> {
    if (!this.client) throw new Error('Client not connected');

    const collection = this.client.db(dbName).collection<Document>(collectionName);
    const documents = await collection.find(filter);

    return {
      documents: documents.slice(0, limit),
      count: documents.length,
    };
  }

  static async findOne(
    dbName: string,
    collectionName: string,
    filter: Record<string, unknown>
  ): Promise<Document | null> {
    if (!this.client) throw new Error('Client not connected');

    return this.client.db(dbName).collection<Document>(collectionName).findOne(filter);
  }

  static async insertOne(
    dbName: string,
    collectionName: string,
    doc: Document
  ): Promise<string | undefined> {
    if (!this.client) throw new Error('Client not connected');

    const inserted = await this.client.db(dbName).collection<Document>(collectionName).insertOne(doc);
    return inserted._id as string | undefined;
  }

  static async insertMany(
    dbName: string,
    collectionName: string,
    docs: Document[]
  ): Promise<string[]> {
    if (!this.client) throw new Error('Client not connected');

    const inserted = await this.client.db(dbName).collection<Document>(collectionName).insertMany(docs);
    return inserted
      .map((doc) => doc._id)
      .filter((value): value is string => typeof value === 'string');
  }

  static async updateMany(
    dbName: string,
    collectionName: string,
    filter: Record<string, unknown>,
    update: Record<string, unknown>
  ): Promise<number> {
    if (!this.client) throw new Error('Client not connected');

    const result = await this.client
      .db(dbName)
      .collection<Document>(collectionName)
      .updateMany(filter, update);

    return result.updated;
  }

  static async deleteMany(
    dbName: string,
    collectionName: string,
    filter: Record<string, unknown>
  ): Promise<number> {
    if (!this.client) throw new Error('Client not connected');

    const result = await this.client
      .db(dbName)
      .collection<Document>(collectionName)
      .deleteMany(filter);

    return result.deleted;
  }

  static async count(
    dbName: string,
    collectionName: string,
    filter: Record<string, unknown> = {}
  ): Promise<number> {
    if (!this.client) throw new Error('Client not connected');

    return this.client.db(dbName).collection<Document>(collectionName).count(filter);
  }

  static async stats(dbName: string, collectionName: string): Promise<Record<string, unknown>> {
    if (!this.client) throw new Error('Client not connected');
    return this.client.db(dbName).collection(collectionName).stats() as unknown as Record<string, unknown>;
  }

  static async databaseStats(dbName: string): Promise<Record<string, unknown>> {
    if (!this.client) throw new Error('Client not connected');
    return this.client.databaseStats(dbName) as unknown as Record<string, unknown>;
  }
}
