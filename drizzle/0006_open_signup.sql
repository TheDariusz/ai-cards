ALTER TABLE `users` ADD `blocked_at` integer;--> statement-breakpoint
-- sign-up no longer needs approval: a rejected address becomes a blocked user, so it can't just sign up
UPDATE `users` SET `blocked_at` = (SELECT `decided_at` FROM `access_requests` r WHERE r.`email` = `users`.`email` AND r.`status` = 'rejected')
WHERE `email` IN (SELECT `email` FROM `access_requests` WHERE `status` = 'rejected');--> statement-breakpoint
INSERT INTO `users` (`email`, `created_at`, `blocked_at`)
SELECT `email`, `requested_at`, COALESCE(`decided_at`, `requested_at`) FROM `access_requests`
WHERE `status` = 'rejected' AND `email` NOT IN (SELECT `email` FROM `users` WHERE `email` IS NOT NULL);--> statement-breakpoint
DROP TABLE `access_requests`;
