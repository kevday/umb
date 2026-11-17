-- Índices para consultas de auditoria por Loja e Jurisdição.
CREATE INDEX IF NOT EXISTS access_audit_lodge_seq_idx
  ON access_audit_logs ((payload->>'lodgeId'), seq);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS access_audit_jurisdiction_seq_idx
  ON access_audit_logs ((payload->>'jurisdictionId'), seq);
