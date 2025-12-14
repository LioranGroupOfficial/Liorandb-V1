import { Command } from "commander";
import { getAuthCollection } from "../src/config/database";
import bcrypt from "bcryptjs";
import { AuthUser } from "../src/types/auth-user";

const program = new Command();

program
  .name("liorandb-cli")
  .description("CLI to manage LioranDB users and permissions")
  .version("1.0.0");

program
  .command("user")
  .description("Manage users")
  .command("create <username> <password>")
  .description("Create a new user")
  .action(async (username, password) => {
    try {
      const users = await getAuthCollection();
      const existing = await users.findOne({ username });
      if (existing) {
        console.error("Error: Username already exists.");
        process.exit(1);
      }

      const hashed = await bcrypt.hash(password, 10);
      await users.insertOne({
        username,
        password: hashed,
        createdAt: new Date().toISOString(),
      } as AuthUser);

      console.log(`User '${username}' created successfully.`);
      process.exit(0);
    } catch (error) {
      console.error("Error creating user:", error);
      process.exit(1);
    }
  });

program.parse(process.argv);
