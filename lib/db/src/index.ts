import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.DB_POOL_MAX ?? "50"),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// Without this handler, errors emitted by idle clients in the pool (e.g.
// "Connection terminated unexpectedly", "read ECONNRESET") are unhandled
// 'error' events on the Pool instance and crash the entire process. Node's
// pg Pool is an EventEmitter, and any client-level error that isn't
// captured elsewhere is re-emitted on the pool. We log it here so the pool
// can drop the broken client and create a new one on the next query
// instead of taking down the whole service.
pool.on("error", (err, client) => {
  console.error(
    "[db] Unexpected error on idle PostgreSQL client:",
    err,
  );
  // Not rethrowing: the pool will discard the errored client and
  // transparently create a new connection for subsequent queries.
  void client;
});

export const db = drizzle(pool, { schema });

/**
 * Gracefully close the database pool, allowing in-flight queries to
 * complete before shutting down. Intended to be called from process
 * shutdown handlers (SIGTERM/SIGINT) so pending requests aren't abruptly
 * disconnected from the database.
 */
export async function closeDbPool(): Promise<void> {
  try {
    await pool.end();
  } catch (err) {
    console.error("[db] Error while closing PostgreSQL pool:", err);
  }
}

export * from "./schema";
