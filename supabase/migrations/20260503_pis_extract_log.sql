-- pis_extract_log — audit trail for PIS extraction events.
--
-- Created when bulk PIS pull lands on Customer Master. Each row captures one
-- attempt (success OR failure) so we can:
--   1. Diagnose patterns in failures (which folders, which filenames, which
--      template versions trip the parser).
--   2. Show a "last bulk run" summary on the Customer Master footer.
--   3. Tell Amiee which specific rows wrote vs. which need her hand.
--
-- Single-pull invocations (the per-job button on the Parties tab) also log
-- here so the trail is complete.
--
-- RLS: standard OPS pattern (see CLAUDE.md → "RLS pattern").
--   `public access FOR ALL USING(true) WITH CHECK(true)` — auth is enforced
--   at the application layer, NOT via role-targeted policies.

CREATE TABLE IF NOT EXISTS public.pis_extract_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id          UUID REFERENCES public.jobs(id) ON DELETE CASCADE,
  job_number      TEXT,
  -- 'success' = file found, parsed, fields applied to project_info_sheets
  -- 'no_file' = folder OK but no PIS-named file in it
  -- 'no_folder' = job has no sharepoint_folder_url linked
  -- 'parse_error' = file found but exceljs / cell map failed
  -- 'graph_error' = MS Graph auth or fetch failed
  -- 'http_error' = edge function returned non-2xx
  -- 'skipped' = had submitted_at PIS already, or had existing parties data
  outcome         TEXT NOT NULL,
  -- For success rows: count of fields actually written to project_info_sheets
  -- (post-quality-filter; values stripped as "Same as Owner" don't count).
  fields_applied  INT,
  -- For success rows: how many fields the extractor returned with content.
  -- fields_extracted - fields_applied = quality-filter rejections.
  fields_extracted INT,
  -- '2024' or '2025' — the cell-map version detected.
  template_version TEXT,
  -- Filename of the PIS file matched, if any.
  file_name       TEXT,
  -- Edge function execution time in milliseconds.
  duration_ms     INT,
  -- For non-success rows: the error message / reason text.
  error_message   TEXT,
  -- 'bulk' (Customer Master button) or 'single' (Parties tab button).
  source          TEXT NOT NULL DEFAULT 'single',
  -- Email of the operator (Amiee, David, etc.) — best-effort; null OK.
  triggered_by    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index on (created_at DESC) for "show me the last bulk run" lookups.
CREATE INDEX IF NOT EXISTS idx_pis_extract_log_created_at
  ON public.pis_extract_log (created_at DESC);

-- Index on (job_id) for "show me all extractions for this job" lookups.
CREATE INDEX IF NOT EXISTS idx_pis_extract_log_job_id
  ON public.pis_extract_log (job_id) WHERE job_id IS NOT NULL;

-- Index on (source, created_at DESC) for filtering bulk-only runs.
CREATE INDEX IF NOT EXISTS idx_pis_extract_log_source_created_at
  ON public.pis_extract_log (source, created_at DESC);

ALTER TABLE public.pis_extract_log ENABLE ROW LEVEL SECURITY;

-- Standard OPS pattern (anon-key client, app-layer authz). See CLAUDE.md.
DROP POLICY IF EXISTS "public access" ON public.pis_extract_log;
CREATE POLICY "public access" ON public.pis_extract_log
  FOR ALL TO public USING (true) WITH CHECK (true);

COMMENT ON TABLE public.pis_extract_log IS
  'Audit trail of PIS extraction attempts. Populated by bulk pull (Customer Master) and single pull (Parties tab). RLS uses the standard OPS public-access pattern.';
