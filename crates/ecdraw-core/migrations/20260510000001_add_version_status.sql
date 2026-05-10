-- Add version-level status tracking (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'diagram_versions' AND column_name = 'status') THEN
    ALTER TABLE diagram_versions ADD COLUMN status TEXT NOT NULL DEFAULT 'DRAFT';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'diagram_versions' AND column_name = 'published_at') THEN
    ALTER TABLE diagram_versions ADD COLUMN published_at TIMESTAMPTZ;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_diagram_versions_status ON diagram_versions(status);

-- Backfill: versions linked to approved reviews → ONLINE
UPDATE diagram_versions dv
SET status = 'ONLINE', published_at = rr.reviewed_at
FROM review_requests rr
WHERE rr.diagram_version_id = dv.id
  AND rr.status = 'APPROVED'
  AND dv.status = 'DRAFT';

-- Backfill: versions linked to rejected reviews → REJECTED
UPDATE diagram_versions dv
SET status = 'REJECTED'
FROM review_requests rr
WHERE rr.diagram_version_id = dv.id
  AND rr.status = 'REJECTED'
  AND dv.status = 'DRAFT';
