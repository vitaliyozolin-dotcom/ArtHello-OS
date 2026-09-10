CREATE TABLE diary_identity (id text PRIMARY KEY NOT NULL, institution_id text NOT NULL);
--> statement-breakpoint
CREATE TABLE diary_settings (key text PRIMARY KEY NOT NULL, value text NOT NULL);
--> statement-breakpoint
CREATE TABLE attendance_by_date (
 id text PRIMARY KEY NOT NULL,
 lesson_id text NOT NULL REFERENCES lessons(id),
 student_id text NOT NULL REFERENCES students(id),
 lesson_date text NOT NULL,
 status text NOT NULL CHECK(status IN ('present','absent','late','excused')),
 note text NOT NULL DEFAULT '',
 marked_by_user_id text NOT NULL REFERENCES users(id),
 marked_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
 version integer NOT NULL DEFAULT 1,
 UNIQUE(lesson_id, student_id, lesson_date)
);
