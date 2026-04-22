-- Material Calculator v2.1: replace one-type-for-whole-fence drainage model
-- with a mixed-panel model where the PM specifies how many drainage panels
-- go at the TOP and BOTTOM of the fence. Remaining panels are the style's
-- regular panels.
--
-- drainage_panel_type (the old single-select column) is dropped.
-- Four new columns replace it.
--
-- Note: this migration has already been hand-applied to the live Supabase
-- database. It's committed here so future environments can replay the
-- schema from scratch. All statements are idempotent.

ALTER TABLE jobs DROP COLUMN IF EXISTS drainage_panel_type;

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS drainage_needed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS drainage_style TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS drainage_bottom_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS drainage_top_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN jobs.drainage_needed IS
  'True when this fence includes any drainage panels. Only meaningful for drainage-eligible styles.';
COMMENT ON COLUMN jobs.drainage_style IS
  'Aesthetic choice: "Diamond" or "Bottled". NULL when drainage_needed = false.';
COMMENT ON COLUMN jobs.drainage_bottom_count IS
  'Number of drainage panels placed at the bottom of the fence. 0 when not applicable.';
COMMENT ON COLUMN jobs.drainage_top_count IS
  'Number of drainage panels placed at the top of the fence. 0 when not applicable.';
