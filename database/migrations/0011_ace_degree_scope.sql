-- Contextualiza o Grau pela Loja à qual a progressão pertence.
ALTER TABLE degree_assignments
  ADD COLUMN IF NOT EXISTS lodge_id uuid REFERENCES lodges(id);
--> statement-breakpoint
-- Backfill somente quando há exatamente um vínculo que cobria a data da progressão.
-- O histórico é append-only na operação normal; desabilitamos o trigger apenas durante esta migração,
-- executada pelo owner em transação, e o reabilitamos imediatamente após o backfill.
ALTER TABLE degree_assignments DISABLE TRIGGER degrees_immutable;
--> statement-breakpoint
UPDATE degree_assignments d
SET lodge_id = m.lodge_id
FROM institutional_memberships m
WHERE m.user_id = d.user_id
  AND m.starts_at <= d.at
  AND (m.ends_at IS NULL OR m.ends_at > d.at)
  AND (
    SELECT count(*)
    FROM institutional_memberships x
    WHERE x.user_id = d.user_id
      AND x.starts_at <= d.at
      AND (x.ends_at IS NULL OR x.ends_at > d.at)
  ) = 1
  AND d.lodge_id IS NULL;
--> statement-breakpoint
ALTER TABLE degree_assignments ENABLE TRIGGER degrees_immutable;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS degree_assignments_user_lodge_degree_idx
  ON degree_assignments (user_id, lodge_id, degree DESC);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_eval(u uuid, r jsonb, lodge uuid, jur uuid, st text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE k text := r->>'kind'; x jsonb;
BEGIN
  IF k = 'minDegree' THEN
    RETURN coalesce((SELECT max(degree) FROM degree_assignments
      WHERE user_id = u AND lodge_id = lodge), 0) >= (r->>'value')::int;
  ELSIF k = 'lodge' THEN RETURN lodge::text = r->>'id';
  ELSIF k = 'jurisdiction' THEN RETURN jur::text = r->>'id';
  ELSIF k = 'body' THEN RETURN false;
  ELSIF k = 'status' THEN RETURN EXISTS (SELECT 1 FROM jsonb_array_elements_text(r->'allowed') a WHERE a = st);
  ELSIF k = 'office' THEN
    RETURN EXISTS (SELECT 1 FROM office_assignments o WHERE o.user_id = u AND o.starts_at <= now() AND (o.ends_at IS NULL OR o.ends_at > now())
      AND o.name IN (SELECT jsonb_array_elements_text(r->'names'))
      AND (o.lodge_id = lodge OR o.jurisdiction_id = jur)
      AND (r->>'lodgeId' IS NULL OR o.lodge_id::text = r->>'lodgeId')
      AND (r->>'jurisdictionId' IS NULL OR o.jurisdiction_id::text = r->>'jurisdictionId'));
  ELSIF k = 'all' THEN
    FOR x IN SELECT * FROM jsonb_array_elements(r->'rules') LOOP
      IF NOT app_eval(u, x, lodge, jur, st) THEN RETURN false; END IF;
    END LOOP;
    RETURN true;
  ELSIF k = 'any' THEN
    FOR x IN SELECT * FROM jsonb_array_elements(r->'rules') LOOP
      IF app_eval(u, x, lodge, jur, st) THEN RETURN true; END IF;
    END LOOP;
    RETURN false;
  END IF;
  RETURN false;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_can(u uuid, r jsonb)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE m record; membership_count integer;
BEGIN
  IF u IS NULL OR r IS NULL OR jsonb_typeof(r) <> 'object' THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = u AND NOT is_technical_admin AND deleted_at IS NULL) THEN RETURN false; END IF;
  SELECT count(*) INTO membership_count
  FROM institutional_memberships im
  WHERE im.user_id = u AND im.starts_at <= now() AND (im.ends_at IS NULL OR im.ends_at > now());
  IF membership_count <> 1 THEN RETURN false; END IF;
  SELECT im.lodge_id, im.status, l.jurisdiction_id INTO m
  FROM institutional_memberships im
  JOIN lodges l ON l.id = im.lodge_id
  WHERE im.user_id = u AND im.starts_at <= now() AND (im.ends_at IS NULL OR im.ends_at > now());
  IF NOT FOUND OR m.status IN ('licenciado','suspenso','eliminado','falecido') THEN RETURN false; END IF;
  RETURN app_eval(u, r, m.lodge_id, m.jurisdiction_id, m.status::text);
END $$;
--> statement-breakpoint
DO $$
DECLARE unresolved integer;
BEGIN
  SELECT count(*) INTO unresolved FROM degree_assignments WHERE lodge_id IS NULL;
  IF unresolved > 0 THEN
    RAISE WARNING '% registros históricos de Grau não puderam ser associados automaticamente a uma Loja. Revisar antes de liberar a plataforma.', unresolved;
  END IF;
END $$;
