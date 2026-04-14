// src/controllers/auth.controller.ts
import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { getAuthCollection } from "../config/database";
import { AuthRole, AuthUser } from "../types/auth-user";
import {
  buildAuthTokenPayload,
  canManageRole,
  createManagedUser,
  findUserById,
  getRequestAuth,
  issueUserToken,
  listUsers
} from "../utils/auth";
import { JWT_SECRET } from "../utils/token";

export const register = async (req: Request, res: Response) => {
  try {
    const actor = getRequestAuth(req);
    if (!actor || (actor.role !== "admin" && actor.role !== "super_admin")) {
      return res.status(403).json({ error: "admin access required" });
    }

    const {
      userId,
      username,
      password,
      role = "user",
      externalUserId,
    } = req.body as {
      userId?: string;
      username?: string;
      password?: string;
      role?: AuthRole;
      externalUserId?: string;
    };

    if (!canManageRole(actor.role, role)) {
      return res.status(403).json({ error: "cannot create this role" });
    }

    const created = await createManagedUser({
      userId,
      username,
      password,
      role,
      externalUserId,
      createdBy: actor.userId,
    });

    const token = password ? issueUserToken(created) : null;

    res.json({
      user: buildAuthTokenPayload(created),
      token,
      secretBacked: false,
    });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err instanceof Error ? err.message : "server error" });
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body as { username?: string; password?: string };

    if (!username || !password)
      return res.status(400).json({ error: "username and password required" });

    const users = await getAuthCollection();
    const user = await users.findOne({ username }) as AuthUser | null;

    if (!user) return res.status(401).json({ error: "invalid credentials" });

    if (!user.passwordHash) {
      return res.status(401).json({ error: "password login is not enabled for this user" });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: "invalid credentials" });

    const token = issueUserToken(user);

    res.json({ user: buildAuthTokenPayload(user), token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error" });
  }
};

export const loginSuperAdmin = async (req: Request, res: Response) => {
  const { secret } = req.body as { secret?: string };

  if (!secret) {
    return res.status(400).json({ error: "secret required" });
  }

  if (secret !== JWT_SECRET) {
    return res.status(401).json({ error: "invalid super admin secret" });
  }

  const payload = {
    authType: "jwt" as const,
    userId: "super-admin",
    username: "super-admin",
    role: "super_admin" as const,
  };

  return res.json({
    user: payload,
    token: issueUserToken(payload),
    secretBacked: true,
  });
};

export const me = async (req: Request, res: Response) => {
  const auth = getRequestAuth(req);

  if (!auth) {
    return res.status(401).json({ error: "authentication required" });
  }

  return res.json({ user: auth });
};

export const listManagedUsers = async (req: Request, res: Response) => {
  const auth = getRequestAuth(req);

  if (!auth || (auth.role !== "admin" && auth.role !== "super_admin")) {
    return res.status(403).json({ error: "admin access required" });
  }

  const users = await listUsers();
  return res.json({
    users: users.map((user) => ({
      userId: user.userId,
      username: user.username,
      role: user.role,
      externalUserId: user.externalUserId || null,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      createdBy: user.createdBy,
      passwordEnabled: !!user.passwordHash,
    })),
  });
};

export const issueManagedUserToken = async (req: Request, res: Response) => {
  const auth = getRequestAuth(req);
  if (!auth || (auth.role !== "admin" && auth.role !== "super_admin")) {
    return res.status(403).json({ error: "admin access required" });
  }

  const user = await findUserById(req.params.userId);
  if (!user) {
    return res.status(404).json({ error: "user not found" });
  }

  if (!canManageRole(auth.role, user.role) && auth.userId !== user.userId) {
    return res.status(403).json({ error: "cannot issue token for this user" });
  }

  return res.json({
    user: buildAuthTokenPayload(user),
    token: issueUserToken(user),
  });
};
