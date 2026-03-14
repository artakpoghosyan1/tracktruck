import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.post("/auth/signup", async (req, res) => {
  res.status(501).json({ error: "not_implemented", message: "Signup not yet implemented" });
});

router.post("/auth/login", async (req, res) => {
  res.status(501).json({ error: "not_implemented", message: "Login not yet implemented" });
});

router.post("/auth/google", async (req, res) => {
  res.status(501).json({ error: "not_implemented", message: "Google auth not yet implemented" });
});

router.post("/auth/refresh", async (req, res) => {
  res.status(501).json({ error: "not_implemented", message: "Token refresh not yet implemented" });
});

router.post("/auth/logout", async (req, res) => {
  res.status(200).json({ message: "Logged out" });
});

router.get("/auth/me", async (req, res) => {
  res.status(401).json({ error: "unauthorized", message: "Not authenticated" });
});

export default router;
