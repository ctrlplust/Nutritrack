CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	"role" text DEFAULT 'user' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" text PRIMARY KEY NOT NULL,
	"barcode" text,
	"name" text NOT NULL,
	"brand" text,
	"calories_per_100g" real NOT NULL,
	"protein_per_100g" real NOT NULL,
	"carbs_per_100g" real NOT NULL,
	"fat_per_100g" real NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
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
);
--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"current_weight_g" real NOT NULL,
	"initial_weight_g" real NOT NULL,
	"last_updated" timestamp DEFAULT now() NOT NULL,
	"device_id" text,
	"source" text DEFAULT 'manual'
);
--> statement-breakpoint
CREATE TABLE "consumptions" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text,
	"product_id" text NOT NULL,
	"product_name" text NOT NULL,
	"weight_consumed_g" real NOT NULL,
	"calories" integer NOT NULL,
	"protein" real NOT NULL,
	"carbs" real NOT NULL,
	"fat" real NOT NULL,
	"weight_before" real,
	"weight_after" real,
	"device_id" text,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"source" text DEFAULT 'esp32'
);
--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumptions" ADD CONSTRAINT "consumptions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;