ALTER TYPE email_token_kind ADD VALUE IF NOT EXISTS 'change_email';
--> statement-breakpoint
ALTER TABLE email_tokens ADD COLUMN IF NOT EXISTS target_email text;
