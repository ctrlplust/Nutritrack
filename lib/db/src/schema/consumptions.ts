import { pgTable, text, integer, real, timestamp } from "drizzle-orm/pg-core";
import { productsTable } from "./products";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const consumptionsTable = pgTable("consumptions", {
  id: text("id").primaryKey(),
  profileId: text("profile_id"),
  productId: text("product_id").notNull().references(() => productsTable.id),
  productName: text("product_name").notNull(),
  weightConsumedG: real("weight_consumed_g").notNull(),
  calories: integer("calories").notNull(),
  protein: real("protein").notNull(),
  carbs: real("carbs").notNull(),
  fat: real("fat").notNull(),
  weightBefore: real("weight_before"),
  weightAfter: real("weight_after"),
  deviceId: text("device_id"),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
  source: text("source").default("esp32"),
});

export const insertConsumptionSchema = createInsertSchema(consumptionsTable).omit({ id: true, timestamp: true });
export type InsertConsumption = z.infer<typeof insertConsumptionSchema>;
export type Consumption = typeof consumptionsTable.$inferSelect;
