import { Router } from "express";
import {
  insertDocument,
  insertMany,
  findDocuments,
  findOneDocument,
  updateOne,
  updateMany,
  deleteOne,
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
router.post("/findOne", findOneDocument);
router.post("/aggregate", aggregateDocuments);
router.post("/explain", explainQuery);
router.patch("/updateOne", updateOne);
router.patch("/updateMany", updateMany);
router.post("/deleteOne", deleteOne);
router.post("/deleteMany", deleteMany);
router.post("/count", countDocuments);

export default router;
