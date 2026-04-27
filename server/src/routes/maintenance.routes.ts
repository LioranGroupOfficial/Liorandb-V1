import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { userCorsMiddleware } from "../middleware/userCors.middleware";
import {
  createSnapshotNow,
  listSnapshotFiles,
  maintenanceStatus,
  compactAllDatabases,
} from "../controllers/maintenance.controller";

const router = Router();

router.use(authMiddleware, userCorsMiddleware);

router.get("/status", maintenanceStatus);
router.get("/snapshots", listSnapshotFiles);
router.post("/snapshots", createSnapshotNow);

router.post("/compact/all", compactAllDatabases);

export default router;
