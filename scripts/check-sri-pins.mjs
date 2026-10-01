#!/usr/bin/env node
// Hold every documented <agent-3d> SRI pin to the release ledger.
//
//   npm run check:sri-pins            fail on a pin whose hash is not the
//                                     released hash of the version it pins
//   npm run check:sri-pins -- --fix   rewrite those hashes from the ledger
//
// A pin on a version that was never released cannot be fixed by rewriting a
// hash; point it at a released version instead. check-dist runs the same check
// on every build, and tests/agent-3d-releases.test.js runs it under npm test.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEDGER_REL, checkPins, readLedger } from './lib/agent-3d-releases.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fix = process.argv.includes('--fix');
const { checked, problems, fixed } = checkPins(root, readLedger(root), { fix });
for (const p of problems) console.error(`[sri-pins] ${p.file}:${p.line} ${p.message}`);
if (fixed) console.log(`[sri-pins] rewrote ${fixed} pin(s) from ${LEDGER_REL}`);
if (problems.length) {
	if (!fix) console.error('[sri-pins] run: npm run check:sri-pins -- --fix');
	process.exit(1);
}
console.log(`[sri-pins] ${checked} documented SRI pin(s) match ${LEDGER_REL}`);
