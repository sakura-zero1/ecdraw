-- Migrate graph_prj2 → ecdraw2 (cuid→UUID, camelCase→snake_case)
-- Run: psql -U postgres -d ecdraw2 -f migrate_data.sql
CREATE EXTENSION IF NOT EXISTS dblink;

-- Helper: dblink connection string
\set conn 'host=localhost user=postgres password=postgres dbname=graph_prj2'

-- ==================== Users ====================
CREATE TEMP TABLE uid_map AS
SELECT id AS old_id, gen_random_uuid() AS new_id
FROM dblink(:'conn', 'SELECT id FROM "User"') AS t(id text);

INSERT INTO users (id, username, password_hash, roles, status, created_at, updated_at)
SELECT m.new_id, d.u, d.ph, d.r, d.s::text, d.ca::timestamptz, d.ua::timestamptz
FROM dblink(:'conn',
  'SELECT id, username, "passwordHash", roles, status, "createdAt", "updatedAt" FROM "User"'
) AS d(id text, u text, ph text, r text, s text, ca timestamp, ua timestamp)
JOIN uid_map m ON m.old_id = d.id;

-- ==================== Component Categories ====================
CREATE TEMP TABLE cid_map AS
SELECT id AS old_id, gen_random_uuid() AS new_id
FROM dblink(:'conn', 'SELECT id FROM "ComponentCategory"') AS t(id text);

INSERT INTO component_categories (id, name, label, color, built_in, created_at)
SELECT m.new_id, d.n, d.l, d.c, d.bi, d.ca::timestamptz
FROM dblink(:'conn',
  'SELECT id, name, label, color, "builtIn", "createdAt" FROM "ComponentCategory"'
) AS d(id text, n text, l text, c text, bi boolean, ca timestamp)
JOIN cid_map m ON m.old_id = d.id;

-- ==================== Components ====================
CREATE TEMP TABLE comp_map AS
SELECT id AS old_id, gen_random_uuid() AS new_id
FROM dblink(:'conn', 'SELECT id FROM "Component"') AS t(id text);

INSERT INTO components (id, name, category, description, owner_id, created_at, updated_at)
SELECT m.new_id, d.n, d.cat, d.dsc, u.new_id, d.ca::timestamptz, d.ua::timestamptz
FROM dblink(:'conn',
  'SELECT id, name, category, description, "ownerId", "createdAt", "updatedAt" FROM "Component"'
) AS d(id text, n text, cat text, dsc text, oid text, ca timestamp, ua timestamp)
JOIN comp_map m ON m.old_id = d.id
JOIN uid_map u ON u.old_id = d.oid;

-- ==================== Component Versions ====================
CREATE TEMP TABLE cv_map AS
SELECT id AS old_id, gen_random_uuid() AS new_id
FROM dblink(:'conn', 'SELECT id FROM "ComponentVersion"') AS t(id text);

INSERT INTO component_versions (id, component_id, version_no, snapshot, created_by, created_at)
SELECT m.new_id, c.new_id, d.vn, d.snap, u.new_id, d.ca::timestamptz
FROM dblink(:'conn',
  'SELECT id, "componentId", "versionNo", snapshot, "createdBy", "createdAt" FROM "ComponentVersion"'
) AS d(id text, cid text, vn int, snap jsonb, cb text, ca timestamp)
JOIN cv_map m ON m.old_id = d.id
JOIN comp_map c ON c.old_id = d.cid
LEFT JOIN uid_map u ON u.old_id = d.cb;

-- ==================== Diagrams ====================
CREATE TEMP TABLE dgm_map AS
SELECT id AS old_id, gen_random_uuid() AS new_id
FROM dblink(:'conn', 'SELECT id FROM "Diagram"') AS t(id text);

INSERT INTO diagrams (id, name, description, owner_id, status, created_at, updated_at)
SELECT m.new_id, d.n, d.dsc, u.new_id, d.s::text, d.ca::timestamptz, d.ua::timestamptz
FROM dblink(:'conn',
  'SELECT id, name, description, "ownerId", status, "createdAt", "updatedAt" FROM "Diagram"'
) AS d(id text, n text, dsc text, oid text, s text, ca timestamp, ua timestamp)
JOIN dgm_map m ON m.old_id = d.id
JOIN uid_map u ON u.old_id = d.oid;

-- ==================== Diagram Versions ====================
CREATE TEMP TABLE dv_map AS
SELECT id AS old_id, gen_random_uuid() AS new_id
FROM dblink(:'conn', 'SELECT id FROM "DiagramVersion"') AS t(id text);

INSERT INTO diagram_versions (id, diagram_id, version_no, snapshot, created_by, created_at)
SELECT m.new_id, dg.new_id, d.vn, d.snap, u.new_id, d.ca::timestamptz
FROM dblink(:'conn',
  'SELECT id, "diagramId", "versionNo", snapshot, "createdBy", "createdAt" FROM "DiagramVersion"'
) AS d(id text, did text, vn int, snap jsonb, cb text, ca timestamp)
JOIN dv_map m ON m.old_id = d.id
JOIN dgm_map dg ON dg.old_id = d.did
LEFT JOIN uid_map u ON u.old_id = d.cb;

-- ==================== Diagram Instances ====================
CREATE TEMP TABLE di_map AS
SELECT id AS old_id, gen_random_uuid() AS new_id
FROM dblink(:'conn', 'SELECT id FROM "DiagramInstance"') AS t(id text);

INSERT INTO diagram_instances (id, diagram_id, component_id, label, position_x, position_y, instance_data, created_at, updated_at)
SELECT m.new_id, dg.new_id, c.new_id, d.l, d.px, d.py, d.idata, d.ca::timestamptz, d.ua::timestamptz
FROM dblink(:'conn',
  'SELECT id, "diagramId", "componentId", label, "positionX", "positionY", "instanceData", "createdAt", "updatedAt" FROM "DiagramInstance"'
) AS d(id text, did text, cid text, l text, px float, py float, idata jsonb, ca timestamp, ua timestamp)
JOIN di_map m ON m.old_id = d.id
JOIN dgm_map dg ON dg.old_id = d.did
JOIN comp_map c ON c.old_id = d.cid;

-- ==================== Diagram Edges ====================
CREATE TEMP TABLE de_map AS
SELECT id AS old_id, gen_random_uuid() AS new_id
FROM dblink(:'conn', 'SELECT id FROM "DiagramEdge"') AS t(id text);

INSERT INTO diagram_edges (id, diagram_id, source_instance_id, target_instance_id, source_pin_id, target_pin_id, created_at)
SELECT m.new_id, dg.new_id, si.new_id, ti.new_id, d.spid, d.tpid, d.ca::timestamptz
FROM dblink(:'conn',
  'SELECT id, "diagramId", "sourceInstanceId", "targetInstanceId", "sourcePinId", "targetPinId", "createdAt" FROM "DiagramEdge"'
) AS d(id text, did text, sid text, tid text, spid text, tpid text, ca timestamp)
JOIN de_map m ON m.old_id = d.id
JOIN dgm_map dg ON dg.old_id = d.did
JOIN di_map si ON si.old_id = d.sid
JOIN di_map ti ON ti.old_id = d.tid;

-- ==================== District Data ====================
CREATE TEMP TABLE dd_map AS
SELECT id AS old_id, gen_random_uuid() AS new_id
FROM dblink(:'conn', 'SELECT id FROM "DistrictData"') AS t(id text);

INSERT INTO district_data (id, diagram_instance_id, transformer_capacity, supply_range, supply_area, household_count, updated_by, created_at, updated_at)
SELECT m.new_id, i.new_id, d.tc, d.sr, d.sa, d.hc, u.new_id, d.ca::timestamptz, d.ua::timestamptz
FROM dblink(:'conn',
  'SELECT id, "diagramInstanceId", "transformerCapacity", "supplyRange", "supplyArea", "householdCount", "updatedBy", "createdAt", "updatedAt" FROM "DistrictData"'
) AS d(id text, iid text, tc float, sr text, sa text, hc int, ub text, ca timestamp, ua timestamp)
JOIN dd_map m ON m.old_id = d.id
JOIN di_map i ON i.old_id = d.iid
LEFT JOIN uid_map u ON u.old_id = d.ub;

-- ==================== Line Segment Data ====================
CREATE TEMP TABLE ls_map AS
SELECT id AS old_id, gen_random_uuid() AS new_id
FROM dblink(:'conn', 'SELECT id FROM "LineSegmentData"') AS t(id text);

INSERT INTO line_segment_data (id, diagram_edge_id, length, wire_model, wire_ownership, wire_type, is_main_display, updated_by, created_at, updated_at)
SELECT m.new_id, e.new_id, d.len, d.wm, d.wo, d.wt, d.imd, u.new_id, d.ca::timestamptz, d.ua::timestamptz
FROM dblink(:'conn',
  'SELECT id, "diagramEdgeId", length, "wireModel", "wireOwnership", "wireType", "isMainDisplay", "updatedBy", "createdAt", "updatedAt" FROM "LineSegmentData"'
) AS d(id text, eid text, len float, wm text, wo text, wt text, imd boolean, ub text, ca timestamp, ua timestamp)
JOIN ls_map m ON m.old_id = d.id
JOIN de_map e ON e.old_id = d.eid
LEFT JOIN uid_map u ON u.old_id = d.ub;

-- ==================== GIS Data ====================
CREATE TEMP TABLE gs_map AS
SELECT id AS old_id, gen_random_uuid() AS new_id
FROM dblink(:'conn', 'SELECT id FROM "GisData"') AS t(id text);

INSERT INTO gis_data (id, diagram_instance_id, latitude, longitude, updated_by, created_at, updated_at)
SELECT m.new_id, i.new_id, d.lat, d.lng, u.new_id, d.ca::timestamptz, d.ua::timestamptz
FROM dblink(:'conn',
  'SELECT id, "diagramInstanceId", latitude, longitude, "updatedBy", "createdAt", "updatedAt" FROM "GisData"'
) AS d(id text, iid text, lat float, lng float, ub text, ca timestamp, ua timestamp)
JOIN gs_map m ON m.old_id = d.id
JOIN di_map i ON i.old_id = d.iid
LEFT JOIN uid_map u ON u.old_id = d.ub;

-- ==================== Review Requests ====================
CREATE TEMP TABLE rr_map AS
SELECT id AS old_id, gen_random_uuid() AS new_id
FROM dblink(:'conn', 'SELECT id FROM "ReviewRequest"') AS t(id text);

INSERT INTO review_requests (id, diagram_id, diagram_version_id, submitter_id, reviewer_id, status, comment, submitted_at, reviewed_at)
SELECT m.new_id, dg.new_id, dv.new_id, su.new_id, ru.new_id, d.s::text, d.cmt, d.sa::timestamptz, d.ra::timestamptz
FROM dblink(:'conn',
  'SELECT id, "diagramId", "diagramVersionId", "submitterId", "reviewerId", status, comment, "submittedAt", "reviewedAt" FROM "ReviewRequest"'
) AS d(id text, did text, dvid text, sid text, rid text, s text, cmt text, sa timestamp, ra timestamp)
JOIN rr_map m ON m.old_id = d.id
JOIN dgm_map dg ON dg.old_id = d.did
LEFT JOIN dv_map dv ON dv.old_id = d.dvid
LEFT JOIN uid_map su ON su.old_id = d.sid
LEFT JOIN uid_map ru ON ru.old_id = d.rid;

-- ==================== Audit Logs ====================
-- targetId is old cuid format, cannot convert to UUID — skip for now
-- INSERT INTO audit_logs ... SKIPPED

-- ==================== Cleanup & Verify ====================
DROP TABLE IF EXISTS uid_map, cid_map, comp_map, cv_map, dgm_map, dv_map, di_map, de_map, dd_map, ls_map, gs_map, rr_map;

SELECT '=== Migration Complete ===' AS status;
SELECT 'users' as tbl, count(*) FROM users
UNION ALL SELECT 'component_categories', count(*) FROM component_categories
UNION ALL SELECT 'components', count(*) FROM components
UNION ALL SELECT 'component_versions', count(*) FROM component_versions
UNION ALL SELECT 'diagrams', count(*) FROM diagrams
UNION ALL SELECT 'diagram_versions', count(*) FROM diagram_versions
UNION ALL SELECT 'diagram_instances', count(*) FROM diagram_instances
UNION ALL SELECT 'diagram_edges', count(*) FROM diagram_edges
UNION ALL SELECT 'district_data', count(*) FROM district_data
UNION ALL SELECT 'line_segment_data', count(*) FROM line_segment_data
UNION ALL SELECT 'gis_data', count(*) FROM gis_data
UNION ALL SELECT 'review_requests', count(*) FROM review_requests
UNION ALL SELECT 'audit_logs', count(*) FROM audit_logs;
