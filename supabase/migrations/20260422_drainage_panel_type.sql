-- Material Calculator v2 job-level columns.
--
-- drainage_panel_type: tracks drainage panel selection for drainage-eligible
-- styles (Rock, Used Brick, Smooth, Stucco, Ledgestone, Split Faced CMU
-- Block, Horizontal Wood). Values: 'Regular Panels', 'Diamond Drainage',
-- 'Bottled Drainage'. NULL for non-drainage styles.
--
-- gate_size: free-form text gate width (e.g. "8 ft", "double-gate 16'").
-- Added defensively with IF NOT EXISTS so this migration is safe to re-run
-- if gate_size was already provisioned by a prior manual migration.

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS drainage_panel_type TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS gate_size TEXT;

COMMENT ON COLUMN jobs.drainage_panel_type IS
  'Regular Panels, Diamond Drainage, or Bottled Drainage. Only set for drainage-eligible styles.';
COMMENT ON COLUMN jobs.gate_size IS
  'Free-form gate width text, e.g. "8 ft" or "double-gate 16''".';
