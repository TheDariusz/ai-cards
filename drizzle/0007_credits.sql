CREATE TABLE `credit_grants` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`amount_micros` integer NOT NULL,
	`reason` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `credit_grants_user_idx` ON `credit_grants` (`user_id`);--> statement-breakpoint
CREATE TABLE `usage_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`kind` text NOT NULL,
	`model` text NOT NULL,
	`cost_micros` integer NOT NULL,
	`prompt_tokens` integer,
	`completion_tokens` integer,
	`characters` integer,
	`generation_id` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `usage_log_user_idx` ON `usage_log` (`user_id`);--> statement-breakpoint
-- accounts that predate credits get the same starter pool as new ones (500 credits = $0.50); the owner is never limited
INSERT INTO `credit_grants` (`user_id`, `created_at`, `amount_micros`, `reason`)
SELECT `id`, CAST(unixepoch('subsec') * 1000 AS integer), 500000, 'starter' FROM `users` WHERE `id` != 1;
