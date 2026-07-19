import { defineConfig } from "drizzle-kit";

export default defineConfig({
	dialect: "sqlite",
	schema: "./src/features/accounts/schema.ts",
	out: "./drizzle",
});
