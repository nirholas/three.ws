/**
 * avatar-reconstruction images: does each Dockerfile carry every module the
 * service and its build-time gates import, and does the GPU image precompute the
 * same templates as the CPU image?
 *
 * Both Dockerfiles COPY Python modules one by one, so a new module has to be
 * added to each by hand. This already went wrong: recon_templates.py (the
 * template registry face_pipeline, main and precompute_uv import) was added to
 * Dockerfile but not to Dockerfile.rtx, and Dockerfile.rtx still precomputed
 * only the Wolf3D UV map. Every RTX Cloud Build after that failed at
 * `precompute_uv.py` with "No module named 'recon_templates'", so the dense-fit
 * GPU service could not be rebuilt from main.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKER = join(ROOT, 'workers', 'avatar-reconstruction');
const DOCKERFILES = ['Dockerfile', 'Dockerfile.rtx'];

const LOCAL_MODULES = new Set(
	readdirSync(WORKER)
		.filter((n) => n.endsWith('.py'))
		.map((n) => n.slice(0, -3)),
);

/** Local modules a Python file imports, including imports inside functions. */
function localImports(module) {
	const src = readFileSync(join(WORKER, `${module}.py`), 'utf8');
	const found = new Set();
	for (const line of src.split('\n')) {
		const from = line.match(/^\s*from\s+([A-Za-z_][\w]*)\s+import\s/);
		if (from && LOCAL_MODULES.has(from[1])) found.add(from[1]);
		const imp = line.match(/^\s*import\s+(.+)$/);
		if (imp) {
			for (const part of imp[1].split(',')) {
				const name = part.trim().split(/\s+/)[0].split('.')[0];
				if (LOCAL_MODULES.has(name)) found.add(name);
			}
		}
	}
	return found;
}

/** Transitive closure of local imports from the given roots. */
function closure(roots) {
	const seen = new Set();
	const queue = [...roots];
	while (queue.length) {
		const m = queue.pop();
		if (seen.has(m)) continue;
		seen.add(m);
		for (const dep of localImports(m)) queue.push(dep);
	}
	return seen;
}

function parse(name) {
	const text = readFileSync(join(WORKER, name), 'utf8').replace(/\\\n/g, ' ');
	const lines = text.split('\n');
	const copied = new Set();
	const runScripts = new Set();
	const templates = new Set();
	for (const line of lines) {
		const copy = line.match(/^COPY\s+(\S+\.py)\s+/);
		if (copy) copied.add(copy[1].replace(/\.py$/, ''));
		if (!line.startsWith('RUN ')) continue;
		for (const m of line.matchAll(/\/app\/([\w]+)\.py/g)) runScripts.add(m[1]);
		for (const m of line.matchAll(/precompute_uv\.py\s+--template\s+(\w+)/g)) templates.add(m[1]);
	}
	return { copied, runScripts, templates };
}

describe('avatar-reconstruction Dockerfiles', () => {
	for (const name of DOCKERFILES) {
		describe(name, () => {
			const df = parse(name);

			it('copies every local module the server and its build gates import', () => {
				const roots = ['main', ...df.runScripts].filter((m) => LOCAL_MODULES.has(m));
				const needed = [...closure(roots)].sort();
				const missing = needed.filter((m) => !df.copied.has(m));
				expect(missing, `${name} is missing COPY lines for these modules`).toEqual([]);
			});

			it('only runs scripts it copied', () => {
				const missing = [...df.runScripts].filter((m) => !df.copied.has(m));
				expect(missing).toEqual([]);
			});
		});
	}

	it('the GPU image precomputes the same template UV maps as the CPU image', () => {
		const cpu = parse('Dockerfile');
		const rtx = parse('Dockerfile.rtx');
		expect(cpu.templates.size).toBeGreaterThan(0);
		expect([...rtx.templates].sort()).toEqual([...cpu.templates].sort());
	});

	it('the GPU image runs every build-time test the CPU image runs', () => {
		const cpu = parse('Dockerfile');
		const rtx = parse('Dockerfile.rtx');
		const gates = [...cpu.runScripts].filter((m) => m.startsWith('test_') || m === 'smoke_test');
		const missing = gates.filter((m) => !rtx.runScripts.has(m));
		expect(missing).toEqual([]);
	});

	it('every template the images precompute ships in templates/', () => {
		const src = readFileSync(join(WORKER, 'recon_templates.py'), 'utf8');
		for (const key of parse('Dockerfile').templates) {
			expect(src.includes(`"${key}"`), `recon_templates.py has no "${key}" template`).toBe(true);
		}
		expect(existsSync(join(WORKER, 'templates', 'default.glb'))).toBe(true);
		expect(existsSync(join(WORKER, 'templates', 'parametric.glb'))).toBe(true);
	});
});
