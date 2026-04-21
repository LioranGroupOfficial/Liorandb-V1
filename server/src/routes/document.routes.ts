import { Router } from "express";
import {
  insertDocument,
  insertMany,
  findDocuments,
  updateMany,
  deleteMany,
  countDocuments,
  aggregateDocuments,
  explainQuery,
} from "../controllers/document.controller";

import { authMiddleware } from "../middleware/auth.middleware";
import { userCorsMiddleware } from "../middleware/userCors.middleware";

const router = Router({ mergeParams: true });

router.use(authMiddleware, userCorsMiddleware);

router.post("/", insertDocument);
router.post("/bulk", insertMany);
router.post("/find", findDocuments);
router.post("/aggregate", aggregateDocuments);
router.post("/explain", explainQuery);
router.patch("/updateMany", updateMany);
router.post("/deleteMany", deleteMany);
router.post("/count", countDocuments);

export default router;
