import { Router } from "express";
import {
  listDatabases,
  createDatabase,
  deleteDatabase,
  renameDatabase,
  databaseStats,
} from "../controllers/database.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = Router();

router.get("/", authMiddleware, listDatabases);
router.post("/", authMiddleware, createDatabase);
router.delete("/:db", authMiddleware, deleteDatabase);
router.patch("/:db/rename", authMiddleware, renameDatabase);
router.get("/:db/stats", authMiddleware, databaseStats);

export default router;
