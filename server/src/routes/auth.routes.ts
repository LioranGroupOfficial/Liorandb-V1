import { Router } from "express";
import {
  issueManagedUserToken,
  listManagedUsers,
  login,
  loginSuperAdmin,
  me,
  register,
  updateMyCors,
  updateUserCors
} from "../controllers/auth.controller";
import { authMiddleware } from "../middleware/auth.middleware";
import { userCorsMiddleware } from "../middleware/userCors.middleware";

const router = Router();

router.post("/super-admin/login", loginSuperAdmin);
router.post("/login", login);
router.get("/me", authMiddleware, userCorsMiddleware, me);
router.put("/me/cors", authMiddleware, userCorsMiddleware, updateMyCors);
router.get("/users", authMiddleware, userCorsMiddleware, listManagedUsers);
router.post("/register", authMiddleware, userCorsMiddleware, register);
router.post("/users/:userId/token", authMiddleware, userCorsMiddleware, issueManagedUserToken);
router.put("/users/:userId/cors", authMiddleware, userCorsMiddleware, updateUserCors);

export default router;
