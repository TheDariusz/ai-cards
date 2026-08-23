ALTER TABLE `cards` ADD `decode_parts` text;--> statement-breakpoint
ALTER TABLE `cards` ADD `first_learned_at` integer;--> statement-breakpoint
UPDATE `cards` SET `first_learned_at` = `created_at`;
