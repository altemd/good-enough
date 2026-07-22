import { defineConfig } from "drizzle-kit";

export default defineConfig({
	dialect: "sqlite",
	schema: [
		"./src/features/accounts/schema.ts",
		"./src/features/operations-analytics/schema.ts",
	],
	out: "./drizzle",
});
