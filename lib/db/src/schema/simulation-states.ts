import { pgTable, serial, integer, doublePrecision, timestamp } from "drizzle-orm/pg-core";
import { routesTable } from "./routes";

export const simulationStatesTable = pgTable("simulation_states", {
  id: serial("id").primaryKey(),
  routeId: integer("route_id").notNull().references(() => routesTable.id, { onDelete: "cascade" }).unique(),
  startedAt: timestamp("started_at"),
  pausedAt: timestamp("paused_at"),
  effectiveElapsedMs: doublePrecision("effective_elapsed_ms").notNull().default(0),
  distanceTraveledM: doublePrecision("distance_traveled_m").notNull().default(0),
  progressPercent: doublePrecision("progress_percent").notNull().default(0),
  /** Route stop the truck is dwelling at (null when driving). */
  atStopRouteStopId: integer("at_stop_route_stop_id"),
  /** Wall-clock time when the truck arrived at atStopRouteStopId. */
  stopArrivedAt: timestamp("stop_arrived_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type SimulationState = typeof simulationStatesTable.$inferSelect;
