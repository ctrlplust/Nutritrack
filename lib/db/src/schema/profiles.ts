import { pgTable, text, integer, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const profilesTable = pgTable("profiles", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  calorieGoal: integer("calorie_goal").notNull(),
  proteinGoal: integer("protein_goal").notNull(),
  carbsGoal: integer("carbs_goal").notNull(),
  fatGoal: integer("fat_goal").notNull(),
  heightCm: real("height_cm"),
  weightKg: real("weight_kg"),
  age: integer("age"),
  sex: text("sex"),
  activityLevel: text("activity_level"),
});

export const insertProfileSchema = createInsertSchema(profilesTable).omit({ id: true });
export type InsertProfile = z.infer<typeof insertProfileSchema>;
export type Profile = typeof profilesTable.$inferSelect;
