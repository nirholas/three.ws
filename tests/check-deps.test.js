// Requirement parsing for the OSV dependency scan (scripts/check-deps.mjs).
//
// The scan is only as good as what it can read out of a requirements file, and
// these files are not a simple list: they carry pip flags, extras, environment
// markers, inline comments, direct URLs, and CUDA-built wheels with a PEP 440
// local version. Every case below is taken from a real file in workers/.
//
// The failure this guards against is silent: a parser that drops a line reports
// "no known vulnerabilities" for a package it never looked at, which is worse
// than not scanning at all.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseRequirements, publicVersion } from '../scripts/check-deps.mjs';

describe('parseRequirements', () => {
	it('reads a plain pin', () => {
		const { pinned } = parseRequirements('fastapi==0.115.5\n');
		expect(pinned).toEqual([{ name: 'fastapi', version: '0.115.5' }]);
	});

	it('reads a pin that carries extras', () => {
		const { pinned } = parseRequirements('uvicorn[standard]==0.32.1\n');
		expect(pinned).toEqual([{ name: 'uvicorn', version: '0.32.1' }]);
	});

	it('keeps the pin when an environment marker follows it', () => {
		const { pinned } = parseRequirements('numpy==1.26.4 ; python_version < "3.13"\n');
		expect(pinned).toEqual([{ name: 'numpy', version: '1.26.4' }]);
	});

	it('strips an inline comment', () => {
		const { pinned } = parseRequirements('Pillow==11.0.0  # pinned for the ONNX runtime\n');
		expect(pinned).toEqual([{ name: 'Pillow', version: '11.0.0' }]);
	});

	it('ignores comments and blank lines', () => {
		const { pinned, unpinned } = parseRequirements('# CPU only, see the Dockerfile\n\n\nonnxruntime==1.28.0\n');
		expect(pinned).toEqual([{ name: 'onnxruntime', version: '1.28.0' }]);
		expect(unpinned).toEqual([]);
	});

	it('ignores pip flags, which are not packages', () => {
		const text = [
			'-f https://data.pyg.org/whl/torch-2.1.2+cu121.html',
			'--extra-index-url https://miropsota.github.io/torch_packages_builder',
			'-r base.txt',
			'trimesh==4.5.3',
		].join('\n');
		const { pinned } = parseRequirements(text);
		expect(pinned).toEqual([{ name: 'trimesh', version: '4.5.3' }]);
	});

	it('ignores a direct URL or VCS reference, which OSV cannot resolve', () => {
		const text = [
			'https://example.invalid/wheels/custom-1.0-py3-none-any.whl',
			'thing @ git+https://github.com/example/thing@abc123',
			'einops==0.8.0',
		].join('\n');
		const { pinned } = parseRequirements(text);
		expect(pinned).toEqual([{ name: 'einops', version: '0.8.0' }]);
	});

	it('separates the specs it cannot scan rather than dropping them', () => {
		const { pinned, unpinned } = parseRequirements('gradio>=5.25.0\nnumpy~=1.26.4\ntimm\nbpy==4.3.0\n');
		expect(pinned).toEqual([{ name: 'bpy', version: '4.3.0' }]);
		expect(unpinned.map((u) => u.name)).toEqual(['gradio', 'numpy', 'timm']);
		// A bare name still reports something a reader can act on.
		expect(unpinned.find((u) => u.name === 'timm').spec).toBe('(any version)');
	});

	it('keeps a locally built wheel as pinned, local segment intact', () => {
		const { pinned } = parseRequirements('torch-cluster==1.6.3+pt21cu121\n');
		expect(pinned).toEqual([{ name: 'torch-cluster', version: '1.6.3+pt21cu121' }]);
	});
});

describe('publicVersion', () => {
	it('leaves an ordinary version alone', () => {
		expect(publicVersion('2.3.1')).toBe('2.3.1');
	});

	// OSV indexes upstream releases. A local version segment is our build, not an
	// upstream release, so querying it verbatim finds nothing and would report a
	// CUDA-built torch as clean when the upstream release it came from is not.
	it('drops the local build segment before the query', () => {
		expect(publicVersion('1.6.3+pt21cu121')).toBe('1.6.3');
		expect(publicVersion('0.7.7+pt2.1.2cu121')).toBe('0.7.7');
	});
});

describe('the real requirements files', () => {
	const roots = ['workers', 'services', 'packages'];
	const files = [];
	for (const dir of roots) {
		if (!existsSync(dir)) continue;
		for (const entry of readdirSync(dir)) {
			const child = join(dir, entry);
			if (!statSync(child).isDirectory()) continue;
			for (const name of readdirSync(child)) {
				if (/^requirements.*\.txt$/.test(name)) files.push(join(child, name));
			}
		}
	}

	it('finds requirements files to scan at all', () => {
		expect(files.length).toBeGreaterThan(0);
	});

	// Not a style rule: a line the parser classifies as neither pinned nor
	// unpinned is a package nobody is looking at, and it fails silently.
	it('classifies every requirement line in the tree', () => {
		const unaccounted = [];
		for (const file of files) {
			const text = readFileSync(file, 'utf8');
			const { pinned, unpinned } = parseRequirements(text);
			const seen = new Set([...pinned.map((p) => p.name.toLowerCase()), ...unpinned.map((u) => u.name.toLowerCase())]);
			for (const raw of text.split('\n')) {
				const line = raw.trim();
				if (!line || line.startsWith('#') || line.startsWith('-')) continue;
				if (/^[a-z+]+:\/\//i.test(line) || line.includes('@')) continue;
				const name = line.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)/)?.[1];
				if (name && !seen.has(name.toLowerCase())) unaccounted.push(`${file}: ${line}`);
			}
		}
		expect(unaccounted).toEqual([]);
	});

	it('reads a version for the packages the image-handling workers pin', () => {
		const rembg = files.find((f) => f.includes(join('workers', 'rembg')));
		expect(rembg).toBeTruthy();
		const { pinned } = parseRequirements(readFileSync(rembg, 'utf8'));
		const names = pinned.map((p) => p.name.toLowerCase());
		expect(names).toContain('pillow');
		expect(names).toContain('rembg');
		expect(names).toContain('onnxruntime');
	});
});
