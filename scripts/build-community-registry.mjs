#!/usr/bin/env node
/**
 * Validate community-skills/ and regenerate community-skills/registry.json.
 *
 *   node scripts/build-community-registry.mjs          validate + write
 *   node scripts/build-community-registry.mjs --check  validate + fail when stale
 *
 * Runs first in `npm run build:pages`, and in `--check` mode inside `prebuild`,
 * so a pull request that adds a malformed skill fails the build instead of
 * reaching /skills/community. The validation rules live in
 * community-skills/tools/registry.mjs, the same module the public mirror's
 * contributors run as `node tools/validate.mjs`, so the verdict cannot differ
 * between the two repositories.
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.includes('--check') ? ['--check'] : [];
const r = spawnSync(process.execPath, [resolve(root, 'community-skills/tools/validate.mjs'), ...args], {
	stdio: 'inherit',
});
process.exit(r.status ?? 1);
