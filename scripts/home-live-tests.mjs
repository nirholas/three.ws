#!/usr/bin/env node
/**
 * The home lane's live tier, in one command.
 *
 *   npm run test:home:live
 *
 * Nine test files in this lane assert against a real Home Assistant, and each
 * of them used to carry its own paragraph of setup: a house to build, a flag to
 * export, a key to invent. The result was that most of them skipped on most
 * machines and nobody noticed, which is the same as not having them. This
 * runner supplies everything they need and then runs them together.
 *
 * What it supplies, and why each one is needed:
 *
 *   HOME_LIVE=1                  lets tests/_helpers/home-instance.js build the
 *                                shared house through scripts/home-test-instance.mjs.
 *   HOME_ALLOW_LOCAL_INSTANCE=1  the seam in api/_lib/home-url-guard.js. A Home
 *                                Assistant you run yourself lands on loopback,
 *                                and the reachability guard refuses loopback in
 *                                production. The guard reads this at module
 *                                load, which is why it is set here rather than
 *                                inside a test.
 *   WALLET_ENCRYPTION_KEY        encrypts the throwaway rows this run creates.
 *   JWT_SECRET                   signs the sessions the HTTP tiers mint.
 *
 * The two secrets are generated per run when the environment has none, exactly
 * as playwright.home.config.js does: they are local only, they encrypt rows
 * this run writes and deletes, and nothing production wrote can be read with
 * them. A real value already in the environment always wins.
 *
 * The house outlives the run on purpose, so a second run costs no boot:
 *
 *   node scripts/home-test-instance.mjs --down --name lane
 */

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Every file in the lane that asserts against a real house. Derived, not
 * curated: a file earns its place here by importing the shared harness helper,
 * so a new live test cannot be added and then quietly left out of the suite.
 */
function liveTestFiles() {
	const roots = ['tests', path.join('packages', 'home-bridge', 'tests'), path.join('packages', 'home-mcp', 'tests')];
	const found = [];
	for (const dir of roots) {
		const abs = path.join(ROOT, dir);
		if (!fs.existsSync(abs)) continue;
		for (const name of fs.readdirSync(abs)) {
			if (!name.endsWith('.test.js')) continue;
			const rel = path.join(dir, name);
			if (fs.readFileSync(path.join(ROOT, rel), 'utf8').includes('_helpers/home-instance.js')) found.push(rel);
		}
	}
	return found.sort();
}

const files = liveTestFiles();
if (!files.length) {
	console.error('No live home tests found: nothing imports tests/_helpers/home-instance.js.');
	process.exit(1);
}

const env = { ...process.env, HOME_LIVE: '1', HOME_ALLOW_LOCAL_INSTANCE: '1' };
env.WALLET_ENCRYPTION_KEY ||= randomBytes(32).toString('hex');
env.JWT_SECRET ||= randomBytes(32).toString('hex');

// .env.local carries DATABASE_URL. The database tiers skip without it rather
// than failing, so a machine that has no database still runs the bridge tier.
const envFile = path.join(ROOT, '.env.local');
const nodeArgs = fs.existsSync(envFile) ? [`--env-file=${envFile}`] : [];
if (!nodeArgs.length) console.error('No .env.local: the database tiers will skip themselves.');

const args = [
	...nodeArgs,
	path.join(ROOT, 'node_modules', 'vitest', 'vitest.mjs'),
	'run',
	// One worker. These files share one Home Assistant container and one
	// database, and two forks racing to lock and unlock the same front door is
	// the flakiness this lane refuses to ship.
	'--maxWorkers=1',
	...files,
	...process.argv.slice(2),
];

console.error(`home live tier: ${files.length} files, one shared house\n`);
const child = spawn(process.execPath, args, { cwd: ROOT, stdio: 'inherit', env });
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
