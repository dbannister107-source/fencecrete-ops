-- 20260505_create_job_pricing_lines.sql
--
-- Phase A.1 of the Accounting Sheet / Billing Engine — replaces Virginia's
-- manual Excel "Acct Sheet" with a native OPS feature.
--
-- This is the "Original Contract Amounts" section of the Excel — one row per
-- pricing scope on the job (4' pc / 5' pc / 6' pc / sw / 16' Gate / Option 1
-- / Permit / Bonds / etc.). Each row carries the full price decomposition
-- needed by the billing engine:
--
--   price_per_unit      total $/unit (e.g. $95 for 4' pc)
--   labor_per_unit      labor portion (e.g. $72)         = price - tax_basis
--   tax_basis_per_unit  taxable material portion (e.g. $23)
--
-- The split lets the calc engine apply the per-stage weights (65/20/15) and
-- compute sales tax on the tax-basis portion only.
--
-- CO sub-pricing rows scope by co_id (mirrors the job_line_items pattern).
-- co_id IS NULL → original contract; co_id = X → sub-line under change order X.
--
-- qty + unit chosen over plain `lf` so gate rows ('EA') and lump-sum rows
-- ('LS') don't masquerade as 1-LF the way job_line_items currently does.

CREATE TABLE IF NOT EXISTS public.job_pricing_lines (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id              uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  co_id               uuid REFERENCES public.change_orders(id) ON DELETE CASCADE,
  line_number         int  NOT NULL,
  category            text NOT NULL CHECK (category IN ('precast','sw','wi_gate','option','permit','bond','other')),
  label               text NOT NULL,
  fence_type          text,
  height              text,
  style               text,
  qty                 numeric(10,2) NOT NULL DEFAULT 0,
  unit                text NOT NULL DEFAULT 'LF' CHECK (unit IN ('LF','EA','LS')),
  price_per_unit      numeric(10,2),
  labor_per_unit      numeric(10,2),
  tax_basis_per_unit  numeric(10,2),
  tax_exempt          boolean NOT NULL DEFAULT false,
  extended_total      numeric(12,2),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_job_pricing_lines_job
  ON public.job_pricing_lines (job_id, line_number);

CREATE INDEX IF NOT EXISTS ix_job_pricing_lines_co
  ON public.job_pricing_lines (co_id) WHERE co_id IS NOT NULL;

ALTER TABLE public.job_pricing_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public access" ON public.job_pricing_lines;
CREATE POLICY "public access" ON public.job_pricing_lines
  FOR ALL TO public USING (true) WITH CHECK (true);

COMMENT ON TABLE public.job_pricing_lines IS
  'Per-job pricing book (the Excel Acct Sheet "Original Contract Amounts" section). One row per pricing scope (each precast height, SW, each gate type, each option, etc.). Drives the Accounting tab calc engine. Scoped by co_id for CO sub-pricing.';

COMMENT ON COLUMN public.job_pricing_lines.labor_per_unit IS
  'Labor portion of price_per_unit. Sales tax is computed on tax_basis_per_unit, not on this. labor_per_unit + tax_basis_per_unit = price_per_unit.';

COMMENT ON COLUMN public.job_pricing_lines.tax_basis_per_unit IS
  'Taxable material portion. The Excel HEIGHT_BASIS lookup auto-populates this on first open: 4''=23, 5''=24.75, 6''=26, 7''=27.50, 8''=29.25, 9''=30.50, 10''=31.75. Manual override allowed.';

COMMENT ON COLUMN public.job_pricing_lines.tax_exempt IS
  'Per-line override (Excel R15 has 8'' pc Exempt because labor exceeds the standard tax basis). When true, the calc engine emits 0 sales tax for this line regardless of jobs.tax_exempt.';

-- ── Trigger: maintain extended_total from qty × price_per_unit ──────
-- Cached for fast reads on the Acct Sheet header. Same pattern as
-- job_line_items.line_value but enforced by the DB rather than the app.

CREATE OR REPLACE FUNCTION public.fn_jpl_extended_total()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  NEW.extended_total := COALESCE(NEW.qty, 0) * COALESCE(NEW.price_per_unit, 0);
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_jpl_extended_total ON public.job_pricing_lines;
CREATE TRIGGER trg_jpl_extended_total
  BEFORE INSERT OR UPDATE OF qty, price_per_unit
  ON public.job_pricing_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_jpl_extended_total();
