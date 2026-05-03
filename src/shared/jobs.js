// Shared helpers for working with jobs across the app. Intent: codify
// the two ID conventions in one place so callers don't reinvent them.
//
// Convention recap:
//   - jobs.id (UUID) is the technical key. Use it for joins, FKs, REST
//     filters, and anything the database ingests.
//   - jobs.job_number (text, e.g. "24H007") is the human-readable key.
//     Use it for display, search, conversation, and external/customer-
//     facing references (PIS links, contract docs).
//
// Some legacy child tables (job_line_items, leads) FK by job_number
// instead of job_id. That's a structural debt to resolve separately;
// resolveJobId() does NOT fix it. It only normalizes inputs at boundaries
// where you may receive either form (e.g., the PIS send flow, where a
// lead-id might be passed in by mistake).

import { sbGet } from './sb';

// UUID v4 (loose): 8-4-4-4-12 hex with dashes. Good enough to distinguish
// a UUID string from a job_number ("24H007") without a DB roundtrip.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Quickly check whether a string looks like a UUID (no DB roundtrip).
 * Useful when you want to branch sync-vs-async at a call site.
 */
export function isUuid(input) {
  return typeof input === 'string' && UUID_RE.test(input);
}

/**
 * Resolve a job's canonical UUID (jobs.id) from any of:
 *   - a UUID string                   -> returned as-is
 *   - a job_number string ("24H007")  -> looked up in jobs
 *   - a job-shaped object             -> prefers .id (if UUID), else
 *                                        falls back to .job_number lookup
 *
 * Returns null if input is falsy, malformed, or no matching job exists.
 * Caller must handle the null case.
 *
 * Use this at boundaries where the input might legitimately be either
 * shape (PIS flow, deep-link URL params, etc.). For routine joins you
 * already have the id -- don't add a roundtrip.
 */
export async function resolveJobId(input) {
  if (!input) return null;

  if (typeof input === 'object') {
    if (input.id && isUuid(input.id)) return input.id;
    if (input.job_number) return resolveJobId(String(input.job_number));
    return null;
  }

  if (typeof input === 'string') {
    if (isUuid(input)) return input;
    const rows = await sbGet(
      'jobs',
      `job_number=eq.${encodeURIComponent(input)}&select=id&limit=1`
    );
    return Array.isArray(rows) && rows.length > 0 ? rows[0].id : null;
  }

  return null;
}
