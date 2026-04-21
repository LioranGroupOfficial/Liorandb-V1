import { Router } from "express";
import { getDoc, listDocs } from "../controllers/docs.controller";

const router = Router();

router.get("/", listDocs);
router.get("/:id", getDoc);

export default router;

