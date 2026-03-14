import { pgTable, serial, text, integer, doublePrecision, timestamp } from "drizzle-orm/pg-core";
import { routesTable } from "./routes";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const routeStopsTable = pgTable("route_stops", {
  id: serial("id").primaryKey(),
  routeId: integer("route_id").notNull().references(() => routesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
  durationMinutes: doublePrecision("duration_minutes").notNull().default(5),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertRouteStopSchema = createInsertSchema(routeStopsTable).omit({ id: true, createdAt: true });
export type InsertRouteStop = z.infer<typeof insertRouteStopSchema>;
export type RouteStopRow = typeof routeStopsTable.$inferSelect;
