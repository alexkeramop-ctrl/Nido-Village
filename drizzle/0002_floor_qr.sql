CREATE TABLE "assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text DEFAULT 'map' NOT NULL,
	"mime" text NOT NULL,
	"data" text NOT NULL,
	"width" integer,
	"height" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "areas" ADD COLUMN "map_asset_id" integer;--> statement-breakpoint
ALTER TABLE "table_sessions" ADD COLUMN "source" text DEFAULT 'staff' NOT NULL;--> statement-breakpoint
ALTER TABLE "table_sessions" ADD COLUMN "public_token" text;--> statement-breakpoint
ALTER TABLE "table_sessions" ADD COLUMN "pickup_code" text;--> statement-breakpoint
ALTER TABLE "table_sessions" ADD COLUMN "customer_name" text;--> statement-breakpoint
ALTER TABLE "table_sessions" ADD COLUMN "customer_phone" text;--> statement-breakpoint
ALTER TABLE "table_sessions" ADD COLUMN "ready_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "table_sessions" ADD COLUMN "picked_up_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tables" ADD COLUMN "pos_x" integer;--> statement-breakpoint
ALTER TABLE "tables" ADD COLUMN "pos_y" integer;--> statement-breakpoint
ALTER TABLE "tables" ADD COLUMN "shape" text DEFAULT 'square' NOT NULL;--> statement-breakpoint
ALTER TABLE "areas" ADD CONSTRAINT "areas_map_asset_id_assets_id_fk" FOREIGN KEY ("map_asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_sessions" ADD CONSTRAINT "table_sessions_publicToken_unique" UNIQUE("public_token");