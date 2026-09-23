CREATE TABLE IF NOT EXISTS `developer_feedback_images` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `feedback_id` integer NOT NULL, `position` integer NOT NULL, `filename` text NOT NULL, `mime_type` text NOT NULL, `image_base64` text NOT NULL, FOREIGN KEY (`feedback_id`) REFERENCES `developer_feedback`(`id`) ON UPDATE no action ON DELETE restrict);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `developer_feedback_image_position` ON `developer_feedback_images` (`feedback_id`,`position`);
