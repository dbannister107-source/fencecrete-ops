// Lightweight Supabase REST helpers for code that lives outside src/App.jsx.
// Mirrors the SB / KEY / sbGet / sbPost / sbPatch / sbDel pattern that
// App.jsx has used since day one. App.jsx still owns its own copies for now —
// this file exists so feature modules under src/features/ can hit PostgREST
// without reaching into App.jsx's module scope. A future refactor PR will
// consolidate to a single source of truth.

const SB = 'https://bdnwjokehfxudheshmmj.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJkbndqb2tlaGZ4dWRoZXNobW1qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2NjE5NDUsImV4cCI6MjA5MDIzNzk0NX0.qeItI3HZKIThW9A3T64W4TkGMo5K2FDNKbyzUOC1xoM';

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };

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
const sbAuthHeader = () => `Bearer ${KEY}`;

export { SB, KEY, H, sbGet, sbPost, sbPatch, sbDel, sbFunctionUrl, sbAuthHeader };
