import { pgSchema, uuid } from "drizzle-orm/pg-core";

// Supabase-managed schema, referenced for foreign keys only. Deliberately
// not exported from schema.ts, the file drizzle-kit reads to generate
// migrations — this table already exists and must never be created,
// altered, or dropped by our migrations.
const authSchema = pgSchema("auth");

export const authUsers = authSchema.table("users", {
  id: uuid("id").primaryKey(),
});
