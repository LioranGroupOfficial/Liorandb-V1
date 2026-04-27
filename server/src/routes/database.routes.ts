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
  compactDatabase,
  explainDatabase,
  runTransaction,
} from "../controllers/database.controller";
import { authMiddleware } from "../middleware/auth.middleware";
import { userCorsMiddleware } from "../middleware/userCors.middleware";

const router = Router();

router.use(authMiddleware, userCorsMiddleware);

router.get("/", listDatabases);
router.get("/count", countDatabases);
router.get("/user/:userId", listDatabasesByUser);
router.post("/", createDatabase);
router.delete("/:db", deleteDatabase);
router.patch("/:db/rename", renameDatabase);
router.get("/:db/stats", databaseStats);
router.get("/:db/credentials", getDatabaseCredentials);
router.put("/:db/credentials", upsertDatabaseCredentials);
router.get("/:db/connection-string", generateDatabaseConnectionString);

router.post("/:db/compact", compactDatabase);
router.post("/:db/explain", explainDatabase);
router.post("/:db/transaction", runTransaction);

export default router;
