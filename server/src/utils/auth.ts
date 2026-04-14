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
    createdAt,
    updatedAt: createdAt,
    createdBy: input.createdBy,
  } as AuthUser) as AuthUser;

  return created;
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
