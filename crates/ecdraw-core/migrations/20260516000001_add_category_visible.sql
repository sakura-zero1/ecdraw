-- Add visible column to component_categories.
-- Default TRUE so all existing categories remain visible.
ALTER TABLE component_categories
    ADD COLUMN IF NOT EXISTS visible BOOLEAN NOT NULL DEFAULT TRUE;
