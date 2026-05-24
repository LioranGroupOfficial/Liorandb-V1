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
  rotateDatabaseEncryptionKey,
} from "../controllers/database.controller.js";
import { applyDbMigrations, getDbSchemaVersion, setDbSchemaVersion } from "../controllers/migrations.controller.js";
import { authMiddleware } from "../middleware/auth.middleware.js";
import { userCorsMiddleware } from "../middleware/userCors.middleware.js";

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
router.get("/:db/schemaVersion", getDbSchemaVersion);
router.put("/:db/schemaVersion", setDbSchemaVersion);
router.post("/:db/migrations/apply", applyDbMigrations);
router.post("/:db/encryption/rotate", rotateDatabaseEncryptionKey);

export default router;

