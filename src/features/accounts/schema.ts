import { sql } from "drizzle-orm";
import {
	blob,
	check,
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
	"users",
	{
		id: text("id").primaryKey(),
		username: text("username").notNull(),
		normalizedUsername: text("normalized_username").notNull(),
		passwordHash: text("password_hash").notNull(),
		role: text("role", { enum: ["admin", "member"] }).notNull(),
		status: text("status", { enum: ["active", "disabled"] })
			.notNull()
			.default("active"),
		mustChangePassword: integer("must_change_password", { mode: "boolean" })
			.notNull()
			.default(false),
		temporaryPasswordExpiresAt: integer("temporary_password_expires_at"),
		createdAt: integer("created_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
		passwordChangedAt: integer("password_changed_at").notNull(),
	},
	(table) => [
		uniqueIndex("users_normalized_username_unique").on(
			table.normalizedUsername,
		),
		check("users_role_check", sql`${table.role} in ('admin', 'member')`),
		check("users_status_check", sql`${table.status} in ('active', 'disabled')`),
	],
);

export const sessions = sqliteTable(
	"sessions",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		tokenDigest: blob("token_digest", { mode: "buffer" }).notNull(),
		createdAt: integer("created_at").notNull(),
		expiresAt: integer("expires_at").notNull(),
	},
	(table) => [
		uniqueIndex("sessions_token_digest_unique").on(table.tokenDigest),
		index("sessions_user_expiry_index").on(table.userId, table.expiresAt),
	],
);

export const apiKeys = sqliteTable(
	"api_keys",
	{
		selector: text("selector").primaryKey(),
		kind: text("kind", { enum: ["personal", "demo"] })
			.notNull()
			.default("personal"),
		userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
		prefix: text("prefix").notNull(),
		secretDigest: blob("secret_digest", { mode: "buffer" }).notNull(),
		createdAt: integer("created_at").notNull(),
		expiresAt: integer("expires_at").notNull(),
		revokedAt: integer("revoked_at"),
	},
	(table) => [
		uniqueIndex("api_keys_secret_digest_unique").on(table.secretDigest),
		index("api_keys_user_expiry_index").on(table.userId, table.expiresAt),
		index("api_keys_kind_expiry_index").on(table.kind, table.expiresAt),
		check("api_keys_kind_check", sql`${table.kind} in ('personal', 'demo')`),
		check(
			"api_keys_ownership_check",
			sql`(${table.kind} = 'personal' and ${table.userId} is not null) or (${table.kind} = 'demo' and ${table.userId} is null and ${table.revokedAt} is null)`,
		),
		check(
			"api_keys_expiry_after_creation_check",
			sql`${table.expiresAt} > ${table.createdAt}`,
		),
	],
);

export const accountSchema = { apiKeys, sessions, users };

export type AccountUser = typeof users.$inferSelect;
