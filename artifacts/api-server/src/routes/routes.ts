import { Router, type IRouter } from "express";
import {
  ListRoutesQueryParams,
  CreateRouteBody,
  GetRouteParams,
  UpdateRouteParams,
  UpdateRouteBody,
  DeleteRouteParams,
  CreateStopParams,
  CreateStopBody,
  UpdateStopParams,
  UpdateStopBody,
  DeleteStopParams,
} from "@workspace/api-zod";
import { validate } from "../middlewares/validate";

const router: IRouter = Router();

router.get("/routes", validate({ query: ListRoutesQueryParams }), async (req, res) => {
  res.json({ data: [], total: 0, page: 1, pageSize: 10 });
});

router.post("/routes", validate({ body: CreateRouteBody }), async (req, res) => {
  res.status(501).json({ error: "not_implemented", message: "Create route not yet implemented" });
});

router.get("/routes/:id", validate({ params: GetRouteParams }), async (req, res) => {
  res.status(404).json({ error: "not_found", message: "Route not found" });
});

router.put("/routes/:id", validate({ params: UpdateRouteParams, body: UpdateRouteBody }), async (req, res) => {
  res.status(501).json({ error: "not_implemented", message: "Update route not yet implemented" });
});

router.delete("/routes/:id", validate({ params: DeleteRouteParams }), async (req, res) => {
  res.status(501).json({ error: "not_implemented", message: "Delete route not yet implemented" });
});

router.post("/routes/:id/stops", validate({ params: CreateStopParams, body: CreateStopBody }), async (req, res) => {
  res.status(501).json({ error: "not_implemented", message: "Create stop not yet implemented" });
});

router.put("/routes/:id/stops/:stopId", validate({ params: UpdateStopParams, body: UpdateStopBody }), async (req, res) => {
  res.status(501).json({ error: "not_implemented", message: "Update stop not yet implemented" });
});

router.delete("/routes/:id/stops/:stopId", validate({ params: DeleteStopParams }), async (req, res) => {
  res.status(501).json({ error: "not_implemented", message: "Delete stop not yet implemented" });
});

export default router;
