import { createServer } from "http";
import app from "./app";
import { setupWebSocket } from "./routes/ws";
import { startSimulationEngine } from "./lib/simulation-engine";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

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

const server = createServer(app);

setupWebSocket(server);

ensureSpeedProfileColumn().then(() => {
  startSimulationEngine();
  server.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
});
