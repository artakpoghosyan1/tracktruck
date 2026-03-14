import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.get("/routes", async (req, res) => {
  res.json({ data: [], total: 0, page: 1, pageSize: 10 });
});

router.post("/routes", async (req, res) => {
  res.status(501).json({ error: "not_implemented", message: "Create route not yet implemented" });
});

router.get("/routes/:id", async (req, res) => {
  res.status(404).json({ error: "not_found", message: "Route not found" });
});

router.put("/routes/:id", async (req, res) => {
  res.status(501).json({ error: "not_implemented", message: "Update route not yet implemented" });
});

router.delete("/routes/:id", async (req, res) => {
  res.status(501).json({ error: "not_implemented", message: "Delete route not yet implemented" });
});

router.post("/routes/:id/stops", async (req, res) => {
  res.status(501).json({ error: "not_implemented", message: "Create stop not yet implemented" });
});

router.put("/routes/:id/stops/:stopId", async (req, res) => {
  res.status(501).json({ error: "not_implemented", message: "Update stop not yet implemented" });
});

router.delete("/routes/:id/stops/:stopId", async (req, res) => {
  res.status(501).json({ error: "not_implemented", message: "Delete stop not yet implemented" });
});

export default router;
