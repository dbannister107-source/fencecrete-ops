-- 20260502_merge_peltier_dup.sql
--
-- Merge two companies rows for Peltier Brothers Construction. The 2026-03-29
-- bulk import created two near-duplicate rows; one had zero dependents and
-- was a stale empty placeholder.
--
--   KEEP: e2a3c75b-3d00-49be-9914-aac404a16896 ("Peltier Brothers Construction, Ltd") -- 6 jobs
--   DROP: 23934b71-fbdc-4e0f-961c-086697d2589c ("Peltier Brothers Construction")      -- 0 dependents
--
-- Pre-verified zero references across all 6 FK tables that point at
-- companies(id): jobs, contacts, deals, proposals, tasks, company_attachments.
-- No rebinding needed — this is a clean orphan-row delete.
--
-- Other suspected-dup pairs (Franklin, Watermark) are NOT touched — their
-- jobs span different markets and there's no second data point to
-- disambiguate same-business-two-markets vs. distinct-businesses. Pending
-- confirmation from sales (Matt for both pairs).
--
-- The unique normalized-name index proposed in backlog #6 is also not
-- created here — it would fail with the Franklin and Watermark dupes still
-- present. Add as a "ratchet" once those pairs are human-resolved.

DELETE FROM companies
WHERE id = '23934b71-fbdc-4e0f-961c-086697d2589c';
