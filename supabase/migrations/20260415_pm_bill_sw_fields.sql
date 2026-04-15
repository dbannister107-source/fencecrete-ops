-- Adds new Single Wythe LF fields to PM bill submissions.
ALTER TABLE pm_bill_submissions
  ADD COLUMN IF NOT EXISTS sw_accent_columns NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sw_large_columns  NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sw_other_lf       NUMERIC DEFAULT 0;
