import { Router } from "express";
import {
  insertDocument,
  insertMany,
  findDocuments,
  updateMany,
  deleteMany,
  countDocuments,
} from "../controllers/document.controller";

import { authMiddleware } from "../middleware/auth.middleware";

const router = Router({ mergeParams: true });

router.post("/", authMiddleware, insertDocument);
router.post("/bulk", authMiddleware, insertMany);
router.post("/find", authMiddleware, findDocuments);
router.patch("/updateMany", authMiddleware, updateMany);
router.post("/deleteMany", authMiddleware, deleteMany);
router.post("/count", authMiddleware, countDocuments);

export default router;
