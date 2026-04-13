import bcrypt from "bcryptjs";
import { getAuthCollection } from "../config/database";
import { AuthUser } from "../types/auth-user";

const DEFAULT_ADMIN_USERNAME = "admin";
const DEFAULT_ADMIN_PASSWORD = "admin";

export async function ensureAdminUser() {
  const users = await getAuthCollection();
  const adminUser = await users.findOne({ username: DEFAULT_ADMIN_USERNAME });

  if (adminUser) {
    return { created: false, username: DEFAULT_ADMIN_USERNAME };
  }

  const hashedPassword = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10);

  await users.insertOne({
    username: DEFAULT_ADMIN_USERNAME,
    password: hashedPassword,
    createdAt: new Date().toISOString(),
  } as AuthUser);

  return { created: true, username: DEFAULT_ADMIN_USERNAME };
}
