import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.get("/public/track/:token", async (req, res) => {
  res.status(404).json({ error: "not_found", message: "No active route found. This tracking link is invalid, expired, or no longer available." });
});

router.get("/public/track/:token/state", async (req, res) => {
  res.status(404).json({ error: "not_found", message: "No active route found. This tracking link is invalid, expired, or no longer available." });
});

export default router;
