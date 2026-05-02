-- 20260502_retire_legacy_job_documents.sql
--
-- job_documents is a dead parallel checklist system. Auto-populates 6
-- pending rows per job via trg auto_create_job_checklist on jobs INSERT,
-- never read or updated. contract_readiness_items / v_contract_readiness
-- is the live readiness system.
--
-- Three steps:
-- 1) Drop the auto-writer trigger so no new noise gets created
-- 2) Rename the table to legacy_job_documents to make the dead status
--    obvious without losing the data, in case any external system was
--    reading it that we missed.
-- 3) The function create_job_checklist() is left in place — dropping a
--    function while a renamed table still references it would break.
--    Drop in 30 days once we're confident nothing reads the old name.

DROP TRIGGER IF EXISTS auto_create_job_checklist ON public.jobs;

ALTER TABLE public.job_documents RENAME TO legacy_job_documents;
COMMENT ON TABLE public.legacy_job_documents IS
  'DEAD as of 2026-05-02. Replaced by contract_readiness_items / v_contract_readiness. Auto-populated by trg auto_create_job_checklist (now dropped). Slated for DROP TABLE after 2026-06-02 if no consumer surfaces.';
