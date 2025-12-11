import { Router } from "express";
import {
  insertDocument,
  findDocuments,
  getDocument,
  updateDocument,
  deleteDocument,
} from "../controllers/document.controller";

import { authMiddleware } from "../middleware/auth.middleware";

const router = Router({ mergeParams: true });

router.post("/", authMiddleware, insertDocument);
router.post("/find", authMiddleware, findDocuments);
router.get("/:id", authMiddleware, getDocument);
router.patch("/:id", authMiddleware, updateDocument);
router.delete("/:id", authMiddleware, deleteDocument);

export default router;
