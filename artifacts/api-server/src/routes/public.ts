import { Router, type IRouter } from "express";
import { GetPublicTrackParams, GetPublicTrackStateParams } from "@workspace/api-zod";
import { validate } from "../middlewares/validate";

const router: IRouter = Router();

router.get("/public/track/:token", validate({ params: GetPublicTrackParams }), async (req, res) => {
  res.status(404).json({ error: "not_found", message: "No active route found. This tracking link is invalid, expired, or no longer available." });
});

router.get("/public/track/:token/state", validate({ params: GetPublicTrackStateParams }), async (req, res) => {
  res.status(404).json({ error: "not_found", message: "No active route found. This tracking link is invalid, expired, or no longer available." });
});

export default router;
