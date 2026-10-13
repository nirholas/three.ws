#!/usr/bin/env node
/**
 * Generate data/open-source-credits.json from scripts/lib/open-source-credits.mjs.
 *
 * Runs in the prebuild parallel block alongside the other data generators so
 * the /open-source page and its API always ship against the current
 * package.json. tests/open-source-credits.test.js re-runs buildCredits() and
 * deep-equals it against this committed file, so a dependency added without
 * regenerating fails CI instead of rotting the page silently.
 */
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildCredits, ROOT } from './lib/open-source-credits.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const outFile = resolve(ROOT || resolve(here, '..'), 'data/open-source-credits.json');

const data = buildCredits();
writeFileSync(outFile, JSON.stringify(data, null, '\t') + '\n');

console.log(`[build-open-source-credits] wrote ${data.entries.length} entries -> ${outFile}`);
