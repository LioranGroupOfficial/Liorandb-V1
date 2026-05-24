import { Router } from "express";
import {
  listCollections,
  createCollection,
  deleteCollection,
  renameCollection,
  collectionStats,
  compactCollection,
  getCollectionOptions,
  patchCollectionOptions,
} from "../controllers/collection.controller.js";
import { getCollectionMigrations, putCollectionMigrations, testCollectionMigration } from "../controllers/migrations.controller.js";

import { authMiddleware } from "../middleware/auth.middleware.js";
import { userCorsMiddleware } from "../middleware/userCors.middleware.js";

const router = Router({ mergeParams: true });

router.use(authMiddleware, userCorsMiddleware);

router.get("/", listCollections);
router.post("/", createCollection);
router.delete("/:col", deleteCollection);
router.patch("/:col/rename", renameCollection);
router.get("/:col/stats", collectionStats);
router.post("/:col/compact", compactCollection);
router.get("/:col/options", getCollectionOptions);
router.patch("/:col/options", patchCollectionOptions);
router.get("/:col/migrations", getCollectionMigrations);
router.put("/:col/migrations", putCollectionMigrations);
router.post("/:col/migrations/test", testCollectionMigration);

export default router;

