import { LioranClient } from "../dist/index.js";

const client = new LioranClient("lioran://admin:admin@n1.lioransolutions.com:443");
await client.connect();

const db = await client.db("test");
const collection = await db.collection("test");

await collection.insertOne({ name: "John", age: 30 });
const result = await collection.findOne({ name: "John" });
console.log(result);
