import { LioranClient } from '@liorandb/driver';
import { Collection, Database, Document, LioranUser } from '@/types';
import { parseConnectionUri } from '@/lib/utils';

type InitializeOptions =
  | { mode: 'uri' }
  | { mode: 'credentials'; username: string; password: string }
  | { mode: 'token'; token: string };

interface SessionSnapshot {
  token: string | null;
  connectionString: string | null;
  user: LioranUser | null;
  uri: string | null;
}

export class LioranDBService {
  private static client: LioranClient | null = null;
  private static session: SessionSnapshot = {
    token: null,
    connectionString: null,
    user: null,
    uri: null,
  };

  static async initialize(uri: string, options: InitializeOptions = { mode: 'uri' }): Promise<SessionSnapshot> {
    const parsed = parseConnectionUri(uri);
    const normalizedUri = parsed.uri;

    const isSecureConnectionString = normalizedUri.startsWith('liorandbs://');

    if (parsed.protocol === 'liorandb' && isSecureConnectionString) {
      const baseUri = `https://${parsed.host}:${parsed.port}`;
      this.client = new LioranClient(baseUri);
      this.client.setConnectionString(normalizedUri);
    } else {
      this.client = new LioranClient(normalizedUri);
    }

    if (options.mode === 'credentials') {
      await this.client.login(options.username, options.password);
    } else if (options.mode === 'token') {
      this.client.setToken(options.token);
      await this.client.me();
    } else if (parsed.protocol === 'lioran' || parsed.protocol === 'liorandb') {
      if (parsed.protocol === 'liorandb' && isSecureConnectionString) {
        // `@liorandb/driver` currently only accepts `liorandb://` in its URI parser,
        // but supports a secure connection string via the connection-string header.
        // This branch sets the connection string explicitly and skips `connect()`.
      } else {
        await this.client.connect();
      }
    } else {
      throw new Error(
        'An http(s) URI needs either a username/password login or an existing token.'
      );
    }

    const derivedUser =
      parsed.protocol === 'liorandb'
        ? ({
            userId: parsed.databaseName ?? 'connection-string',
            username: parsed.username ?? 'connection-string',
            role: 'user',
            authType: 'connection_string',
          } satisfies LioranUser)
        : null;

    this.session = {
      token: this.client.getToken(),
      connectionString: this.client.getConnectionString(),
      user: this.client.getUser() ?? derivedUser,
      uri: normalizedUri,
    };

    return this.session;
  }

  static async restore(uri: string, token?: string): Promise<SessionSnapshot> {
    if (token) {
      return this.initialize(uri, { mode: 'token', token });
    }

    return this.initialize(uri, { mode: 'uri' });
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
      connectionString: null,
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
      dbs.map(async (db) => this.client!.databaseStats(db.databaseName))
    );

    return dbs.map((db, index) => {
      const stat = stats[index];
      const dbName = db.databaseName;

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
    const [documents, count] = await Promise.all([
      collection.find(filter, { limit }),
      collection.count(filter),
    ]);

    return {
      documents,
      count,
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

  static async aggregate<R = Document>(
    dbName: string,
    collectionName: string,
    pipeline: unknown[] = []
  ): Promise<{ documents: R[]; count: number }> {
    if (!this.client) throw new Error('Client not connected');

    const results = await this.client.db(dbName).collection(collectionName).aggregate<R>(pipeline);
    return { documents: results, count: results.length };
  }

  static async stats(dbName: string, collectionName: string): Promise<Record<string, unknown>> {
    if (!this.client) throw new Error('Client not connected');
    return this.client.db(dbName).collection(collectionName).stats() as unknown as Record<string, unknown>;
  }

  static async databaseStats(dbName: string): Promise<Record<string, unknown>> {
    if (!this.client) throw new Error('Client not connected');
    return this.client.databaseStats(dbName) as unknown as Record<string, unknown>;
  }

  static async listDocs() {
    if (!this.client) throw new Error('Client not connected');
    return this.client.listDocs();
  }

  static async getDoc(id: string) {
    if (!this.client) throw new Error('Client not connected');
    return this.client.getDoc(id);
  }

  static async me() {
    if (!this.client) throw new Error('Client not connected');
    return this.client.me();
  }

  static async listUsers() {
    if (!this.client) throw new Error('Client not connected');
    return this.client.listUsers();
  }

  static async issueUserToken(userId: string) {
    if (!this.client) throw new Error('Client not connected');
    return this.client.issueUserToken(userId);
  }

  static async updateMyCors(origins: string[]) {
    if (!this.client) throw new Error('Client not connected');
    return this.client.updateMyCors(origins);
  }

  static async updateUserCors(userId: string, origins: string[]) {
    if (!this.client) throw new Error('Client not connected');
    return this.client.updateUserCors(userId, origins);
  }

  static async maintenanceStatus() {
    if (!this.client) throw new Error('Client not connected');
    return this.client.maintenanceStatus();
  }

  static async listSnapshots() {
    if (!this.client) throw new Error('Client not connected');
    return this.client.listSnapshots();
  }

  static async createSnapshotNow() {
    if (!this.client) throw new Error('Client not connected');
    return this.client.createSnapshotNow();
  }

  static async compactAllDatabases() {
    if (!this.client) throw new Error('Client not connected');
    return this.client.compactAllDatabases();
  }
}
