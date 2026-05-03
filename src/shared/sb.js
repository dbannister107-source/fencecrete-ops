// Single entry point for ALL Supabase REST / Storage / Edge Function calls.
// Direct fetch(`${SB}/...`) outside this file is forbidden by an ESLint rule
// (no-restricted-syntax). New helpers should be added here as needs arise;
// don't reach around to inline fetches.
//
// Auth token propagation: the AuthProvider in App.jsx calls
// applySharedAuthToken on every sign-in / sign-out / refresh so this module's
// H carries the user's JWT when signed in (anon key otherwise).

const SB = 'https://bdnwjokehfxudheshmmj.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJkbndqb2tlaGZ4dWRoZXNobW1qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2NjE5NDUsImV4cCI6MjA5MDIzNzk0NX0.qeItI3HZKIThW9A3T64W4TkGMo5K2FDNKbyzUOC1xoM';

// Mutable so applySharedAuthToken can swap the Authorization value when auth
// state changes. apikey always remains the project anon key (PostgREST
// contract: apikey identifies the project; the JWT in Authorization decides
// the role).
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };

const applySharedAuthToken = (accessToken) => {
  H.Authorization = `Bearer ${accessToken || KEY}`;
};

// ─── Internal: error envelope handling ──────────────────────────────────────
// PostgREST returns a JSON body { code, message, details, hint } on errors.
// Storage returns plain text or { error, message }. Surface a useful message
// either way; truncate to keep logs readable.
async function _check(res, op) {
  if (res.ok || res.status === 204) return;
  let body = '';
  try { body = await res.text(); } catch (_) { /* ignore */ }
  let msg = body;
  try { const j = body ? JSON.parse(body) : null; msg = j?.message || j?.error || body; } catch (_) { /* keep as text */ }
  throw new Error(`${op} failed (${res.status}): ${(msg || '').slice(0, 200)}`);
}

// ─── REST: GET ──────────────────────────────────────────────────────────────
// Array of rows matching the query string.
const sbGet = async (t, q = '') => (await fetch(`${SB}/rest/v1/${t}?${q}`, { headers: H })).json();

// Single row matching the query, or null if 0 rows. Throws on multiple rows.
// Uses Accept: application/vnd.pgrst.object+json which collapses [row] → row.
async function sbGetOne(t, q = '') {
  const res = await fetch(`${SB}/rest/v1/${t}?${q}`, {
    headers: { ...H, Accept: 'application/vnd.pgrst.object+json' },
  });
  if (res.status === 406) {
    // 406 = "Results contain 0 rows" or "Results contain >1 rows" (PostgREST contract)
    const txt = await res.text();
    if (/0 rows|no row/i.test(txt)) return null;
    throw new Error(`sbGetOne ${t} ambiguous (406): ${txt.slice(0, 200)}`);
  }
  await _check(res, `GET ${t}`);
  return res.json();
}

// ─── REST: POST (insert) ────────────────────────────────────────────────────
// Default behavior preserved (returns .json() without throwing) for backward
// compat with existing App.jsx callers. Opts:
//   - returnMinimal: send Prefer: return=minimal (PostgREST returns 201 no body).
//                    Required when the anon role lacks SELECT on the table —
//                    e.g. system_events (write-only).
//   - throwOnError:  throw on non-2xx instead of returning the error envelope.
//                    Recommended for new code.
async function sbPost(t, b, opts = {}) {
  const headers = { ...H };
  if (opts.returnMinimal) headers.Prefer = 'return=minimal';
  const res = await fetch(`${SB}/rest/v1/${t}`, { method: 'POST', headers, body: JSON.stringify(b) });
  if (opts.throwOnError) await _check(res, `POST ${t}`);
  if (opts.returnMinimal && res.ok) return null;
  return res.json();
}

// ─── REST: PATCH ────────────────────────────────────────────────────────────
// PATCH by id (returns nothing on success). Throws on non-2xx.
async function sbPatch(t, id, b) {
  const res = await fetch(`${SB}/rest/v1/${t}?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...H, Prefer: 'return=minimal' },
    body: JSON.stringify(b),
  });
  await _check(res, `PATCH ${t}`);
  return null;
}

// PATCH by arbitrary filter string ("col=eq.X", "id=in.(uuid1,uuid2)", etc.).
// filter is appended raw — caller is responsible for any encoding needed in
// values (typically not, since UUIDs and emails go through verbatim).
async function sbPatchWhere(t, filter, b, opts = {}) {
  const headers = { ...H, Prefer: opts.returnRepresentation ? 'return=representation' : 'return=minimal' };
  const res = await fetch(`${SB}/rest/v1/${t}?${filter}`, {
    method: 'PATCH', headers, body: JSON.stringify(b),
  });
  await _check(res, `PATCH ${t}`);
  return opts.returnRepresentation ? res.json() : null;
}

// ─── REST: DELETE ───────────────────────────────────────────────────────────
async function sbDel(t, id) {
  const res = await fetch(`${SB}/rest/v1/${t}?id=eq.${id}`, { method: 'DELETE', headers: H });
  await _check(res, `DELETE ${t}`);
  return null;
}

async function sbDelWhere(t, filter) {
  const res = await fetch(`${SB}/rest/v1/${t}?${filter}`, { method: 'DELETE', headers: H });
  await _check(res, `DELETE ${t}`);
  return null;
}

// ─── REST: UPSERT ───────────────────────────────────────────────────────────
// POST with Prefer: resolution=merge-duplicates. opts.onConflict is the column
// list (or constraint name) for on_conflict; matches PostgREST upsert contract.
async function sbUpsert(t, b, opts = {}) {
  const url = opts.onConflict
    ? `${SB}/rest/v1/${t}?on_conflict=${encodeURIComponent(opts.onConflict)}`
    : `${SB}/rest/v1/${t}`;
  const returnRep = opts.returnRepresentation !== false; // default true
  const headers = {
    ...H,
    Prefer: `resolution=merge-duplicates,${returnRep ? 'return=representation' : 'return=minimal'}`,
  };
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(b) });
  await _check(res, `UPSERT ${t}`);
  return returnRep ? res.json() : null;
}

// ─── REST: RPC (stored procedure) ───────────────────────────────────────────
async function sbRpc(name, b) {
  const res = await fetch(`${SB}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: H, body: JSON.stringify(b || {}),
  });
  await _check(res, `RPC ${name}`);
  return res.json();
}

// ─── Storage ────────────────────────────────────────────────────────────────
// Per-segment URI component encoding so chars like `+` `=` `&` get escaped
// (encodeURI doesn't escape them and they collide with URL semantics inside
// a path component).
const _encodeStoragePath = (p) => (p || '').split('/').map(encodeURIComponent).join('/');

// Upload an object. body can be a Blob, ArrayBuffer, FormData, or string.
// opts.upsert defaults to true (overwrite if exists).
async function sbStorageUpload(bucket, path, body, contentType, opts = {}) {
  const headers = {
    apikey: KEY,
    Authorization: H.Authorization,
    'Content-Type': contentType || 'application/octet-stream',
    'x-upsert': opts.upsert === false ? 'false' : 'true',
  };
  if (opts.cacheControl) headers['Cache-Control'] = opts.cacheControl;
  const res = await fetch(`${SB}/storage/v1/object/${bucket}/${_encodeStoragePath(path)}`, {
    method: 'POST', headers, body,
  });
  await _check(res, `STORAGE UPLOAD ${bucket}/${path}`);
  return res.json();
}

async function sbStorageDelete(bucket, path) {
  const res = await fetch(`${SB}/storage/v1/object/${bucket}/${_encodeStoragePath(path)}`, {
    method: 'DELETE',
    headers: { apikey: KEY, Authorization: H.Authorization },
  });
  await _check(res, `STORAGE DELETE ${bucket}/${path}`);
  return null;
}

// Returns { signedUrl, signedURL, ... } where signedUrl is the absolute URL
// (storage's native signedURL is path-relative, which trips up direct usage).
async function sbStorageSign(bucket, path, expiresIn = 300) {
  const res = await fetch(`${SB}/storage/v1/object/sign/${bucket}/${_encodeStoragePath(path)}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: H.Authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn }),
  });
  await _check(res, `STORAGE SIGN ${bucket}/${path}`);
  const data = await res.json();
  if (data && data.signedURL) data.signedUrl = `${SB}/storage/v1${data.signedURL}`;
  return data;
}

// ─── Edge Functions ─────────────────────────────────────────────────────────
const sbFunctionUrl = (name) => `${SB}/functions/v1/${name}`;
const sbAuthHeader = () => H.Authorization;

// Standard edge function call. Defaults to using the user's session JWT (anon
// key when signed out). Pass opts.useUserAuth=false to force anon (e.g. for
// public PIS form submission). opts.skipParse returns the raw Response so the
// caller can read non-JSON or inspect status manually.
async function sbFn(name, b, opts = {}) {
  const headers = {
    'Content-Type': 'application/json',
    apikey: KEY,
    Authorization: opts.useUserAuth === false ? `Bearer ${KEY}` : H.Authorization,
    ...(opts.headers || {}),
  };
  const res = await fetch(sbFunctionUrl(name), {
    method: opts.method || 'POST',
    headers,
    body: b !== undefined ? JSON.stringify(b) : undefined,
  });
  if (opts.skipParse) return res;
  await _check(res, `FN ${name}`);
  const ct = res.headers.get('content-type') || '';
  return ct.includes('json') ? res.json() : res.text();
}

export {
  // Core
  SB, KEY, H, applySharedAuthToken,
  // REST
  sbGet, sbGetOne, sbPost, sbPatch, sbPatchWhere, sbDel, sbDelWhere, sbUpsert, sbRpc,
  // Storage
  sbStorageUpload, sbStorageDelete, sbStorageSign,
  // Edge functions
  sbFunctionUrl, sbAuthHeader, sbFn,
};
