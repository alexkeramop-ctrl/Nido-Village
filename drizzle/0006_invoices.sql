ALTER TABLE "finance_entries" ADD COLUMN "net_cents" integer;--> statement-breakpoint
ALTER TABLE "finance_entries" ADD COLUMN "paid" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "finance_entries" ADD COLUMN "due_date" text;--> statement-breakpoint
ALTER TABLE "finance_entries" ADD COLUMN "paid_at" text;--> statement-breakpoint
ALTER TABLE "finance_entries" ADD COLUMN "attachment_url" text;--> statement-breakpoint
ALTER TABLE "finance_entries" ADD COLUMN "attachment_name" text;--> statement-breakpoint
ALTER TABLE "finance_entries" ADD COLUMN "attachment_file_id" text;