import bcrypt from "bcryptjs";
import { getAuthCollection, manager } from "../config/database";
import { AuthUser } from "../types/auth-user";

const DEFAULT_ADMIN_USERNAME = "admin";
const DEFAULT_ADMIN_PASSWORD = "admin";

export async function ensureAdminUser() {
  if (manager.isReadOnly()) {
    return { created: false, username: DEFAULT_ADMIN_USERNAME, skipped: true };
  }

  const users = await getAuthCollection();
  const adminUser = await users.findOne({ username: DEFAULT_ADMIN_USERNAME });

  if (adminUser) {
    return { created: false, username: DEFAULT_ADMIN_USERNAME };
  }

  const hashedPassword = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10);
  const createdAt = new Date().toISOString();

  await users.insertOne({
    userId: DEFAULT_ADMIN_USERNAME,
    username: DEFAULT_ADMIN_USERNAME,
    role: "admin",
    passwordHash: hashedPassword,
    createdAt,
    updatedAt: createdAt,
    createdBy: "system",
  } as AuthUser);

  return { created: true, username: DEFAULT_ADMIN_USERNAME };
}
