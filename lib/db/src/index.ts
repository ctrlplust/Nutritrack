import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
}

const client = postgres(process.env.DATABASE_URL, {
  prepare: false,
  ssl: { rejectUnauthorized: false },
  max: 3,
  idle_timeout: 20,
  connect_timeout: 10,
  max_lifetime: 1800,
});

export const db = drizzle(client, { schema });

export * from "./schema";
