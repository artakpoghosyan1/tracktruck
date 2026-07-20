import { createServer } from "http";
import app from "./app";
import { setupWebSocket } from "./routes/ws";
import { startSimulationEngine } from "./lib/simulation-engine";
import { db, routesTable, shareLinksTable, closeDbPool } from "@workspace/db";
import { sql, and, eq, isNull, lt, inArray } from "drizzle-orm";

// Safety nets: if a database connection error (or any other error) is ever
// emitted somewhere without a handler, log it instead of letting the
// process crash. The pool itself now has its own 'error' listener
// (see lib/db), but this guards against any other stray emitters.
process.on("unhandledRejection", (reason) => {
  console.error("[process] Unhandled promise rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[process] Uncaught exception:", err);
});

const rawPort = process.env["PORT"] ?? "8080";
const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function ensureSpeedProfileColumn() {
  try {
    await db.execute(sql`ALTER TABLE routes ADD COLUMN IF NOT EXISTS speed_profile jsonb DEFAULT '[]'::jsonb`);
  } catch (e) {
    console.warn("speed_profile column migration skipped:", e);
  }
}

async function runCleanup() {
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    
    // Find routes that were completed more than an hour ago and are not yet soft-deleted
    const completedRoutes = await db
      .select({ id: routesTable.id })
      .from(routesTable)
      .where(and(
        eq(routesTable.status, "completed"),
        isNull(routesTable.deletedAt),
        lt(routesTable.updatedAt, oneHourAgo)
      ));

    if (completedRoutes.length > 0) {
      const ids = completedRoutes.map(r => r.id);
      console.log(`[Cleanup] Deactivating share links for ${ids.length} completed routes...`);
      
      // ONLY deactivate the share links so the public map stops working.
      // We do NOT soft-delete the route record itself anymore.
      await db.update(shareLinksTable)
        .set({ active: false })
        .where(and(
          inArray(shareLinksTable.routeId, ids),
          eq(shareLinksTable.active, true)
        ));
    }
  } catch (err) {
    console.error("[Cleanup] Error during auto-deletion cleanup:", err);
  }
}

const server = createServer(app);

setupWebSocket(server);

ensureSpeedProfileColumn().then(() => {
  startSimulationEngine();
  
  // Run cleanup every 10 minutes
  runCleanup();
  setInterval(runCleanup, 10 * 60 * 1000);

  server.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
});

// Graceful shutdown: stop accepting new connections, let in-flight requests
// finish, then close the database pool before exiting. This avoids
// abruptly killing DB connections mid-query, which is what surfaces as
// "Connection terminated unexpectedly" errors on the pool.
let isShuttingDown = false;

async function gracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`[shutdown] Received ${signal}, draining server...`);

  const forceExitTimer = setTimeout(() => {
    console.error("[shutdown] Timed out waiting for drain, forcing exit.");
    process.exit(1);
  }, 10_000);

  server.close(async () => {
    console.log("[shutdown] HTTP server closed, closing DB pool...");
    await closeDbPool();
    clearTimeout(forceExitTimer);
    console.log("[shutdown] Shutdown complete.");
    process.exit(0);
  });
}

process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => void gracefulShutdown("SIGINT"));
