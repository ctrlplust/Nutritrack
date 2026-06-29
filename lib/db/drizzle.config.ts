import { defineConfig } from "drizzle-kit";
import path from "path";

const url = process.env.DATABASE_URL ?? "file://nutritrack.db";

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: { url },
});
