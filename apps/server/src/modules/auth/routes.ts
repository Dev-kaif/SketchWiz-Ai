import { Router, type Router as ExpressRouter } from "express";
import { signup, signin } from "./controller.js";
const router: ExpressRouter = Router();
router.post("/signup", signup);
router.post("/signin", signin);
export default router;
