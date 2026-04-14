import { Router } from "express";
import {
  issueManagedUserToken,
  listManagedUsers,
  login,
  loginSuperAdmin,
  me,
  register
} from "../controllers/auth.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = Router();

router.post("/super-admin/login", loginSuperAdmin);
router.post("/login", login);
router.get("/me", authMiddleware, me);
router.get("/users", authMiddleware, listManagedUsers);
router.post("/register", authMiddleware, register);
router.post("/users/:userId/token", authMiddleware, issueManagedUserToken);

export default router;
