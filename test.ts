import { LioranDBClient } from "./src/index";

const init = async () => {

    const client = new LioranDBClient("lioran://admin:admin@localhost:4000");

    await client.connect();

    const db = client.db("testDB");
    const users = db.collection("users");

    // await users.insertOne({ name: "Swaraj", age: 17 });
    await users.deleteOne({})

    const res = await users.find({});
    console.log(res);
}

init();