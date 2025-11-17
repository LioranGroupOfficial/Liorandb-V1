import fetch from "node-fetch";

// =======================================
// 1. MAIN CONNECTOR CLASS
// =======================================
class LioranConnector {
  constructor(baseURL, apiKey) {
    this.baseURL = baseURL.replace(/\/$/, "");
    this.apiKey = apiKey;
  }

  // Generic request helper
  async request(path, method = "GET", body) {
    const options = {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey
      }
    };

    if (method !== "GET" && method !== "HEAD" && body) {
      options.body = JSON.stringify(body);
    }

    const res = await fetch(`${this.baseURL}${path}`, options);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  // ==========================
  // DATABASE HANDLING
  // ==========================
  async listDatabases() {
    return this.request("/db", "GET").then(r => r.databases);
  }

  async createDatabase(name) {
    return this.request("/db", "POST", { name });
  }

  async deleteDatabase(name) {
    return this.request(`/db/${name}`, "DELETE");
  }

  // --- Ensure DB exists before docs API ---
  async ensureDBExists(dbName) {
    const dbs = await this.listDatabases();
    if (!dbs.includes(dbName)) {
      await this.createDatabase(dbName);
    }
  }

  // ==========================
  // COLLECTION HANDLING
  // ==========================
  async listCollections(dbName) {
    const result = await this.request(`/db/${dbName}/collection`, "GET");
    return result.collections || [];
  }

  async createCollection(dbName, colName) {
    return this.request(`/db/${dbName}/collection`, "POST", { name: colName });
  }

  async ensureCollectionExists(dbName, colName) {
    const cols = await this.listCollections(dbName);
    if (!cols.includes(colName)) {
      await this.createCollection(dbName, colName);
    }
  }

  // ==========================
  // DOCUMENT METHODS
  // ==========================
  async insertOne(db, col, doc) {
    await this.ensureDBExists(db);
    await this.ensureCollectionExists(db, col);
    return this.request(`/db/${db}/collection/${col}/doc`, "POST", { document: doc });
  }

  async find(db, col, query = {}) {
    await this.ensureDBExists(db);
    await this.ensureCollectionExists(db, col);
  
    const q = encodeURIComponent(JSON.stringify(query));
    return this.request(`/db/${db}/collection/${col}/doc?q=${q}`, "GET")
      .then(r => r.documents);
  }  

  async updateMany(db, col, filter, update) {
    await this.ensureDBExists(db);
    await this.ensureCollectionExists(db, col);
    return this.request(`/db/${db}/collection/${col}/doc`, "PUT", { filter, update });
  }

  async deleteMany(db, col, filter) {
    await this.ensureDBExists(db);
    await this.ensureCollectionExists(db, col);
    return this.request(`/db/${db}/collection/${col}/doc`, "DELETE", { filter });
  }

  // ==========================
  // AUTH
  // ==========================
  static async login(baseURL, username, password) {
    const res = await fetch(`${baseURL}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Login failed");
    return data; // { apiKey, expires }
  }
}

// =======================================
// 2. MONGO-LIKE WRAPPER CLASSES
// =======================================

class LioranCollectionWrapper {
  constructor(connector, dbName, collectionName) {
    this.connector = connector;
    this.dbName = dbName;
    this.collectionName = collectionName;
  }

  insertOne(doc) {
    return this.connector.insertOne(this.dbName, this.collectionName, doc);
  }

  find(query = {}) {
    return this.connector.find(this.dbName, this.collectionName, query);
  }

  updateMany(filter, update) {
    return this.connector.updateMany(this.dbName, this.collectionName, filter, update);
  }

  deleteMany(filter) {
    return this.connector.deleteMany(this.dbName, this.collectionName, filter);
  }
}

class LioranDBWrapper {
  constructor(connector, dbName) {
    this.connector = connector;
    this.dbName = dbName;
  }

  collection(name) {
    return new LioranCollectionWrapper(this.connector, this.dbName, name);
  }

  dropDatabase() {
    return this.connector.deleteDatabase(this.dbName);
  }
}

// =======================================
// 3. EXTEND CONNECTOR WITH .db()
// =======================================

LioranConnector.prototype.db = function (dbName) {
  return new LioranDBWrapper(this, dbName);
};

// =======================================
// 4. EXPORT
// =======================================

export { LioranConnector };
