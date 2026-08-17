CREATE TABLE IF NOT EXISTS "departments" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "name" text NOT NULL,
        "code" text,
        "sort_order" integer DEFAULT 0,
        "is_active" boolean DEFAULT true,
        "created_at" timestamp with time zone DEFAULT now(),
        CONSTRAINT "departments_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "employee_roles" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "employee_id" uuid NOT NULL,
        "role_name" text NOT NULL,
        "department" text,
        "department_id" uuid,
        "branch_id" text,
        "valid_from" date,
        "valid_to" date,
        "is_primary" boolean DEFAULT false,
        "created_at" timestamp with time zone DEFAULT now(),
        "updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "employees" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "full_name" text NOT NULL,
        "phone" text,
        "email" text,
        "employment_type" text DEFAULT 'employee',
        "status" text DEFAULT 'active',
        "primary_role" text,
        "primary_department" text,
        "department_id" uuid,
        "start_date" date,
        "end_date" date,
        "inn" text,
        "bank_details" text,
        "notes" text,
        "teacher_crm_id" text,
        "branch_crm_id" text,
        "person_id" uuid,
        "is_test_data" boolean DEFAULT false,
        "created_at" timestamp with time zone DEFAULT now(),
        "updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payroll_rules" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "employee_id" uuid NOT NULL,
        "rule_type" text DEFAULT 'per_lesson' NOT NULL,
        "amount" numeric(15, 2),
        "service_id" uuid,
        "group_id" text,
        "department" text,
        "valid_from" date,
        "valid_to" date,
        "is_active" boolean DEFAULT true,
        "notes" text,
        "created_at" timestamp with time zone DEFAULT now(),
        "updated_at" timestamp with time zone DEFAULT now()
);
