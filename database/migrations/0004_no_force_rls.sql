-- O RLS vale para o papel app_reader (SET LOCAL ROLE). O dono das tabelas (serviços institucionais) não é filtrado por RLS.
ALTER TABLE communities NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE community_topics NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE community_replies NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE scrapbook_posts NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE friendships NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE profiles NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE reports NO FORCE ROW LEVEL SECURITY;
