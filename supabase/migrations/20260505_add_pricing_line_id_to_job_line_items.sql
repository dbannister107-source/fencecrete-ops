-- 20260505_add_pricing_line_id_to_job_line_items.sql
--
-- Adds the relational link from job_line_items → job_pricing_lines.
-- P1 #6 from the post-Phase-D critical review: today the two tables run
-- in parallel with overlapping data and no FK between them. This column
-- is the missing foreign key that lets the calc engine + UI know which
-- pricing scope each line item belongs to.
--
-- Single column, single FK, single index. Used by both main-contract
-- line items (co_id IS NULL) AND CO sub-line items (co_id IS NOT NULL)
-- since they live in the same table.
--
-- Delete rule SET NULL — matches job_line_items.co_id convention. If
-- the pricing row is deleted, the line item survives but loses the link;
-- the user can re-link via the LineItemsEditor's pricing-line dropdown.
--
-- Filter index (WHERE pricing_line_id IS NOT NULL) keeps the index small —
-- most legacy lines have no link until the user touches them.

ALTER TABLE public.job_line_items
  ADD COLUMN IF NOT EXISTS pricing_line_id uuid
  REFERENCES public.job_pricing_lines(id)
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ix_job_line_items_pricing_line
  ON public.job_line_items (pricing_line_id)
  WHERE pricing_line_id IS NOT NULL;

COMMENT ON COLUMN public.job_line_items.pricing_line_id IS
  'Optional link to the job_pricing_lines row that owns the rate decomposition (price = labor + tax_basis) for this line. NULL for legacy or unlinked lines. SET NULL on parent delete (matches co_id semantics — preserves the line if pricing row is deleted, just unlinks).';
