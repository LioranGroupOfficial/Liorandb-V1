import { Router } from "express";
import { listCollections, createCollection } from "../controllers/collection.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = Router({ mergeParams: true });

router.get("/", authMiddleware, listCollections);
router.post("/", authMiddleware, createCollection);

export default router;
