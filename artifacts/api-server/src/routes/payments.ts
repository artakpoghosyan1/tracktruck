import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.post("/payments/create", async (req, res) => {
  res.status(501).json({ error: "not_implemented", message: "Create payment not yet implemented" });
});

router.post("/payments/callback", async (req, res) => {
  res.status(501).json({ error: "not_implemented", message: "Payment callback not yet implemented" });
});

router.get("/payments/:id", async (req, res) => {
  res.status(501).json({ error: "not_implemented", message: "Get payment not yet implemented" });
});

export default router;
