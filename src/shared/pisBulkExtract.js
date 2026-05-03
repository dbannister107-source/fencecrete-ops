// pisBulkExtract — bulk-pull PIS data across every eligible project.
//
// Built 2026-05-03. Wraps the existing `pis-extract-from-sharepoint` edge
// function and applies the same write logic as the single-pull Parties tab,
// except:
//   - Idempotent: only writes to fields that are currently null/empty on the
//     existing project_info_sheets row. Never overwrites human-entered data.
//   - Quality filter: drops "Same as Owner" / template placeholders / values
//     shorter than 3 chars before applying. Customers occasionally write these
//     in the spreadsheet; we don't want them in our database.
//   - Idempotently creates a project_info_sheets row when none exists, with
//     submitted_at = NULL (flags as Amiee-entered, not customer-submitted).
//   - Logs every attempt to pis_extract_log for the audit trail.
//
// Concurrency: ~5 simultaneous calls to the edge function. Microsoft Graph
// has plenty of headroom; Supabase edge functions are also fine. Going higher
// risks burning cold-start CPU concurrently and saturating the Graph token
// cache rebuild on the function side.

import { sbGet, sbPost, sbPatchWhere, sbFn } from './sb';

// PIS columns the extractor returns. Mirrors PisExtractPreviewModal's FIELD_MAP
// in App.jsx. Keep these in sync if the extractor adds new fields.
const PIS_FIELDS = [
  // Owner
  'owner_company', 'owner_address', 'owner_city', 'owner_state', 'owner_zip',
  'owner_phone', 'owner_contact', 'owner_contact_phone', 'owner_email', 'owner_alt_contact',
  // GC
  'gc_company', 'gc_address', 'gc_city', 'gc_state', 'gc_zip',
  'gc_phone', 'gc_contact', 'gc_contact_phone', 'gc_email', 'gc_alt_contact',
  // Engineer (2025+ template only)
  'engineer_name', 'engineer_mobile', 'engineer_office', 'engineer_email', 'engineer_alt',
  // Billing
  'billing_contact', 'billing_address', 'billing_city', 'billing_state', 'billing_zip',
  'billing_phone', 'billing_email',
  // PM / Superintendent
  'pm_name', 'pm_mobile', 'pm_office', 'pm_email',
  // Surety
  'surety_name', 'surety_address', 'surety_city', 'surety_state', 'surety_zip',
  'surety_contact', 'surety_phone', 'surety_email',
  // Bonding Agent
  'agent_name', 'agent_address', 'agent_city', 'agent_state', 'agent_zip',
  'agent_phone', 'agent_email',
];

const BOOLEAN_FIELDS = ['bonding_required', 'taxable'];

// Quality filter — drops values that don't belong in the database:
//   "Same as Owner" / "same as above" pattern
//   Empty / whitespace-only
//   Shorter than 3 chars (probably stray cell content)
//   Template placeholders: "[Owner Company]", "(name here)", etc.
//   Common spreadsheet noise: "N/A", "TBD", "?", "—", "-"
const PLACEHOLDER_RE = /^\s*[[(]?\s*(N\/A|TBD|TBA|tbd|n\/a|none|—|-)\s*[\])]?\s*$/i;
const SAME_AS_RE = /^\s*same\s+as\b/i;
const TEMPLATE_PLACEHOLDER_RE = /^\s*[[(].*[\])]\s*$/;  // "[Foo]" or "(Foo)"

function isLikelyJunk(value) {
  if (value == null) return true;
  const s = String(value).trim();
  if (s === '') return true;
  if (s.length < 3) return true;  // "OK", "x", "??" etc.
  if (PLACEHOLDER_RE.test(s)) return true;
  if (SAME_AS_RE.test(s)) return true;
  if (TEMPLATE_PLACEHOLDER_RE.test(s)) return true;
  return false;
}

// Filter the extracted fields object: keep only string fields that pass the
// quality check + the boolean fields when explicitly set. Returns
// { cleaned, droppedKeys } so the audit log can record what got rejected.
function applyQualityFilter(fields) {
  const cleaned = {};
  const droppedKeys = [];
  for (const k of PIS_FIELDS) {
    const v = fields[k];
    if (v == null || v === '') continue;
    if (isLikelyJunk(v)) {
      droppedKeys.push(k);
      continue;
    }
    cleaned[k] = String(v).trim();
  }
  for (const k of BOOLEAN_FIELDS) {
    const v = fields[k];
    if (v === true || v === false) cleaned[k] = v;
  }
  return { cleaned, droppedKeys };
}

// Compute the subset of cleaned fields that should actually be written to
// project_info_sheets — only fields where the existing row's value is empty
// (null or empty string). For booleans, only write if the existing row has NULL.
//
// existingRow may be null (no PIS row yet) → all cleaned fields are eligible.
function pickWritableFields(cleaned, existingRow) {
  if (!existingRow) return cleaned;
  const writable = {};
  for (const [k, v] of Object.entries(cleaned)) {
    const cur = existingRow[k];
    if (BOOLEAN_FIELDS.includes(k)) {
      if (cur === null || cur === undefined) writable[k] = v;
    } else {
      if (cur == null || cur === '') writable[k] = v;
    }
  }
  return writable;
}

// Log one extraction attempt to pis_extract_log. Best-effort — failures here
// don't bubble (logging shouldn't break the main flow).
async function logAttempt(row) {
  try {
    await sbPost('pis_extract_log', [row]);
  } catch (e) {
    console.warn('[pisBulkExtract] log write failed', e);
  }
}

// Process one job: call the edge function, apply quality filter, write the
// fields, log to pis_extract_log. Returns a result object the caller uses to
// drive the progress UI and final summary.
async function processOneJob(job, triggeredBy) {
  const startedAt = Date.now();
  const result = {
    job_id: job.id,
    job_number: job.job_number,
    job_name: job.job_name,
    outcome: 'unknown',
    fields_applied: 0,
    fields_extracted: 0,
    fields_dropped: 0,
    template_version: null,
    file_name: null,
    duration_ms: 0,
    error_message: null,
    pis_id: null,
  };

  try {
    // Edge function call.
    let data;
    try {
      data = await sbFn('pis-extract-from-sharepoint', { job_id: job.id });
    } catch (e) {
      result.outcome = 'http_error';
      result.error_message = e.message || String(e);
      return result;
    }
    result.duration_ms = Date.now() - startedAt;
    result.template_version = data.template_version || null;
    result.file_name = data.file?.name || null;

    if (!data.found) {
      // The edge function distinguishes between "no folder linked" and
      // "folder fine, no file matching the heuristic". Normalize:
      if (/no sharepoint_folder_url/i.test(data.reason || '')) {
        result.outcome = 'no_folder';
      } else if (/Could not resolve folder/i.test(data.reason || '')) {
        result.outcome = 'graph_error';
      } else {
        result.outcome = 'no_file';
      }
      result.error_message = data.reason || 'extraction returned found=false';
      return result;
    }

    // Apply quality filter.
    const fieldsExtracted = (data.fields && typeof data.fields === 'object')
      ? Object.keys(data.fields).filter(k => data.fields[k] != null && data.fields[k] !== '').length
      : 0;
    result.fields_extracted = fieldsExtracted;

    const { cleaned, droppedKeys } = applyQualityFilter(data.fields || {});
    result.fields_dropped = droppedKeys.length;

    if (Object.keys(cleaned).length === 0) {
      result.outcome = 'no_fields_passed_filter';
      result.error_message = `Extractor returned data but quality filter rejected all values. Dropped: ${droppedKeys.join(', ')}`;
      return result;
    }

    // Look up existing project_info_sheets row to apply idempotent merge.
    const rows = await sbGet(
      'project_info_sheets',
      `select=id,${PIS_FIELDS.join(',')},${BOOLEAN_FIELDS.join(',')},submitted_at&job_id=eq.${job.id}&order=created_at.desc&limit=1`,
    );
    const existing = Array.isArray(rows) && rows[0] ? rows[0] : null;

    // Hard skip if a customer-submitted PIS already exists. The extractor's
    // own gate filters this case out, but defense-in-depth.
    if (existing && existing.submitted_at) {
      result.outcome = 'skipped';
      result.error_message = 'Customer-submitted PIS already on file';
      return result;
    }

    const writable = pickWritableFields(cleaned, existing);
    result.fields_applied = Object.keys(writable).length;

    if (result.fields_applied === 0) {
      // Nothing new to write. Existing row already has everything the
      // extractor would have given us.
      result.outcome = 'noop';
      result.error_message = 'All extracted fields already populated on existing row';
      return result;
    }

    if (existing && existing.id) {
      await sbPatchWhere(
        'project_info_sheets',
        `id=eq.${existing.id}`,
        writable,
      );
      result.pis_id = existing.id;
    } else {
      // Insert new row. Hydrate job-address fields from the job record so the
      // PIS row's job-side data shape mirrors a customer-submitted PIS.
      const insertPayload = {
        ...writable,
        job_id: job.id,
        job_number: job.job_number || null,
        job_address: job.address || null,
        job_city: job.city || null,
        job_state: job.state || null,
        job_zip: job.zip || null,
        // submitted_at intentionally NULL — flags as internally-entered.
      };
      const inserted = await sbPost('project_info_sheets', [insertPayload], { throwOnError: true });
      result.pis_id = Array.isArray(inserted) && inserted[0] ? inserted[0].id : null;
    }

    result.outcome = 'success';
    return result;

  } catch (e) {
    result.outcome = result.outcome === 'unknown' ? 'http_error' : result.outcome;
    result.error_message = e.message || String(e);
    if (!result.duration_ms) result.duration_ms = Date.now() - startedAt;
    return result;
  } finally {
    // Audit log every attempt, including failures.
    logAttempt({
      job_id: job.id,
      job_number: job.job_number,
      outcome: result.outcome,
      fields_applied: result.fields_applied,
      fields_extracted: result.fields_extracted,
      template_version: result.template_version,
      file_name: result.file_name,
      duration_ms: result.duration_ms,
      error_message: result.error_message ? String(result.error_message).slice(0, 1000) : null,
      source: 'bulk',
      triggered_by: triggeredBy || null,
    });
  }
}

// Run a function over `items` with at most `concurrency` in flight at once.
// Calls onProgress(completed, total, lastResult) after each item finishes.
async function runWithConcurrency(items, concurrency, fn, onProgress) {
  const results = new Array(items.length);
  let nextIdx = 0;
  let completed = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = nextIdx++;
      if (i >= items.length) return;
      try {
        results[i] = await fn(items[i]);
      } catch (e) {
        results[i] = { error: e.message || String(e), item: items[i] };
      }
      completed++;
      if (onProgress) onProgress(completed, items.length, results[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

// Public API.
//
// Run bulk extraction across the supplied list of eligible jobs. Each job
// must have at minimum { id, job_number, sharepoint_folder_url }; address /
// city / state / zip used for hydrating new PIS rows.
//
// Options:
//   concurrency  — default 5
//   onProgress   — (completed, total, lastResult) => void
//   triggeredBy  — email/name to record in pis_extract_log
//
// Returns: { results: [...], summary: {success, no_file, ...} }
async function bulkExtractPis(jobs, opts = {}) {
  const { concurrency = 5, onProgress, triggeredBy } = opts;
  const results = await runWithConcurrency(
    jobs,
    concurrency,
    (job) => processOneJob(job, triggeredBy),
    onProgress,
  );
  const summary = results.reduce((acc, r) => {
    const key = r?.outcome || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  summary.total = results.length;
  return { results, summary };
}

export { bulkExtractPis, applyQualityFilter, isLikelyJunk, PIS_FIELDS };
