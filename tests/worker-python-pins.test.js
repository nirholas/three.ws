// Every Python worker pins its dependencies in requirements.txt and picks its
// interpreter in its Dockerfile. A pin whose release needs a newer Python than
// the image ships fails `pip install` at image build time, after the deploy has
// already started. Dependabot does not read the Dockerfile, so its bumps can
// land exactly that mismatch (Pillow 13.0.0 into a Python 3.10 worker,
// 2026-11-04). This test reads both files for every worker and refuses a pin
// above the interpreter's ceiling.

import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const WORKERS = join(import.meta.dirname, '..', 'workers');

// Minimum Python of a release line, from each release's PyPI `requires_python`.
// Add a row when a pinned package raises its floor above 3.10.
const PYTHON_FLOORS = {
	pillow: [{ from: [13, 0, 0], python: [3, 11] }], // Pillow 13.0.0: requires_python >=3.11
};

const parseVersion = (v) => v.split('.').map((n) => Number.parseInt(n, 10) || 0);

const compare = (a, b) => {
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const d = (a[i] ?? 0) - (b[i] ?? 0);
		if (d) return Math.sign(d);
	}
	return 0;
};

/** The interpreter a worker image runs, e.g. [3, 10], or null when it has none. */
function dockerPython(dir) {
	const files = readdirSync(dir).filter((f) => /^Dockerfile/.test(f));
	for (const f of files) {
		const m = readFileSync(join(dir, f), 'utf8').match(/python:?(3)\.(\d+)/);
		if (m) return [Number(m[1]), Number(m[2])];
	}
	return null;
}

/** Exact `name==version` pins, keyed by lowercased package name. */
function exactPins(file) {
	const pins = new Map();
	for (const raw of readFileSync(file, 'utf8').split('\n')) {
		const m = raw.replace(/#.*/, '').trim().match(/^([A-Za-z0-9_.-]+)(?:\[[^\]]*\])?==([0-9][0-9.]*)/);
		if (m) pins.set(m[1].toLowerCase(), m[2]);
	}
	return pins;
}

const workers = readdirSync(WORKERS, { withFileTypes: true })
	.filter((d) => d.isDirectory() && existsSync(join(WORKERS, d.name, 'requirements.txt')))
	.map((d) => {
		const dir = join(WORKERS, d.name);
		return { name: d.name, python: dockerPython(dir), pins: exactPins(join(dir, 'requirements.txt')) };
	})
	.filter((w) => w.python);

describe('worker Python pins fit the worker image', () => {
	it('finds the Python workers it is meant to guard', () => {
		expect(workers.length).toBeGreaterThan(10);
		expect(workers.map((w) => w.name)).toContain('avatar-reconstruction');
	});

	it.each(workers.map((w) => [w.name, w]))('%s pins nothing that needs a newer Python', (_name, w) => {
		const tooNew = [];
		for (const [pkg, floors] of Object.entries(PYTHON_FLOORS)) {
			const pinned = w.pins.get(pkg);
			if (!pinned) continue;
			for (const floor of floors) {
				if (compare(parseVersion(pinned), floor.from) >= 0 && compare(w.python, floor.python) < 0) {
					tooNew.push(`${pkg}==${pinned} needs Python ${floor.python.join('.')}, image has ${w.python.join('.')}`);
				}
			}
		}
		expect(tooNew).toEqual([]);
	});
});
