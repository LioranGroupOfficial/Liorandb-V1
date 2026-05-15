import { Router } from "express";
import {
  createIndex,
  createTextIndex,
  listIndexes,
  dropIndex,
  dropTextIndex,
  rebuildIndex,
  rebuildTextIndex,
  rebuildAllIndexes,
} from "../controllers/index.controller";

import { authMiddleware } from "../middleware/auth.middleware";
import { userCorsMiddleware } from "../middleware/userCors.middleware";

const router = Router({ mergeParams: true });

router.use(authMiddleware, userCorsMiddleware);

router.get("/", listIndexes);
router.post("/", createIndex);
router.post("/text", createTextIndex);
router.post("/rebuild", rebuildAllIndexes);
router.post("/text/:field/rebuild", rebuildTextIndex);
router.post("/:field/rebuild", rebuildIndex);
router.delete("/text/:field", dropTextIndex);
router.delete("/:field", dropIndex);

export default router;
