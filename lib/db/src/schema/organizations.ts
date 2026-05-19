import { pgTable, serial, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const organizationsTable = pgTable("organizations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  isPaid: boolean("is_paid").notNull().default(false),
  routeLimit: integer("route_limit").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertOrganizationSchema = createInsertSchema(organizationsTable).omit({ id: true, createdAt: true });
export type InsertOrganization = typeof organizationsTable.$inferInsert;
export type Organization = typeof organizationsTable.$inferSelect;
