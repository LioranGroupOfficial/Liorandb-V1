import bcrypt from "bcryptjs";
import { getAuthCollection, manager, recreateManager } from "../config/database";
import { AuthUser } from "../types/auth-user";

function getDefaultAdminCreds() {
  const username = (process.env.LIORANDB_DEFAULT_ADMIN_USERNAME || "admin").trim() || "admin";
  const password = process.env.LIORANDB_DEFAULT_ADMIN_PASSWORD || "admin";
  return { username, password };
}

export async function ensureAdminUser() {
  type RecoverableCoreError = {
    code?: unknown;
    message?: unknown;
    name?: unknown;
  };

  function isRecoverableCoreError(error: unknown) {
    const err = error as RecoverableCoreError | null | undefined;
    const code = typeof err?.code === "string" ? err.code : undefined;
    const message = typeof err?.message === "string" ? err.message : "";
    const name = typeof err?.name === "string" ? err.name : "";

    if (code === "LEVEL_ITERATOR_NOT_OPEN") return true;
    if (code === "LEVEL_DATABASE_NOT_OPEN") return true;
    if (code === "CLOSED") return true;

    if (name === "ModuleError" && /iterator is not open/i.test(message)) return true;
    if (/cannot call next\(\) after close\(\)/i.test(message)) return true;
    if (/lifecyclemanager is closed/i.test(message)) return true;

    return false;
  }

  async function ensureOnce() {
    const { username: DEFAULT_ADMIN_USERNAME, password: DEFAULT_ADMIN_PASSWORD } = getDefaultAdminCreds();
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

  try {
    return await ensureOnce();
  } catch (error) {
    if (!isRecoverableCoreError(error)) throw error;
    console.error(
      `[core-recovery] ${String((error as any)?.code || (error as any)?.name || "error")} during admin bootstrap. Recreating manager...`
    );
    await recreateManager();
    return ensureOnce();
  }
}
