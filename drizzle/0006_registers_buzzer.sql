CREATE TABLE "registers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registers_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD COLUMN "register_id" integer;--> statement-breakpoint
ALTER TABLE "table_sessions" ADD COLUMN "buzzer_no" integer;--> statement-breakpoint
ALTER TABLE "table_sessions" ADD COLUMN "client_ref" text;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_register_id_registers_id_fk" FOREIGN KEY ("register_id") REFERENCES "public"."registers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cash_sessions_register_idx" ON "cash_sessions" USING btree ("register_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cash_sessions_open_register_uq" ON "cash_sessions" USING btree ("register_id") WHERE "cash_sessions"."closed_at" is null;--> statement-breakpoint
CREATE INDEX "payments_cash_session_idx" ON "payments" USING btree ("cash_session_id");--> statement-breakpoint
ALTER TABLE "table_sessions" ADD CONSTRAINT "table_sessions_clientRef_unique" UNIQUE("client_ref");