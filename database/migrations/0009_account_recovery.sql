ALTER TYPE "public"."email_token_kind" ADD VALUE 'email_change';--> statement-breakpoint
CREATE TABLE "recovery_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "degree_assignments" DROP CONSTRAINT "dual_approval";--> statement-breakpoint
ALTER TABLE "email_tokens" ADD COLUMN "new_email" text;--> statement-breakpoint
ALTER TABLE "recovery_codes" ADD CONSTRAINT "recovery_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recovery_codes_user_idx" ON "recovery_codes" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "degree_assignments" ADD CONSTRAINT "dual_approval" CHECK ("degree_assignments"."origin" in ('bootstrap', 'potencia') OR ("degree_assignments"."approved_by" <> "degree_assignments"."requested_by" AND "degree_assignments"."approved_by" <> "degree_assignments"."user_id"));