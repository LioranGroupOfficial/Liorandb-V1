import { Router } from "express";
import {
  listCollections,
  createCollection,
  deleteCollection,
  renameCollection,
  collectionStats,
} from "../controllers/collection.controller";

import { authMiddleware } from "../middleware/auth.middleware";
import { userCorsMiddleware } from "../middleware/userCors.middleware";

const router = Router({ mergeParams: true });

router.use(authMiddleware, userCorsMiddleware);

router.get("/", listCollections);
router.post("/", createCollection);
router.delete("/:col", deleteCollection);
router.patch("/:col/rename", renameCollection);
router.get("/:col/stats", collectionStats);

export default router;
