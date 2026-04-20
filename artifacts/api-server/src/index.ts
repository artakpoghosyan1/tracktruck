import { createServer } from "http";
import app from "./app";
import { setupWebSocket } from "./routes/ws";
import { startSimulationEngine } from "./lib/simulation-engine";
import { db, routesTable, shareLinksTable } from "@workspace/db";
import { sql, and, eq, isNull, lt, inArray } from "drizzle-orm";

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
