import { Router } from "express";
import {
  listCollections,
  createCollection,
  deleteCollection,
  renameCollection,
  collectionStats,
} from "../controllers/collection.controller";

import { authMiddleware } from "../middleware/auth.middleware";

const router = Router({ mergeParams: true });

router.get("/", authMiddleware, listCollections);
router.post("/", authMiddleware, createCollection);
router.delete("/:col", authMiddleware, deleteCollection);
router.patch("/:col/rename", authMiddleware, renameCollection);
router.get("/:col/stats", authMiddleware, collectionStats);

export default router;
