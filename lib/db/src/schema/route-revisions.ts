import { pgTable, serial, integer, jsonb, timestamp } from "drizzle-orm/pg-core";
import { routesTable } from "./routes";

export const routeRevisionsTable = pgTable("route_revisions", {
  id: serial("id").primaryKey(),
  routeId: integer("route_id").notNull().references(() => routesTable.id, { onDelete: "cascade" }),
  revisionData: jsonb("revision_data").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type RouteRevision = typeof routeRevisionsTable.$inferSelect;
