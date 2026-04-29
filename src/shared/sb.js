// Lightweight Supabase REST helpers for code that lives outside src/App.jsx.
// Mirrors the SB / KEY / sbGet / sbPost / sbPatch / sbDel pattern that
// App.jsx has used since day one. App.jsx still owns its own copies for now —
// this file exists so feature modules under src/features/ can hit PostgREST
// without reaching into App.jsx's module scope. A future refactor PR will
// consolidate to a single source of truth.
//
// AUTH TOKEN PROPAGATION (2026-04-28):
// Previously this module's H constant was frozen at module-load with the
// anon key in the Authorization header, which meant feature modules
// (SystemEventsPage, PISFormPage, etc.) hit PostgREST as the anon role
// regardless of who was logged in. Tables with policies that required the
// authenticated role (e.g. system_events SELECT) silently returned empty.
//
// The fix mirrors the pattern App.jsx already uses for its own H: a module-
// level setter (applySharedAuthToken) that the AuthProvider calls on every
// auth state change. With no token applied, requests fall back to the anon
// key — same pre-login behavior as before.

const SB = 'https://bdnwjokehfxudheshmmj.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJkbndqb2tlaGZ4dWRoZXNobW1qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2NjE5NDUsImV4cCI6MjA5MDIzNzk0NX0.qeItI3HZKIThW9A3T64W4TkGMo5K2FDNKbyzUOC1xoM';

// Mutable H so applySharedAuthToken can swap the Authorization value when
// auth state changes. The apikey header always remains the project anon key
// per Supabase's PostgREST contract (apikey identifies the project; the
// JWT in Authorization decides the role).
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };

// Called by AuthProvider in App.jsx whenever the user signs in, signs out,
// or the session is refreshed. accessToken=null falls back to anon key so
// pre-login fetches still work the same as before.
const applySharedAuthToken = (accessToken) => {
  H.Authorization = `Bearer ${accessToken || KEY}`;
};

const sbGet = async (t, q = '') => (await fetch(`${SB}/rest/v1/${t}?${q}`, { headers: H })).json();
const sbPost = async (t, b) => (await fetch(`${SB}/rest/v1/${t}`, { method: 'POST', headers: H, body: JSON.stringify(b) })).json();
const sbPatch = async (t, id, b) => {
  const r = await fetch(`${SB}/rest/v1/${t}?id=eq.${id}`, { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(b) });
  if (!r.ok && r.status !== 204) {
    const txt = await r.text();
    throw new Error(`PATCH ${t} failed (${r.status}): ${txt}`);
  }
  return {};
};
const sbDel = async (t, id) => fetch(`${SB}/rest/v1/${t}?id=eq.${id}`, { method: 'DELETE', headers: H });

const sbFunctionUrl = (name) => `${SB}/functions/v1/${name}`;
// Returns whatever Authorization value is currently in H — JWT if signed in,
// anon key otherwise. Edge functions that need the user's identity should
// call this rather than building their own header.
const sbAuthHeader = () => H.Authorization;

export { SB, KEY, H, applySharedAuthToken, sbGet, sbPost, sbPatch, sbDel, sbFunctionUrl, sbAuthHeader };
