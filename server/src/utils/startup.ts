import { getAuthCollection } from "../config/database";

export async function hasAdminUser() {
  const users = await getAuthCollection();
  return (await users.count()) > 0;
}
