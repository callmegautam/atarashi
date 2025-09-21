import { Router } from "express";
import { atarashi } from "@/controllers";

const router = Router();

router.post("/atarashi", atarashi);

export default router;
