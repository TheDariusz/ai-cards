CREATE TABLE `cards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`word` text NOT NULL,
	`word_pl` text,
	`explanation_en` text,
	`sentence_en` text,
	`sentence_pl` text,
	`audio_key` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`due_at` integer NOT NULL,
	`interval_days` real NOT NULL,
	`ease` real NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `day_log` (
	`date` text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE `review_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`card_id` integer NOT NULL,
	`reviewed_at` integer NOT NULL,
	`mode` text NOT NULL,
	`grade` text NOT NULL,
	`typed` text,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade
);
