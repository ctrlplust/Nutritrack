import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { drizzle as pgliteDrizzle } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import * as schema from "./schema";

let db: ReturnType<typeof drizzle>;

if (process.env.DATABASE_URL) {
  const client = postgres(process.env.DATABASE_URL, {
    prepare: false,
    ssl: { rejectUnauthorized: false },
    max: 3,
    idle_timeout: 20,
    connect_timeout: 10,
    max_lifetime: 1800,
  });
  db = drizzle(client, { schema });
} else {
  const pglite = await new PGlite();

  await pglite.query(`
    CREATE TABLE IF NOT EXISTS "users" (
      "id" text PRIMARY KEY NOT NULL,
      "username" text NOT NULL UNIQUE,
      "password" text NOT NULL,
      "role" text DEFAULT 'user' NOT NULL,
      "created_at" text NOT NULL
    )
  `);
  await pglite.query(`
    CREATE TABLE IF NOT EXISTS "profiles" (
      "id" text PRIMARY KEY NOT NULL,
      "name" text NOT NULL,
      "calorie_goal" integer NOT NULL,
      "protein_goal" integer NOT NULL,
      "carbs_goal" integer NOT NULL,
      "fat_goal" integer NOT NULL,
      "height_cm" real,
      "weight_kg" real,
      "age" integer,
      "sex" text,
      "activity_level" text
    )
  `);
  await pglite.query(`
    CREATE TABLE IF NOT EXISTS "products" (
      "id" text PRIMARY KEY NOT NULL,
      "barcode" text,
      "name" text NOT NULL,
      "brand" text,
      "calories_per_100g" real NOT NULL,
      "protein_per_100g" real NOT NULL,
      "carbs_per_100g" real NOT NULL,
      "fat_per_100g" real NOT NULL
    )
  `);
  await pglite.query(`
    CREATE TABLE IF NOT EXISTS "inventory_items" (
      "id" text PRIMARY KEY NOT NULL,
      "product_id" text NOT NULL REFERENCES "products"("id"),
      "current_weight_g" real NOT NULL,
      "initial_weight_g" real NOT NULL,
      "last_updated" text NOT NULL,
      "device_id" text,
      "source" text DEFAULT 'manual'
    )
  `);
  await pglite.query(`
    CREATE TABLE IF NOT EXISTS "consumptions" (
      "id" text PRIMARY KEY NOT NULL,
      "profile_id" text,
      "product_id" text NOT NULL REFERENCES "products"("id"),
      "product_name" text NOT NULL,
      "weight_consumed_g" real NOT NULL,
      "calories" integer NOT NULL,
      "protein" real NOT NULL,
      "carbs" real NOT NULL,
      "fat" real NOT NULL,
      "weight_before" real,
      "weight_after" real,
      "device_id" text,
      "timestamp" text NOT NULL,
      "source" text DEFAULT 'esp32'
    )
  `);

  db = pgliteDrizzle(pglite, { schema }) as unknown as typeof db;
}

export { db };
export * from "./schema";
