-- Project Engineer fields added to PIS in the 2025 template revision.
-- The 2024 template skipped this section; the 2025 template puts it at row 39
-- (between General Contractor and Billing Contact). Already-existing PIS rows
-- have NULL for these fields; new submissions / extracts populate them.
--
-- pis-extract-from-sharepoint edge function (added 2026-05-03) reads these
-- from cells B39-B43 of the 2025 template; older 2024 PIS files leave them NULL.

ALTER TABLE public.project_info_sheets
  ADD COLUMN IF NOT EXISTS engineer_name TEXT,
  ADD COLUMN IF NOT EXISTS engineer_mobile TEXT,
  ADD COLUMN IF NOT EXISTS engineer_office TEXT,
  ADD COLUMN IF NOT EXISTS engineer_email TEXT,
  ADD COLUMN IF NOT EXISTS engineer_alt TEXT;
