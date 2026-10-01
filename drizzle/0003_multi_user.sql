CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
-- the existing single user; every pre-existing row is backfilled to it (OWNER_USER_ID)
INSERT INTO `users` (`id`, `email`, `created_at`) VALUES (1, NULL, CAST(unixepoch('subsec') * 1000 AS integer));--> statement-breakpoint
-- day_log/settings change primary key, so they are rebuilt; nothing references them.
-- cards only gains a column: rebuilding it would cascade-delete review_log on D1.
CREATE TABLE `__new_day_log` (
	`user_id` integer DEFAULT 1 NOT NULL,
	`date` text NOT NULL,
	PRIMARY KEY(`user_id`, `date`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_day_log`("user_id", "date") SELECT 1, "date" FROM `day_log`;--> statement-breakpoint
DROP TABLE `day_log`;--> statement-breakpoint
ALTER TABLE `__new_day_log` RENAME TO `day_log`;--> statement-breakpoint
CREATE TABLE `__new_settings` (
	`user_id` integer DEFAULT 1 NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	PRIMARY KEY(`user_id`, `key`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_settings`("user_id", "key", "value") SELECT 1, "key", "value" FROM `settings`;--> statement-breakpoint
DROP TABLE `settings`;--> statement-breakpoint
ALTER TABLE `__new_settings` RENAME TO `settings`;--> statement-breakpoint
ALTER TABLE `cards` ADD `user_id` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX `cards_user_due_idx` ON `cards` (`user_id`,`due_at`);
