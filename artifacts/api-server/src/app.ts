import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import router from "./routes";

declare global {
  namespace Express {
    interface Request {
      rawBody?: Buffer;
    }
  }
}

const app: Express = express();

app.use(cors());

// Capture raw body for the payment webhook so HMAC is computed on actual bytes sent,
// not on a re-serialized JSON object (which may differ in whitespace/key order).
app.use("/api/payments/callback", express.raw({ type: "application/json", limit: "10mb" }), (req: Request, _res: Response, next: NextFunction) => {
  if (Buffer.isBuffer(req.body)) {
    req.rawBody = req.body;
    try {
      req.body = JSON.parse(req.body.toString("utf8"));
    } catch {
      req.body = {};
    }
  }
  next();
});

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use("/api", router);

// Global error handler — catches any unhandled error thrown in route handlers
// and returns a JSON response instead of hanging/crashing.
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Unhandled route error:", err);
  const status = typeof err.status === "number" ? err.status : 500;
  res.status(status).json({
    error: "internal_error",
    message: process.env["NODE_ENV"] === "production"
      ? "An unexpected error occurred"
      : (err.message ?? "Unknown error"),
  });
});

export default app;
