import { Router, type IRouter } from "express";
import { CreatePaymentBody, PaymentCallbackBody, GetPaymentParams } from "@workspace/api-zod";
import { validate } from "../middlewares/validate";

const router: IRouter = Router();

router.post("/payments/create", validate({ body: CreatePaymentBody }), async (req, res) => {
  res.status(501).json({ error: "not_implemented", message: "Create payment not yet implemented" });
});

router.post("/payments/callback", validate({ body: PaymentCallbackBody }), async (req, res) => {
  res.status(501).json({ error: "not_implemented", message: "Payment callback not yet implemented" });
});

router.get("/payments/:id", validate({ params: GetPaymentParams }), async (req, res) => {
  res.status(501).json({ error: "not_implemented", message: "Get payment not yet implemented" });
});

export default router;
