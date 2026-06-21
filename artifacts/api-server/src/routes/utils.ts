import { Router } from "express";
import { getTimezoneForCoords } from "../lib/timezone";

const router = Router();

router.get("/utils/timezone", (req, res) => {
  const lat = parseFloat(req.query["lat"] as string);
  const lng = parseFloat(req.query["lng"] as string);

  if (isNaN(lat) || isNaN(lng)) {
    res.status(400).json({ error: "invalid_coordinates", message: "lat and lng query params must be valid numbers" });
    return;
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    res.status(400).json({ error: "invalid_coordinates", message: "lat must be -90 to 90 and lng must be -180 to 180" });
    return;
  }

  const result = getTimezoneForCoords(lat, lng);
  res.json(result);
});

export default router;
