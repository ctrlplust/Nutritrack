import { pgTable, text, real, timestamp } from "drizzle-orm/pg-core";
import { productsTable } from "./products";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const inventoryItemsTable = pgTable("inventory_items", {
  id: text("id").primaryKey(),
  productId: text("product_id").notNull().references(() => productsTable.id),
  currentWeightG: real("current_weight_g").notNull(),
  initialWeightG: real("initial_weight_g").notNull(),
  lastUpdated: timestamp("last_updated").notNull().defaultNow(),
  deviceId: text("device_id"),
  source: text("source").default("manual"),
});

export const insertInventoryItemSchema = createInsertSchema(inventoryItemsTable).omit({ id: true, lastUpdated: true });
export type InsertInventoryItem = z.infer<typeof insertInventoryItemSchema>;
export type InventoryItem = typeof inventoryItemsTable.$inferSelect;
