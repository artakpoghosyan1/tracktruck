import { Router, type IRouter } from "express";
import {
  ActivateRouteParams,
  StartRouteParams,
  PauseRouteParams,
  ResumeRouteParams,
  ResetRouteParams,
  RecalculateRouteParams,
} from "@workspace/api-zod";
import { validate } from "../middlewares/validate";

const router: IRouter = Router();

router.post("/routes/:id/activate", validate({ params: ActivateRouteParams }), async (req, res) => {
  res.status(501).json({ error: "not_implemented", message: "Activate route not yet implemented" });
});

router.post("/routes/:id/start", validate({ params: StartRouteParams }), async (req, res) => {
  res.status(501).json({ error: "not_implemented", message: "Start route not yet implemented" });
});

router.post("/routes/:id/pause", validate({ params: PauseRouteParams }), async (req, res) => {
  res.status(501).json({ error: "not_implemented", message: "Pause route not yet implemented" });
});

router.post("/routes/:id/resume", validate({ params: ResumeRouteParams }), async (req, res) => {
  res.status(501).json({ error: "not_implemented", message: "Resume route not yet implemented" });
});

router.post("/routes/:id/reset", validate({ params: ResetRouteParams }), async (req, res) => {
  res.status(501).json({ error: "not_implemented", message: "Reset route not yet implemented" });
});

router.post("/routes/:id/recalculate", validate({ params: RecalculateRouteParams }), async (req, res) => {
  res.status(501).json({ error: "not_implemented", message: "Recalculate route not yet implemented" });
});

export default router;
