import { LioranManager } from "@liorandb/core";

const manager = new LioranManager();
// manager.createDatabase("test");
const db = await manager.db("test");

const users = await db.collection("users");

await users.insertOne({
  name: "Swaraj Puppalwar",
  age: 25,
});

// await users.deleteMany({});
console.log(await users.find({}));
// console.log(await users.find({ _id: "f990921e-77fc-44ad-a177-4cf31f947fa6" }));