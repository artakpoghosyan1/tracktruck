import { Router, type IRouter } from "express";
import { AuthSignupBody, AuthLoginBody, AuthGoogleBody, AuthRefreshBody } from "@workspace/api-zod";
import { validate } from "../middlewares/validate";

const router: IRouter = Router();

router.post("/auth/signup", validate({ body: AuthSignupBody }), async (req, res) => {
  res.status(501).json({ error: "not_implemented", message: "Signup not yet implemented" });
});

router.post("/auth/login", validate({ body: AuthLoginBody }), async (req, res) => {
  res.status(501).json({ error: "not_implemented", message: "Login not yet implemented" });
});

router.post("/auth/google", validate({ body: AuthGoogleBody }), async (req, res) => {
  res.status(501).json({ error: "not_implemented", message: "Google auth not yet implemented" });
});

router.post("/auth/refresh", validate({ body: AuthRefreshBody }), async (req, res) => {
  res.status(501).json({ error: "not_implemented", message: "Token refresh not yet implemented" });
});

router.post("/auth/logout", async (req, res) => {
  res.status(200).json({ message: "Logged out" });
});

router.get("/auth/me", async (req, res) => {
  res.status(401).json({ error: "unauthorized", message: "Not authenticated" });
});

export default router;
