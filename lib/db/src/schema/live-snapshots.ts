import { pgTable, serial, integer, doublePrecision, text, timestamp } from "drizzle-orm/pg-core";
import { routesTable } from "./routes";

export const liveSnapshotsTable = pgTable("live_snapshots", {
  id: serial("id").primaryKey(),
  routeId: integer("route_id").notNull().references(() => routesTable.id, { onDelete: "cascade" }).unique(),
  status: text("status").notNull().default("ready"),
  distanceTraveledM: doublePrecision("distance_traveled_m").notNull().default(0),
  progressPercent: doublePrecision("progress_percent").notNull().default(0),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  bearing: doublePrecision("bearing"),
  snapshotTimestamp: timestamp("snapshot_timestamp").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type LiveSnapshot = typeof liveSnapshotsTable.$inferSelect;
