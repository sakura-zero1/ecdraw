-- Add version-level status tracking
CREATE TYPE version_status AS ENUM ('DRAFT', 'REVIEWING', 'ONLINE', 'REJECTED', 'DECOMMISSIONED');

ALTER TABLE diagram_versions ADD COLUMN status version_status NOT NULL DEFAULT 'DRAFT';
ALTER TABLE diagram_versions ADD COLUMN published_at TIMESTAMPTZ;

CREATE INDEX idx_diagram_versions_status ON diagram_versions(status);

-- Backfill: versions linked to approved reviews → ONLINE
UPDATE diagram_versions dv
SET status = 'ONLINE', published_at = rr.reviewed_at
FROM review_requests rr
WHERE rr.diagram_version_id = dv.id
  AND rr.status = 'APPROVED';

-- Backfill: versions linked to rejected reviews → REJECTED
UPDATE diagram_versions dv
SET status = 'REJECTED'
FROM review_requests rr
WHERE rr.diagram_version_id = dv.id
  AND rr.status = 'REJECTED'
  AND dv.status = 'DRAFT';
