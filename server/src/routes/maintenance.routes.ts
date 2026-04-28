import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { userCorsMiddleware } from "../middleware/userCors.middleware";
import {
  createSnapshotNow,
  listSnapshotFiles,
  maintenanceStatus,
  compactAllDatabases,
  stopServer,
  pauseServer,
  resumeServer,
} from "../controllers/maintenance.controller";

const router = Router();

// secret-based server stop (does not require JWT auth)
router.post("/stop", stopServer);
router.post("/pause", pauseServer);
router.post("/resume", resumeServer);

router.use(authMiddleware, userCorsMiddleware);

router.get("/status", maintenanceStatus);
router.get("/snapshots", listSnapshotFiles);
router.post("/snapshots", createSnapshotNow);

router.post("/compact/all", compactAllDatabases);

export default router;
