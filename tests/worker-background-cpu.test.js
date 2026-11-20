// A worker that answers 202 Accepted and finishes the job in the background has
// to deploy with --no-cpu-throttling. Cloud Run's default request-based CPU
// allocation throttles the container to almost nothing whenever no request is
// in flight, so the inference that runs after the 202 only gets CPU during the
// caller's short poll requests. rembg-service shipped without the flag: a
// birefnet cutout that takes 6 s on 4 threads sat at "running" for minutes, and
// every TripoSG image-to-3D job failed with "matte did not finish within 120 s"
// (production, 2026-11-20). segment-service had the same gap.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const WORKERS = join(import.meta.dirname, '..', 'workers');

function answersAcceptedThenWorks(dir) {
	return readdirSync(dir)
		.filter((f) => f.endsWith('.py') && !f.startsWith('test_'))
		.some((f) => /status_code\s*=\s*202/.test(readFileSync(join(dir, f), 'utf8')));
}

function deployConfigs(dir) {
	return readdirSync(dir)
		.filter((f) => /^cloudbuild.*\.ya?ml$/.test(f))
		.filter((f) => {
			const text = readFileSync(join(dir, f), 'utf8');
			return /^\s*-\s*run\s*$/m.test(text) && /^\s*-\s*deploy\s*$/m.test(text);
		});
}

const cases = readdirSync(WORKERS)
	.map((name) => ({ name, dir: join(WORKERS, name) }))
	.filter(({ dir }) => statSync(dir).isDirectory() && answersAcceptedThenWorks(dir))
	.flatMap(({ name, dir }) => deployConfigs(dir).map((file) => ({ name, file, path: join(dir, file) })));

describe('background-task workers keep CPU between requests', () => {
	it('finds the background-task deploy configs it guards', () => {
		const names = cases.map((c) => `${c.name}/${c.file}`);
		expect(names).toContain('rembg/cloudbuild.yaml');
		expect(names).toContain('segment/cloudbuild.yaml');
	});

	it.each(cases)('$name/$file deploys with --no-cpu-throttling', ({ path }) => {
		expect(existsSync(path)).toBe(true);
		expect(readFileSync(path, 'utf8')).toMatch(/^\s*-\s*--no-cpu-throttling\s*$/m);
	});
});
