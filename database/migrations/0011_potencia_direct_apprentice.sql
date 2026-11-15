ALTER TABLE degree_assignments DROP CONSTRAINT IF EXISTS dual_approval;
--> statement-breakpoint
ALTER TABLE degree_assignments ADD CONSTRAINT dual_approval CHECK (
  origin = 'bootstrap'
  OR (origin = 'potencia_direct' AND degree = 1)
  OR (approved_by <> requested_by AND approved_by <> user_id)
);
