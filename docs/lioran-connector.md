# LioranConnector

The `LioranConnector` is the primary class for interacting with your LioranDB instance programmatically from Node.js applications. It provides methods for database, collection, and document management, as well as authentication.

## Table of Contents
*   [Getting Started](../getting-started.md)
*   [CLI Commands](./cli.md)
*   [LioranManager](./LioranManager.md)

## Installation

First, ensure you have LioranDB installed in your project:

```bash
npm i liorandb
```

Then, import `LioranConnector` into your JavaScript file:

```javascript
import { LioranConnector } from "liorandb";
```

## Authentication

Before you can perform any database operations, you need to authenticate and obtain an API key.

### `static async LioranConnector.login(baseURL, username, password)`

Logs into your LioranDB account and returns an API key.

*   `baseURL`: The base URL of your LioranDB server (e.g., `http://localhost:2008`).
*   `username`: Your LioranDB username.
*   `password`: Your LioranDB password.

**Returns**: An object containing `apiKey` and `expires`.

**Example**:

```javascript
import { LioranConnector } from "liorandb";

async function authenticate() {
  try {
    const { apiKey, expires } = await LioranConnector.login(
      "http://localhost:2008",
      "admin",
      "admin"
    );
    console.log("Logged in successfully! API Key:", apiKey);
    return apiKey;
  } catch (error) {
    console.error("Login failed:", error.message);
    return null;
  }
}
```

## Initializing the Connector

Once you have an API key, you can create an instance of `LioranConnector`.

### `new LioranConnector(baseURL, apiKey)`

Creates a new instance of the LioranDB connector.

*   `baseURL`: The base URL of your LioranDB server.
*   `apiKey`: The API key obtained from the login process.

**Example**:

```javascript
import { LioranConnector } from "liorandb";

async function getClient() {
  const apiKey = await authenticate(); // Assume authenticate() returns the API key
  if (apiKey) {
    const client = new LioranConnector("http://localhost:2008", apiKey);
    console.log("LioranConnector client initialized.");
    return client;
  }
  return null;
}
```

## Database Operations (Mongo-like API)

The `LioranConnector` provides a convenient, MongoDB-like API for interacting with databases, collections, and documents.

### `client.db(dbName)`

Returns a `LioranDBWrapper` instance for the specified database. If the database does not exist, it will be created implicitly when you perform operations on its collections.

*   `dbName`: The name of the database.

**Returns**: A `LioranDBWrapper` instance.

**Example**:

```javascript
const db = client.db("myDatabase");
console.log(`Connected to database: ${db.dbName}`);
```

### `db.collection(collectionName)`

Returns a `LioranCollectionWrapper` instance for the specified collection within the database. If the collection does not exist, it will be created implicitly when you insert documents.

*   `collectionName`: The name of the collection.

**Returns**: A `LioranCollectionWrapper` instance.

**Example**:

```javascript
const usersCollection = db.collection("users");
console.log(`Accessed collection: ${usersCollection.collectionName}`);
```

### `collection.insertOne(doc)`

Inserts a single document into the collection.

*   `doc`: The document to insert.

**Example**:

```javascript
await usersCollection.insertOne({ name: "Alice", age: 30 });
console.log("Document inserted.");
```

### `collection.find(query = {})`

Finds documents in the collection that match the specified query.

*   `query`: An optional query object to filter documents. If empty, all documents are returned.

**Returns**: An array of matching documents.

**Example**:

```javascript
const alice = await usersCollection.find({ name: "Alice" });
console.log("Found Alice:", alice);
```

### `collection.updateMany(filter, update)`

Updates multiple documents in the collection that match the specified filter.

*   `filter`: An object to filter the documents to be updated.
*   `update`: An object containing the fields and values to update.

**Example**:

```javascript
await usersCollection.updateMany({ name: "Alice" }, { age: 31 });
console.log("Document updated.");
```

### `collection.deleteMany(filter)`

Deletes multiple documents from the collection that match the specified filter.

*   `filter`: An object to filter the documents to be deleted.

**Example**:

```javascript
await usersCollection.deleteMany({ name: "Alice" });
console.log("Document deleted.");
```

### `client.listDatabases()`

Lists all databases managed by the LioranDB instance.

**Returns**: An array of database names.

**Example**:

```javascript
const databases = await client.listDatabases();
console.log("Available databases:", databases);
```

### `client.createDatabase(name)`

Creates a new database with the specified name.

*   `name`: The name of the database to create.

**Example**:

```javascript
await client.createDatabase("newDB");
console.log("Database 'newDB' created.");
```

### `client.deleteDatabase(name)` or `db.dropDatabase()`

Deletes the specified database.

*   `name`: The name of the database to delete.

**Example**:

```javascript
await client.deleteDatabase("newDB");
console.log("Database 'newDB' deleted.");
// Or using the DB wrapper:
// await db.dropDatabase();
```

## Full Example

For a complete example demonstrating the usage of `LioranConnector` with various operations, refer to the [Developer Documentation](../LioranDB-dev-docs.md).