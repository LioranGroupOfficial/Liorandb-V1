import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { userCorsMiddleware } from "../middleware/userCors.middleware";
import { coreDbSchemaVersion, coreDbStatus, coreIpcMode, coreManagers, coreStatus, listEngineDatabases, setCoreDbSchemaVersion } from "../controllers/core.controller";

const router = Router();

router.use(authMiddleware, userCorsMiddleware);

router.get("/status", coreStatus);
router.get("/ipc", coreIpcMode);
router.get("/managers", coreManagers);
router.get("/databases", listEngineDatabases);

router.get("/databases/:db/status", coreDbStatus);
router.get("/databases/:db/schemaVersion", coreDbSchemaVersion);
router.put("/databases/:db/schemaVersion", setCoreDbSchemaVersion);

export default router;

