import { Router } from "express";
import {
  createIndex,
  listIndexes,
  dropIndex,
  rebuildIndex,
  rebuildAllIndexes,
} from "../controllers/index.controller";

import { authMiddleware } from "../middleware/auth.middleware";
import { userCorsMiddleware } from "../middleware/userCors.middleware";

const router = Router({ mergeParams: true });

router.use(authMiddleware, userCorsMiddleware);

router.get("/", listIndexes);
router.post("/", createIndex);
router.post("/rebuild", rebuildAllIndexes);
router.post("/:field/rebuild", rebuildIndex);
router.delete("/:field", dropIndex);

export default router;
