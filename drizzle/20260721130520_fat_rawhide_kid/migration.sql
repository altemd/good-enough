ALTER TABLE `api_keys` ADD `kind` text DEFAULT 'personal' NOT NULL;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_api_keys` (
	`selector` text PRIMARY KEY,
	`kind` text DEFAULT 'personal' NOT NULL,
	`user_id` text,
	`prefix` text NOT NULL,
	`secret_digest` blob NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	CONSTRAINT `fk_api_keys_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
	CONSTRAINT "api_keys_kind_check" CHECK("kind" in ('personal', 'demo')),
	CONSTRAINT "api_keys_ownership_check" CHECK(("kind" = 'personal' and "user_id" is not null) or ("kind" = 'demo' and "user_id" is null and "revoked_at" is null)),
	CONSTRAINT "api_keys_expiry_after_creation_check" CHECK("expires_at" > "created_at")
);
--> statement-breakpoint
INSERT INTO `__new_api_keys`(`selector`, `user_id`, `prefix`, `secret_digest`, `created_at`, `expires_at`, `revoked_at`) SELECT `selector`, `user_id`, `prefix`, `secret_digest`, `created_at`, `expires_at`, `revoked_at` FROM `api_keys`;--> statement-breakpoint
DROP TABLE `api_keys`;--> statement-breakpoint
ALTER TABLE `__new_api_keys` RENAME TO `api_keys`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_secret_digest_unique` ON `api_keys` (`secret_digest`);--> statement-breakpoint
CREATE INDEX `api_keys_user_expiry_index` ON `api_keys` (`user_id`,`expires_at`);--> statement-breakpoint
CREATE INDEX `api_keys_kind_expiry_index` ON `api_keys` (`kind`,`expires_at`);