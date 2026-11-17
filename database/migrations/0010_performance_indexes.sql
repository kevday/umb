-- Índices de apoio às consultas de autenticação, ACE e timeline.
-- IF NOT EXISTS permite implantação segura em bancos que já tenham índice equivalente.
CREATE INDEX IF NOT EXISTS degree_assignments_user_degree_idx
  ON degree_assignments (user_id, degree DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS office_assignments_user_period_idx
  ON office_assignments (user_id, starts_at, ends_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS email_tokens_user_kind_used_idx
  ON email_tokens (user_id, kind, used_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS friendships_addressee_idx
  ON friendships (addressee_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS scrapbook_posts_profile_created_idx
  ON scrapbook_posts (profile_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS community_topics_community_created_idx
  ON community_topics (community_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS community_replies_topic_created_idx
  ON community_replies (topic_id, created_at);
