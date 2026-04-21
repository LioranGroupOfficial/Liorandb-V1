import bcrypt from "bcryptjs";
import { Request } from "express";
import { getAuthCollection } from "../config/database";
import { AuthRole, AuthUser, RequestAuthContext } from "../types/auth-user";
import { signToken } from "./token";

export function isAdminRole(role: AuthRole) {
  return role === "admin" || role === "super_admin";
}

export function canManageRole(actorRole: AuthRole, targetRole: AuthRole) {
  if (actorRole === "super_admin") {
    return true;
  }

  return actorRole === "admin" && targetRole === "user";
}

export function getRequestAuth(req: Request) {
  return req.user as RequestAuthContext | undefined;
}

export async function findUserById(userId: string) {
  const users = await getAuthCollection();
  return await users.findOne({ userId }) as AuthUser | null;
}

export async function listUsers() {
  const users = await getAuthCollection();
  const records = await users.find({}) as AuthUser[];
  return records.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function createManagedUser(input: {
  userId?: string;
  username?: string;
  password?: string;
  role: AuthRole;
  externalUserId?: string;
  createdBy: string;
}) {
  const users = await getAuthCollection();
  const username = (input.username || input.userId || input.externalUserId || "").trim();
  const userId = (input.userId || input.externalUserId || input.username || "").trim();

  if (!username || !userId) {
    throw new Error("userId or username is required");
  }

  if (input.password && input.password.length < 6) {
    throw new Error("password must be at least 6 characters");
  }

  const existingByUserId = await users.findOne({ userId });
  if (existingByUserId) {
    throw new Error("userId already exists");
  }

  const existingByUsername = await users.findOne({ username });
  if (existingByUsername) {
    throw new Error("username already exists");
  }

  const passwordHash = input.password
    ? await bcrypt.hash(input.password, 10)
    : undefined;

  const createdAt = new Date().toISOString();

  const created = await users.insertOne({
    userId,
    username,
    role: input.role,
    externalUserId: input.externalUserId,
    passwordHash,
    corsOrigins: undefined,
    corsUpdatedAt: undefined,
    createdAt,
    updatedAt: createdAt,
    createdBy: input.createdBy,
  } as AuthUser) as AuthUser;

  return created;
}

function isValidOrigin(origin: string) {
  if (origin === "*") return true;
  try {
    const u = new URL(origin);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    if (u.pathname !== "/" || u.search || u.hash) return false;
    return true;
  } catch {
    return false;
  }
}

export async function setUserCorsOrigins(input: {
  actor: RequestAuthContext;
  targetUserId: string;
  origins: string[];
}) {
  const users = await getAuthCollection();
  const target = await users.findOne({ userId: input.targetUserId }) as AuthUser | null;
  if (!target) {
    throw new Error("user not found");
  }

  const canEditSelf = input.actor.authType === "jwt" && input.actor.userId === target.userId;
  const canEditOthers = input.actor.authType === "jwt" && isAdminRole(input.actor.role);

  if (!canEditSelf && !canEditOthers) {
    throw new Error("forbidden");
  }

  const unique = Array.from(new Set(
    (input.origins || [])
      .map((o) => (typeof o === "string" ? o.trim() : ""))
      .filter(Boolean)
  ));

  if (unique.length > 50) {
    throw new Error("too many origins");
  }

  for (const origin of unique) {
    if (!isValidOrigin(origin)) {
      throw new Error(`invalid origin: ${origin}`);
    }
  }

  const updatedAt = new Date().toISOString();
  const updated = {
    ...target,
    corsOrigins: unique.length ? unique : undefined,
    corsUpdatedAt: unique.length ? updatedAt : undefined,
    updatedAt,
  } as AuthUser;

  // Replace record (simple, consistent with existing patterns)
  await users.deleteMany({ userId: target.userId });
  await users.insertOne(updated as AuthUser);

  return {
    userId: updated.userId,
    corsOrigins: updated.corsOrigins || [],
    corsUpdatedAt: updated.corsUpdatedAt || null,
    updatedAt: updated.updatedAt,
  };
}

export function buildAuthTokenPayload(user: Pick<AuthUser, "userId" | "username" | "role" | "externalUserId">) {
  return {
    userId: user.userId,
    username: user.username,
    role: user.role,
    externalUserId: user.externalUserId,
    authType: "jwt" as const,
  };
}

export function issueUserToken(user: Pick<AuthUser, "userId" | "username" | "role" | "externalUserId">) {
  return signToken(buildAuthTokenPayload(user));
}
