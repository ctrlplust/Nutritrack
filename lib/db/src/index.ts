import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Strip libpq query params (sslmode, pgbouncer) — postgres.js uses options instead
const connectionString = process.env.DATABASE_URL!.replace(/\?.*$/, "");
const client = postgres(connectionString, {
  prepare: false,
  ssl: { rejectUnauthorized: false },
});

export const db = drizzle(client, { schema });

export * from "./schema";
