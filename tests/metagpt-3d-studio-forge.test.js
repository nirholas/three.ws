// The MetaGPT example's generation leg is Python (examples/metagpt-3d-studio/main.py),
// and its unit tests are Python too: examples/metagpt-3d-studio/tests/test_forge.py,
// standard library only, no network. This runs them from `npm test` so the fix for
// the 2026-11-27 failure (a busy generator ended the run instead of starting a new
// generation, and the wait ended while a job was still rendering) stays pinned.

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const exampleDir = join(process.cwd(), 'examples/metagpt-3d-studio');
// main.py uses `str | None` at runtime, so the tests need Python 3.10 or newer.
const hasPython = spawnSync('python3', ['-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'], { stdio: 'ignore' }).status === 0;

describe('examples/metagpt-3d-studio Studio.forge', () => {
	it.skipIf(!hasPython)('passes its Python unit tests', () => {
		const run = spawnSync('python3', ['-B', '-m', 'unittest', 'discover', '-s', 'tests', '-v'], { cwd: exampleDir, encoding: 'utf8', timeout: 60_000 });
		const report = `${run.stdout}${run.stderr}`;
		expect(run.status, report).toBe(0);
		expect(report).toMatch(/Ran [1-9]\d* tests?/);
		expect(report).toContain('test_busy_generator_gets_a_new_generation_with_a_new_key');
	});
});
