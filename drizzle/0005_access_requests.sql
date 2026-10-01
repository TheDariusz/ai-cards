CREATE TABLE `access_requests` (
	`email` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`requested_at` integer NOT NULL,
	`decided_at` integer
);
