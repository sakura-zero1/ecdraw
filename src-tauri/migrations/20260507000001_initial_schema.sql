-- Initial schema for ECDraw 2.0 (SQLx migration)
-- Converted from Prisma schema, PKs changed from cuid() to UUID v4

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ========== Enums ==========

CREATE TYPE user_status AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE diagram_status AS ENUM ('DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'REJECTED', 'PENDING_DELETE');
CREATE TYPE review_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- ========== Core tables ==========

CREATE TABLE users (
    id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    username      VARCHAR     NOT NULL UNIQUE,
    password_hash VARCHAR     NOT NULL,
    roles         TEXT        NOT NULL DEFAULT '"VIEWER"',  -- JSON string array
    status        user_status NOT NULL DEFAULT 'ACTIVE',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE components (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        VARCHAR     NOT NULL,
    category    VARCHAR     NOT NULL,
    description TEXT,
    owner_id    UUID        NOT NULL REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_components_owner_id ON components(owner_id);
CREATE INDEX idx_components_category ON components(category);

CREATE TABLE component_versions (
    id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    component_id UUID        NOT NULL REFERENCES components(id) ON DELETE CASCADE,
    version_no   INTEGER     NOT NULL,
    snapshot     JSONB       NOT NULL,
    created_by   UUID        NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(component_id, version_no)
);
CREATE INDEX idx_component_versions_created_at ON component_versions(created_at);

CREATE TABLE component_categories (
    id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    name       VARCHAR     NOT NULL UNIQUE,
    label      VARCHAR     NOT NULL,
    color      VARCHAR     NOT NULL DEFAULT '6b7280',
    built_in   BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE diagrams (
    id          UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        VARCHAR        NOT NULL,
    description TEXT,
    owner_id    UUID           NOT NULL REFERENCES users(id),
    status      diagram_status NOT NULL DEFAULT 'DRAFT',
    created_at  TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_diagrams_owner_id ON diagrams(owner_id);
CREATE INDEX idx_diagrams_status ON diagrams(status);

CREATE TABLE diagram_versions (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    diagram_id  UUID        NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
    version_no  INTEGER     NOT NULL,
    snapshot    JSONB       NOT NULL,
    created_by  UUID        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(diagram_id, version_no)
);
CREATE INDEX idx_diagram_versions_created_at ON diagram_versions(created_at);

CREATE TABLE diagram_instances (
    id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    diagram_id    UUID        NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
    component_id  UUID        NOT NULL REFERENCES components(id),
    label         VARCHAR     NOT NULL,
    position_x    DOUBLE PRECISION NOT NULL DEFAULT 0,
    position_y    DOUBLE PRECISION NOT NULL DEFAULT 0,
    instance_data JSONB       NOT NULL DEFAULT '{}',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_diagram_instances_diagram_id ON diagram_instances(diagram_id);
CREATE INDEX idx_diagram_instances_component_id ON diagram_instances(component_id);

CREATE TABLE diagram_edges (
    id                 UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    diagram_id         UUID        NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
    source_instance_id UUID        NOT NULL REFERENCES diagram_instances(id) ON DELETE CASCADE,
    target_instance_id UUID        NOT NULL REFERENCES diagram_instances(id) ON DELETE CASCADE,
    source_pin_id      VARCHAR     NOT NULL,
    target_pin_id      VARCHAR     NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_diagram_edges_diagram_id ON diagram_edges(diagram_id);
CREATE INDEX idx_diagram_edges_source_instance_id ON diagram_edges(source_instance_id);
CREATE INDEX idx_diagram_edges_target_instance_id ON diagram_edges(target_instance_id);

-- ========== Data extension tables (1:1 with instances/edges) ==========

CREATE TABLE district_data (
    id                   UUID              PRIMARY KEY DEFAULT uuid_generate_v4(),
    diagram_instance_id  UUID              NOT NULL UNIQUE REFERENCES diagram_instances(id) ON DELETE CASCADE,
    transformer_capacity DOUBLE PRECISION,
    supply_range         VARCHAR,
    supply_area          VARCHAR,
    household_count      INTEGER,
    updated_by           UUID              NOT NULL,
    created_at           TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ       NOT NULL DEFAULT NOW()
);

CREATE TABLE line_segment_data (
    id              UUID              PRIMARY KEY DEFAULT uuid_generate_v4(),
    diagram_edge_id UUID              NOT NULL UNIQUE REFERENCES diagram_edges(id) ON DELETE CASCADE,
    length          DOUBLE PRECISION,
    wire_model      VARCHAR,
    wire_ownership  VARCHAR,
    wire_type       VARCHAR,
    is_main_display BOOLEAN           NOT NULL DEFAULT TRUE,
    updated_by      UUID              NOT NULL,
    created_at      TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ       NOT NULL DEFAULT NOW()
);

CREATE TABLE gis_data (
    id                  UUID              PRIMARY KEY DEFAULT uuid_generate_v4(),
    diagram_instance_id UUID              NOT NULL UNIQUE REFERENCES diagram_instances(id) ON DELETE CASCADE,
    latitude            DOUBLE PRECISION,
    longitude           DOUBLE PRECISION,
    updated_by          UUID              NOT NULL,
    created_at          TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ       NOT NULL DEFAULT NOW()
);

-- ========== Review & Audit ==========

CREATE TABLE review_requests (
    id                 UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    diagram_id         UUID          NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
    diagram_version_id UUID          NOT NULL REFERENCES diagram_versions(id) ON DELETE CASCADE,
    submitter_id       UUID          NOT NULL,
    reviewer_id        UUID          REFERENCES users(id),
    status             review_status NOT NULL DEFAULT 'PENDING',
    comment            TEXT,
    submitted_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    reviewed_at        TIMESTAMPTZ
);
CREATE INDEX idx_review_requests_status ON review_requests(status);
CREATE INDEX idx_review_requests_submitted_at ON review_requests(submitted_at);

CREATE TABLE audit_logs (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action      VARCHAR     NOT NULL,
    target_type VARCHAR     NOT NULL,
    target_id   UUID        NOT NULL,
    payload     JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_target ON audit_logs(target_type, target_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);
