import { pgTable, serial, text, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const oauthAccountsTable = pgTable(
  "oauth_accounts",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerUserId: text("provider_user_id").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("oauth_accounts_provider_provider_user_id_idx").on(t.provider, t.providerUserId)],
);

export type OAuthAccount = typeof oauthAccountsTable.$inferSelect;
