import { pgTable, serial, text, integer, doublePrecision, jsonb, timestamp, boolean } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const routeStatusEnum = ["draft", "ready", "in_progress", "paused", "completed", "expired"] as const;
export type RouteStatus = (typeof routeStatusEnum)[number];

export const routesTable = pgTable("routes", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  status: text("status").notNull().default("draft"),
  startLat: doublePrecision("start_lat").notNull(),
  startLng: doublePrecision("start_lng").notNull(),
  endLat: doublePrecision("end_lat").notNull(),
  endLng: doublePrecision("end_lng").notNull(),
  truckSpeedKmh: doublePrecision("truck_speed_kmh").notNull().default(60),
  polyline: jsonb("polyline").$type<number[][]>().default([]),
  speedProfile: jsonb("speed_profile").$type<{ distanceM: number; speedKmh: number }[]>().default([]),
  distanceM: doublePrecision("distance_m").notNull().default(0),
  estimatedDurationS: doublePrecision("estimated_duration_s").notNull().default(0),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  updateCount: integer("update_count").notNull().default(0),
  customDurationS: doublePrecision("custom_duration_s"),
  customDurationEnabled: boolean("custom_duration_enabled").notNull().default(false),
  showSpeedPublic: boolean("show_speed_public").notNull().default(true),
});

export const insertRouteSchema = createInsertSchema(routesTable).omit({ id: true, createdAt: true, updatedAt: true, deletedAt: true });
export type InsertRoute = z.infer<typeof insertRouteSchema>;
export type Route = typeof routesTable.$inferSelect;
