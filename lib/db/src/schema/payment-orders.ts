import { pgTable, serial, integer, text, doublePrecision, jsonb, timestamp } from "drizzle-orm/pg-core";
import { routesTable } from "./routes";
import { usersTable } from "./users";

export const paymentStatusEnum = ["pending", "authorized", "paid", "failed", "expired", "refunded"] as const;
export type PaymentStatus = (typeof paymentStatusEnum)[number];

export const paymentOrdersTable = pgTable("payment_orders", {
  id: serial("id").primaryKey(),
  routeId: integer("route_id").notNull().references(() => routesTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  amount: doublePrecision("amount").notNull(),
  currency: text("currency").notNull().default("AMD"),
  status: text("status").notNull().default("pending"),
  paymentReference: text("payment_reference").notNull().unique(),
  transactionId: text("transaction_id"),
  providerPayload: jsonb("provider_payload"),
  approvalUrl: text("approval_url"),
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type PaymentOrder = typeof paymentOrdersTable.$inferSelect;
