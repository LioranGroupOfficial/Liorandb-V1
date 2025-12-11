import { Router } from "express";
import {
  listDatabases,
  createDatabase,
  deleteDatabase,
} from "../controllers/database.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = Router();

router.get("/", authMiddleware, listDatabases);
router.post("/", authMiddleware, createDatabase);
router.delete("/:db", authMiddleware, deleteDatabase);

export default router;
