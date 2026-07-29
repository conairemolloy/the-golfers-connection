import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  // auth.users is Supabase-managed; only diff/migrate the public schema.
  schemaFilter: ["public"],
  dbCredentials: {
    // Only read when running db:migrate / db:studio, which connect to the
    // database. db:generate diffs the schema locally and needs no connection.
    url: process.env.DATABASE_URL as string,
  },
});
