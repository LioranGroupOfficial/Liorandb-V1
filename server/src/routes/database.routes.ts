import { Router } from "express";
import {
  countDatabases,
  listDatabases,
  listDatabasesByUser,
  createDatabase,
  deleteDatabase,
  renameDatabase,
  databaseStats,
  generateDatabaseConnectionString,
  getDatabaseCredentials,
  upsertDatabaseCredentials,
} from "../controllers/database.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = Router();

router.get("/", authMiddleware, listDatabases);
router.get("/count", authMiddleware, countDatabases);
router.get("/user/:userId", authMiddleware, listDatabasesByUser);
router.post("/", authMiddleware, createDatabase);
router.delete("/:db", authMiddleware, deleteDatabase);
router.patch("/:db/rename", authMiddleware, renameDatabase);
router.get("/:db/stats", authMiddleware, databaseStats);
router.get("/:db/credentials", authMiddleware, getDatabaseCredentials);
router.put("/:db/credentials", authMiddleware, upsertDatabaseCredentials);
router.get("/:db/connection-string", authMiddleware, generateDatabaseConnectionString);

export default router;
