CREATE TABLE `api_keys` (
	`selector` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`prefix` text NOT NULL,
	`secret_digest` blob NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	CONSTRAINT `fk_api_keys_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`token_digest` blob NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	CONSTRAINT `fk_sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY,
	`username` text NOT NULL,
	`normalized_username` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`must_change_password` integer DEFAULT false NOT NULL,
	`temporary_password_expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`password_changed_at` integer NOT NULL,
	CONSTRAINT "users_role_check" CHECK("role" in ('admin', 'member')),
	CONSTRAINT "users_status_check" CHECK("status" in ('active', 'disabled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_secret_digest_unique` ON `api_keys` (`secret_digest`);--> statement-breakpoint
CREATE INDEX `api_keys_user_expiry_index` ON `api_keys` (`user_id`,`expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_digest_unique` ON `sessions` (`token_digest`);--> statement-breakpoint
CREATE INDEX `sessions_user_expiry_index` ON `sessions` (`user_id`,`expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_normalized_username_unique` ON `users` (`normalized_username`);