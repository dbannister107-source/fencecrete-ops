# supabase/tests/

DB-side tests for the Fencecrete OPS Postgres schema (views, triggers, functions). Targets behavior that lives in SQL — JS tests for App.jsx are a separate concern.

## Run a test file

### Via Supabase MCP `execute_sql` (current default)

Open the file, copy its contents, paste into a single `execute_sql` call. The final `SELECT` returns a rowset of passed assertions. A failure raises and aborts the call (whole transaction rolls back via the wrapping `BEGIN/ROLLBACK`).

### Via Supabase CLI (once set up)

```bash
supabase db remote query --file supabase/tests/readiness_gate.sql
```

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

## Future — CI

These tests aren't yet wired into GitHub Actions. When CI is added:

- A workflow on every PR runs each `supabase/tests/*.sql` against a Supabase branch via `supabase db remote query --file ...`
- Workflow fails on any non-zero exit (raised by `RAISE EXCEPTION`)
- PR check turns red until tests pass

That's a separate, larger setup — not the first-test's job. The local-run pattern above is sufficient for now and is what new tests should slot into.
