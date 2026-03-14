import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { routesTable } from "./routes";

export const shareLinksTable = pgTable("share_links", {
  id: serial("id").primaryKey(),
  routeId: integer("route_id").notNull().references(() => routesTable.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at"),
});

export type ShareLink = typeof shareLinksTable.$inferSelect;
