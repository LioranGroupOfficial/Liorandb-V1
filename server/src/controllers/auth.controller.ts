// src/controllers/auth.controller.ts
import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { getAuthCollection } from "../config/database";
import { signToken } from "../utils/token";
import { AuthUser } from "../types/auth-user";

export const register = async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body as { username?: string; password?: string };

    if (!username || !password)
      return res.status(400).json({ error: "username and password required" });

    if (typeof username !== "string" || typeof password !== "string")
      return res.status(400).json({ error: "invalid types" });

    if (password.length < 6)
      return res.status(400).json({ error: "password must be at least 6 characters" });

    const users = await getAuthCollection(); // typed as AuthUser collection
    const existing = await users.findOne({ username });
    if (existing) return res.status(409).json({ error: "username already exists" });

    const hashed = await bcrypt.hash(password, 10);
    const created = await users.insertOne({
      username,
      password: hashed,
      createdAt: new Date().toISOString(),
    } as AuthUser) as AuthUser;

    const token = signToken({ id: created._id, username });

    res.json({ user: { id: created._id, username }, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error" });
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

    // user is typed as AuthUser so .password exists
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: "invalid credentials" });

    const token = signToken({ id: user._id, username });

    res.json({ user: { id: user._id, username }, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error" });
  }
};
