ALTER TABLE "lodges" ADD COLUMN "rite" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "theme_color" text;--> statement-breakpoint
ALTER TABLE "lodges" ADD CONSTRAINT "lodge_rite_valid" CHECK ("lodges"."rite" is null or "lodges"."rite" in ('reaa', 'rer', 'schroder', 'york', 'emulacao', 'frances', 'adonhiramita', 'adonhiramita-vermelho', 'brasileiro', 'memphis'));--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profile_theme_hex" CHECK ("profiles"."theme_color" is null or "profiles"."theme_color" ~ '^#[0-9a-fA-F]{6}$');