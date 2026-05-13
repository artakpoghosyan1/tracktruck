import { pgTable, serial, integer, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { routesTable } from "./routes";

export const shareLinksTable = pgTable("share_links", {
  id: serial("id").primaryKey(),
  routeId: integer("route_id").notNull().references(() => routesTable.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at"),
}, (t) => [
  // Simulation tick looks up active share tokens per route on every cache miss
  index("idx_share_links_route_active").on(t.routeId, t.active),
]);

export type ShareLink = typeof shareLinksTable.$inferSelect;
