// demo.js
import { LioranManager } from "./src/index.js";

async function main() {
  const manager = new LioranManager();

  console.log("\n=== CREATE MULTIPLE DATABASES ===");
  await manager.createDatabase("schoolDB");
  await manager.createDatabase("companyDB");
  console.log(await manager.listDatabases());

  console.log("\n=== OPEN schoolDB ===");
  const school = await manager.openDatabase("schoolDB");

  console.log("\n=== CREATE MULTIPLE COLLECTIONS ===");
  const students = school.collection("students");
  const teachers = school.collection("teachers");

  console.log("\n=== INSERT MANY STUDENTS ===");
  await students.insertMany([
    { name: "Swaraj", age: 17, class: "12th" },
    { name: "Vedant", age: 15, class: "10th" },
    { name: "Sakshi", age: 13, class: "8th" },
    { name: "Aryan", age: 18, class: "12th" },
    { name: "Pooja", age: 12, class: "7th" }
  ]);
  console.log(await students.find({}));

  console.log("\n=== INSERT TEACHERS ===");
  await teachers.insertMany([
    { name: "Mrs. Patil", subject: "Maths" },
    { name: "Mr. Sharma", subject: "Science" }
  ]);
  console.log(await teachers.find({}));

  console.log("\n=== FIND TEENS (13–19) ===");
  console.log(await students.find({ age: { $gte: 13, $lte: 19 } }));

  console.log("\n=== FIND MINORS (<18) ===");
  console.log(await students.find({ age: { $lt: 18 } }));

  console.log("\n=== UPDATE MANY ===");
  await students.updateMany({}, { $inc: { age: 1 } });
  console.log(await students.find({}));

  console.log("\n=== DELETE MANY ===");
  console.log("Removed:", await students.deleteMany({ age: { $gte: 18 } }));
  console.log(await students.find({}));

  console.log("\n=== RENAME COLLECTION teachers → faculty ===");
  await school.renameCollection("teachers", "faculty");
  console.log(await school.collection("faculty").find({}));

  console.log("\n=== RENAME DATABASE schoolDB → educationDB ===");
  await manager.renameDatabase("schoolDB", "educationDB");
  console.log(await manager.listDatabases());

  console.log("\n=== DELETE DATABASE ===");
  await manager.deleteDatabase("companyDB");
  console.log(await manager.listDatabases());
}

main();
