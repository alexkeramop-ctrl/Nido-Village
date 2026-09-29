CREATE TABLE "events" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"type" text DEFAULT 'party' NOT NULL,
	"status" text DEFAULT 'inquiry' NOT NULL,
	"date" text NOT NULL,
	"start_time" text DEFAULT '12:00' NOT NULL,
	"end_time" text DEFAULT '16:00' NOT NULL,
	"guests" integer DEFAULT 0 NOT NULL,
	"area_id" integer,
	"customer_name" text DEFAULT '' NOT NULL,
	"customer_phone" text,
	"customer_email" text,
	"price_cents" integer DEFAULT 0 NOT NULL,
	"deposit_cents" integer DEFAULT 0 NOT NULL,
	"deposit_paid" boolean DEFAULT false NOT NULL,
	"menu_notes" text,
	"notes" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "areas" ADD COLUMN "bar_station_id" integer;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "pin_encrypted" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ingredients" ADD COLUMN "pack_size" numeric(12, 3);--> statement-breakpoint
ALTER TABLE "ingredients" ADD COLUMN "pack_name" text;--> statement-breakpoint
ALTER TABLE "ingredients" ADD COLUMN "portion_qty" numeric(12, 3);--> statement-breakpoint
ALTER TABLE "ingredients" ADD COLUMN "portion_name" text;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_created_by_employees_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "events_date_idx" ON "events" USING btree ("date");--> statement-breakpoint
CREATE INDEX "events_status_idx" ON "events" USING btree ("status");--> statement-breakpoint
ALTER TABLE "areas" ADD CONSTRAINT "areas_bar_station_id_print_stations_id_fk" FOREIGN KEY ("bar_station_id") REFERENCES "public"."print_stations"("id") ON DELETE no action ON UPDATE no action;