# P2P-DB Documentation

Welcome to the P2P-DB documentation. This database is designed for peer-to-peer applications.

## Getting Started

## API Reference

### LioranManager

The `LioranManager` class is the entry point for interacting with the P2P-DB. It allows you to manage multiple databases.

#### Constructor

`new LioranManager()`

Initializes a new `LioranManager` instance. It sets up the root path for storing databases.

#### Methods

- `createDatabase(name)`: Creates a new database with the given name.
- `openDatabase(name)`: Opens an existing database.
- `closeDatabase(name)`: Closes an open database.
- `renameDatabase(oldName, newName)`: Renames an existing database.
- `deleteDatabase(name)`: Deletes a database and all its contents.
- `listDatabases()`: Lists all available databases.

### LioranDB

The `LioranDB` class represents a single database and provides methods for managing collections within that database.

#### Constructor

`new LioranDB(basePath, dbName, manager)`

- `basePath`: The base path where the database files are stored.
- `dbName`: The name of the database.
- `manager`: A reference to the `LioranManager` instance.

#### Methods

- `collection(name)`: Retrieves or creates a collection with the given name.
- `renameCollection(oldName, newName)`: Renames an existing collection.
- `dropCollection(name)`: Deletes a collection and all its documents.

### Collection

The `Collection` class represents a collection within a database and provides methods for performing CRUD operations on documents.

#### Constructor

`new Collection(dir)`

- `dir`: The directory where the collection's data is stored.

#### Methods

- `close()`: Closes the underlying database connection for the collection.
- `insertOne(doc)`: Inserts a single document into the collection.
- `insertMany(docs)`: Inserts multiple documents into the collection.
- `find(query)`: Finds documents matching the given query.
- `findOne(query)`: Finds a single document matching the given query.
- `updateOne(filter, update, options)`: Updates a single document matching the filter.
- `updateMany(filter, update)`: Updates multiple documents matching the filter.
- `deleteOne(filter)`: Deletes a single document matching the filter.
- `deleteMany(filter)`: Deletes multiple documents matching the filter.
- `countDocuments(filter)`: Counts documents matching the given filter.

### Query Utilities

These functions are used internally for document matching and updating.

#### `matchDocument(doc, query)`

Compares a document against a query to determine if it matches. Supports various operators like `$gt`, `$gte`, `$lt`, `$lte`, `$ne`, and `$in`.

#### `applyUpdate(oldDoc, update)`

Applies update operations to a document. Supports `$set` and `$inc` operators, as well as direct merging of properties.

The `LioranManager` class is the entry point for interacting with the P2P-DB. It allows you to manage multiple databases.

#### Constructor

`new LioranManager()`

Initializes a new `LioranManager` instance. It sets up the root path for storing databases.

#### Methods

- `createDatabase(name)`: Creates a new database with the given name.
- `openDatabase(name)`: Opens an existing database.
- `closeDatabase(name)`: Closes an open database.
- `renameDatabase(oldName, newName)`: Renames an existing database.
- `deleteDatabase(name)`: Deletes a database and all its contents.
- `listDatabases()`: Lists all available databases.

## Examples