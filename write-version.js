#!/usr/bin/env node
/**
 * Build-time script that captures the commit SHA and build timestamp
 * and writes them to two places:
 *   1. public/version.json   — served at runtime, polled by the client
 *      to detect when a new version has deployed
 *   2. src/build-info.json   — imported by the client bundle so the
 *      running code knows which SHA it was built from
 *
 * Runs before react-scripts build via the package.json "build" script.
 *
 * SHA source, in priority order:
 *   1. VERCEL_GIT_COMMIT_SHA   (Vercel production + preview builds)
 *   2. GITHUB_SHA               (GitHub Actions — unused today but future-proof)
 *   3. "dev-<timestamp>"        (local `npm run build`, no git context)
 */

const fs = require('fs');
const path = require('path');

const sha =
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.GITHUB_SHA ||
  `dev-${Date.now()}`;

const shortSha = sha.slice(0, 7);
const builtAt = new Date().toISOString();

const payload = {
  sha,
  shortSha,
  builtAt,
};

const publicPath = path.join(__dirname, 'public', 'version.json');
const srcPath = path.join(__dirname, 'src', 'build-info.json');

fs.writeFileSync(publicPath, JSON.stringify(payload, null, 2) + '\n');
fs.writeFileSync(srcPath, JSON.stringify(payload, null, 2) + '\n');

console.log(`[write-version] wrote ${shortSha} (built ${builtAt})`);
console.log(`  -> ${publicPath}`);
console.log(`  -> ${srcPath}`);
