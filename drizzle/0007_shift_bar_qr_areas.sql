ALTER TABLE "cash_sessions" ADD COLUMN "bar_station_id" integer;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD COLUMN "qr_area_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "table_sessions" ADD COLUMN "area_id" integer;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_bar_station_id_print_stations_id_fk" FOREIGN KEY ("bar_station_id") REFERENCES "public"."print_stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_sessions" ADD CONSTRAINT "table_sessions_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE no action ON UPDATE no action;