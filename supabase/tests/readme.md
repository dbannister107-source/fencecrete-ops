# supabase/tests/

DB-side tests for the Fencecrete OPS Postgres schema (views, triggers, functions). Targets behavior that lives in SQL — JS tests for App.jsx are a separate concern.

## Run a test file

### Via GitHub Actions (CI — automatic on every PR + push to main)

`.github/workflows/db-tests.yml` runs every file in this directory against the production Supabase DB on every push and PR. Failures gate merges. **This is the primary signal** — local runs are for iteration.

Trigger a manual run from the GitHub Actions tab → "DB tests" workflow → "Run workflow".

### Via Supabase MCP `execute_sql` (local dev iteration)

Open the file, copy its contents, paste into a single `execute_sql` call. The final `SELECT` returns a rowset of passed assertions. A failure raises and aborts the call (whole transaction rolls back via the wrapping `BEGIN/ROLLBACK`).

### Via direct `psql` (if you have a session)

```bash
psql "$SUPABASE_DB_URL" -f supabase/tests/readiness_gate.sql
```

## Conventions

Every test file should:

1. **Wrap in `BEGIN ... ROLLBACK`** — mutations to real data must not persist. Tests run safely against the production database.
2. **Use `DO $$ ... $$;` blocks** — one block per test scenario. Use `RAISE EXCEPTION` to fail, which aborts the whole transaction (and therefore rolls back).
3. **Track passes via a `_test_results` TEMP TABLE** — each successful assertion `INSERT`s a row. A final `SELECT` returns the list of passes so the caller has positive confirmation of what ran.
4. **Document the regression target** — every test points at a specific migration / behavior it's protecting. Future readers should be able to grep from a behavior to its test.

## Files

| File | Targets | Regression sources |
|---|---|---|
| `readiness_gate.sql` | `v_contract_readiness`, `enforce_contract_readiness()` | `20260502_fix_customer_linked_gate.sql`, `20260502_fix_readiness_trigger_fail_open.sql` |

## Adding a test file

```sql
BEGIN;

CREATE TEMP TABLE _test_results (id serial PRIMARY KEY, test text, status text DEFAULT 'PASS');

DO $$
BEGIN
  -- ... assert via IF ... THEN RAISE EXCEPTION '...' ...
  INSERT INTO _test_results (test) VALUES ('description of what passed');
END $$;

SELECT id, test, status FROM _test_results ORDER BY id;
ROLLBACK;
```

## CI — wired 2026-05-03

`.github/workflows/db-tests.yml` runs every `supabase/tests/*.sql` against the production Supabase DB via the Management API on every push to main + every PR. New test files are picked up automatically (the workflow globs the directory; no workflow edit required).

**Required GitHub Actions secrets:**
- `SUPABASE_ACCESS_TOKEN` — Personal Access Token (sbp_...). Generate at https://supabase.com/dashboard/account/tokens
- `SUPABASE_PROJECT_REF` — `bdnwjokehfxudheshmmj`

If a secret is missing, the workflow fails fast with a clear error message pointing at the Settings UI.

**Why production DB and not a branch / local Postgres:**
- BEGIN/ROLLBACK wrapping means tests can't mutate real data
- Migrations don't reliably apply from scratch (they're written for incremental application), so a fresh Postgres in CI is a porting headache
- Supabase branches add cost + complexity for a 1-engineer shop
- This is also how David runs them manually today — CI just automates it

**What happens if a test fails:**
- Failure surface: failed assertion → `RAISE EXCEPTION` → SQL error → 4xx from Management API → the workflow's curl step exits non-zero → workflow fails
- Workflow keeps running remaining test files even after one fails (so you see the full picture, not just the first failure)
- PR check turns red until you fix the regression and push again
