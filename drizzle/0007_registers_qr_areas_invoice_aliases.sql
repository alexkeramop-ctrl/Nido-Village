CREATE TABLE "invoice_item_aliases" (
	"id" serial PRIMARY KEY NOT NULL,
	"supplier_id" integer,
	"item_key" text NOT NULL,
	"ingredient_id" integer NOT NULL,
	"factor" numeric(12, 4) DEFAULT '1' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD COLUMN "qr_area_ids" jsonb;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD COLUMN "qr_takeaway" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "registers" ADD COLUMN "area_id" integer;--> statement-breakpoint
ALTER TABLE "invoice_item_aliases" ADD CONSTRAINT "invoice_item_aliases_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_item_aliases" ADD CONSTRAINT "invoice_item_aliases_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_item_aliases_uq" ON "invoice_item_aliases" USING btree ("supplier_id","item_key");--> statement-breakpoint
ALTER TABLE "registers" ADD CONSTRAINT "registers_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE no action ON UPDATE no action;