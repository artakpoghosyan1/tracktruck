import { Worker } from "worker_threads";
import { fileURLToPath } from "url";
import path from "path";
import { broadcastToToken, broadcastToRoute } from "../routes/ws";

let workerRef: Worker | null = null;

export function startSimulationEngine() {
  // In the esbuild CJS bundle __filename is injected by esbuild; in ESM dev
  // (tsx) we fall back to fileURLToPath(import.meta.url).
  const __thisFile =
    typeof __filename !== "undefined"
      ? __filename
      : fileURLToPath(import.meta.url);
  const __thisDir = path.dirname(__thisFile);
  const isDev = __thisFile.endsWith(".ts");

  // Dev: bootstrap.mjs registers tsx programmatically then imports the .ts worker.
  // Prod: esbuild-compiled simulation-worker.cjs, no loader needed.
  const workerPath = isDev
    ? path.join(__thisDir, "simulation-worker-bootstrap.mjs")
    : path.join(__thisDir, "simulation-worker.cjs");

  // execArgv: [] prevents the worker inheriting the parent's --loader tsx flag
  // (set by `tsx watch`), which would conflict with our bootstrap's register() call.
  const workerExecArgv = isDev ? { execArgv: [] as string[] } : {};

  const start = () => {
    workerRef = new Worker(workerPath, workerExecArgv);
    workerRef.on("message", (msg: { type: string; token?: string; routeId?: number; data?: unknown }) => {
      if (msg.type === "broadcast_token" && msg.token != null) broadcastToToken(msg.token, msg.data);
      else if (msg.type === "broadcast_route" && msg.routeId != null) broadcastToRoute(msg.routeId, msg.data);
    });
    workerRef.on("error", (err) => console.error("[SimEngine] Worker error:", err));
    workerRef.on("exit", (code) => {
      if (code !== 0) {
        console.error(`[SimEngine] Worker exited with code ${code}, restarting in 1s...`);
        setTimeout(start, 1000);
      }
    });
  };

  start();
  console.log("[SimEngine] Simulation worker spawned.");
}

export function invalidateRouteCache(routeId: number) {
  workerRef?.postMessage({ type: "invalidate_cache", routeId });
}
