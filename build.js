#!/usr/bin/env node
/**
 * Production build wrapper.
 *
 * Two responsibilities:
 *   1. Run write-version.js (writes commit SHA + build timestamp into
 *      public/version.json and src/build-info.json so the client bundle
 *      knows which SHA it was built from).
 *   2. Spawn `react-scripts build` with CI=false in the env.
 *
 * Why CI=false: Vercel sets CI=true automatically, which makes
 * react-scripts treat every ESLint warning as an error. We have a known
 * backlog of latent warnings (no-unused-vars, react-hooks/exhaustive-deps,
 * plus 108 no-restricted-syntax warnings from the Phase-1 sb.js migration
 * marker) being addressed incrementally — see CLAUDE.md tech-debt #11.
 * Forcing CI=false at build time keeps warnings visible in build logs but
 * stops them from gating deploys.
 *
 * Cross-platform: a shell-style `CI=false react-scripts build` would
 * work on Linux/git-bash but fail in cmd.exe; this node wrapper sets
 * process.env.CI before spawning the child process and works everywhere.
 */

require('./write-version'); // runs the version-write side-effect

process.env.CI = 'false';

const { spawnSync } = require('child_process');
const isWin = process.platform === 'win32';

// On Windows, spawning a .cmd shim directly via spawn returns EINVAL on
// modern Node versions (security fix for command-injection CVE). Setting
// shell:true routes through cmd.exe which handles .cmd correctly.
const result = spawnSync('react-scripts', ['build'], {
  stdio: 'inherit',
  env: process.env,
  shell: isWin,
});

if (result.error) {
  console.error('[build.js] failed to spawn react-scripts:', result.error.message);
  process.exit(1);
}
process.exit(result.status === null ? 1 : result.status);
