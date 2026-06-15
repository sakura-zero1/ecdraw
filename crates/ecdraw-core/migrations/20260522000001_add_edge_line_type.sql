ALTER TABLE diagram_edges
    ADD COLUMN IF NOT EXISTS line_type TEXT NOT NULL DEFAULT 'straight';
