import { pgTable, serial, text, timestamp, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const allowedEmailsTable = pgTable("allowed_emails", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  role: text("role", { enum: ["super_admin", "admin", "user"] }).notNull().default("user"),
  isPaid: boolean("is_paid").notNull().default(true),
  routeLimit: integer("route_limit").notNull().default(25),
  usedRoutes: integer("used_routes").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertAllowedEmailSchema = createInsertSchema(allowedEmailsTable).omit({ id: true, createdAt: true });
export type InsertAllowedEmail = typeof allowedEmailsTable.$inferInsert;
export type AllowedEmail = typeof allowedEmailsTable.$inferSelect;
