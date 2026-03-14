import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.post("/routes/:id/activate", async (req, res) => {
  res.status(501).json({ error: "not_implemented", message: "Activate route not yet implemented" });
});

router.post("/routes/:id/start", async (req, res) => {
  res.status(501).json({ error: "not_implemented", message: "Start route not yet implemented" });
});

router.post("/routes/:id/pause", async (req, res) => {
  res.status(501).json({ error: "not_implemented", message: "Pause route not yet implemented" });
});

router.post("/routes/:id/resume", async (req, res) => {
  res.status(501).json({ error: "not_implemented", message: "Resume route not yet implemented" });
});

router.post("/routes/:id/reset", async (req, res) => {
  res.status(501).json({ error: "not_implemented", message: "Reset route not yet implemented" });
});

router.post("/routes/:id/recalculate", async (req, res) => {
  res.status(501).json({ error: "not_implemented", message: "Recalculate route not yet implemented" });
});

export default router;
