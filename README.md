# LioranDB

## Documentation

*   [Getting Started](https://github.com/YouthVibe/LioranDB/blob/main/docs/getting-started.md)
*   [CLI Commands](https://github.com/YouthVibe/LioranDB/blob/main/docs/cli.md)
*   [LioranManager](https://github.com/YouthVibe/LioranDB/blob/main/docs/LioranManager.md)
*   [LioranConnector](https://github.com/YouthVibe/LioranDB/blob/main/docs/lioran-connector.md)


Welcome to LioranDB! This documentation will guide you through setting up and using LioranDB, a simple and powerful database solution.

## 1. Installation

To get started with LioranDB, you need to install it via npm. Open your terminal and run the following command:

```bash
npm i liorandb
```

## 2. Running the LioranDB Server

LioranDB can be run in two modes: local and global (P2P).

### Local Mode (Default)

To start the LioranDB server locally, which will be accessible at `http://localhost:2008`, use the `serve` command:

```bash
npx liorandb serve
```

### Global P2P Mode (Coming Soon)

LioranDB will soon support a global P2P mode, allowing your device to be accessible globally via an access-key. This feature is currently under development.

```bash
npx liorandb serve --global # Coming Soon!
```

## 3. Authentication

### Logging In

To log into your LioranDB account and obtain an API key, use the `login` command. This will open an interactive login flow:

```bash
npx liorandb login
```

### Logging Out

To log out and clear all stored credentials, use the `logout` command:

```bash
npx liorandb logout
```

## 4. Using the LioranConnector (Node.js)

The `LioranConnector` class provides a convenient way to interact with your LioranDB instance from your Node.js applications. Below is a comprehensive example demonstrating its usage.

First, import the `LioranConnector`:

```javascript
import { LioranConnector } from "liorandb";
```

Here's a full example:

```javascript
import { LioranConnector } from "liorandb";


async function main() {
  // --- LOGIN ---
  // Before you can interact with LioranDB, you need to log in to get an API key.
  // Replace "http://localhost:2008", "admin", and "admin" with your server URL and credentials.
  const { apiKey } = await LioranConnector.login(
    "http://localhost:2008",
    "admin",
    "admin"
  );


  // Create connector client
  // Initialize the LioranConnector with your server's base URL and the obtained API key.
  const client = new LioranConnector("http://localhost:2008", apiKey);


  // === MONGO STYLE USAGE ===
  // LioranDB provides a MongoDB-like interface for ease of use.

  // You can create and delete databases directly via the client.
  // client.createDatabase("schoolDB");
  // client.deleteDatabase("schoolDB");


  // Get a reference to a specific database. If it doesn't exist, LioranDB will create it.
  const db = client.db("schoolDB");
  // Get a reference to a collection within that database. If it doesn't exist, LioranDB will create it.
  const students = db.collection("students");


  console.log("\n--- INSERT ONE ---");
  // Insert a single document into the "students" collection.
  await students.insertOne({ name: "Swaraj", age: 17 });


  console.log("\n--- FIND ---");
  // Find documents that match a specific query. Here, we find all students with age 17.
  const found = await students.find({ age: 17 });
  console.log(found);


  console.log("\n--- UPDATE MANY ---");
  // Update multiple documents. Here, we change the age of all students named "Swaraj" to 18.
  await students.updateMany({ name: "Swaraj" }, { age: 18 });


  console.log("\n--- FIND AFTER UPDATE ---");
  // Verify the update by finding the document again.
  const updated = await students.find({ name: "Swaraj" });
  console.log(updated);


  console.log("\n--- DELETE MANY ---");
  // Delete multiple documents. Here, we delete all documents in the "students" collection.
  await students.deleteMany({});


  console.log("\n--- LIST DATABASES ---");
  // List all databases currently managed by LioranDB.
  console.log(await client.listDatabases());


  console.log("\nDONE");
}


main().catch(err => console.error("Error:", err));
```

This documentation should help you get started with LioranDB quickly and efficiently. If you have any questions, feel free to refer to other documentation files or reach out to the community.