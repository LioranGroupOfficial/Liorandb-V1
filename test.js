// test.js
import { LioranManager } from "./src/index.js";

async function runTests() {
  console.log("===== LioranDB Test Started =====\n");

  const manager = new LioranManager();
  const dbName = "testDB";
  const collectionName = "users";

  // Open or create database
  const db = await manager.db(dbName);
  const users = db.collection(collectionName);

  let testResults = [];

  // ---------------------------
  // Test 1: InsertOne
  // ---------------------------
  try {
    const user = await users.insertOne({
      name: "Swaraj Puppalwar",
      email: "swaraj.puppalwar@gmail.com",
      age: 17,
    });

    testResults.push(user._id ? "InsertOne ✅" : "InsertOne ❌");
  } catch (err) {
    testResults.push(`InsertOne ❌ (${err.message})`);
  }

  // ---------------------------
  // Test 2: Find
  // ---------------------------
  try {
    const allUsers = await users.find({});
    testResults.push(allUsers.length > 0 ? "Find ✅" : "Find ❌");
  } catch (err) {
    testResults.push(`Find ❌ (${err.message})`);
  }

  // ---------------------------
  // Test 3: UpdateOne
  // ---------------------------
  try {
    const updated = await users.updateOne(
      { name: "Swaraj Puppalwar" },
      { $set: { age: 18 } }
    );
    testResults.push(updated?.age === 18 ? "UpdateOne ✅" : "UpdateOne ❌");
  } catch (err) {
    testResults.push(`UpdateOne ❌ (${err.message})`);
  }

  // ---------------------------
  // Test 4: UpdateMany
  // ---------------------------
  try {
    await users.insertOne({ name: "Test User 1", age: 20 });
    await users.insertOne({ name: "Test User 2", age: 25 });
    const updatedMany = await users.updateMany(
      { age: { $gte: 18 } },
      { $inc: { age: 1 } }
    );
    testResults.push(
      updatedMany.length >= 3 ? "UpdateMany ✅" : "UpdateMany ❌"
    );
  } catch (err) {
    testResults.push(`UpdateMany ❌ (${err.message})`);
  }

  // ---------------------------
  // Test 5: DeleteOne
  // ---------------------------
  try {
    const deleted = await users.deleteOne({ name: "Test User 1" });
    testResults.push(deleted ? "DeleteOne ✅" : "DeleteOne ❌");
  } catch (err) {
    testResults.push(`DeleteOne ❌ (${err.message})`);
  }

  // ---------------------------
  // Test 6: DeleteMany
  // ---------------------------
  try {
    const countDeleted = await users.deleteMany({ age: { $gte: 18 } });
    testResults.push(countDeleted > 0 ? "DeleteMany ✅" : "DeleteMany ❌");
  } catch (err) {
    testResults.push(`DeleteMany ❌ (${err.message})`);
  }

  // ---------------------------
  // Test 7: CountDocuments
  // ---------------------------
  try {
    await users.insertOne({ name: "Final User", age: 30 });
    const count = await users.countDocuments({});
    testResults.push(count === 1 ? "CountDocuments ✅" : "CountDocuments ❌");
  } catch (err) {
    testResults.push(`CountDocuments ❌ (${err.message})`);
  }

  // ---------------------------
  // Display Results
  // ---------------------------
  console.log("\n===== Test Results =====");
  testResults.forEach((r) => console.log(r));

  console.log("\n===== Current Collection Data =====");
  console.log(await users.find({}));

  // ---------------------------
  // Cleanup
  // ---------------------------
  console.log("\nCleaning up...");
  await manager.dropDatabase(dbName);
  console.log("Database removed. Test finished.\n");
}

// Run tests
runTests().catch((err) => console.error("Test run failed:", err));
