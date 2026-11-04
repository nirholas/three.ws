import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '..');
const SCRIPT = join(REPO, 'scripts', 'export-hacs-repo.mjs');
const INTEGRATION = join(REPO, 'home-assistant-integration', 'custom_components', 'three_ws');

function walk(dir) {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? walk(path) : [path];
	});
}

describe('scripts/export-hacs-repo.mjs', () => {
	let out;
	let files;
	const strayCache = join(INTEGRATION, '__pycache__');
	const strayFile = join(strayCache, 'export_test_probe.cpython-312.pyc');
	let createdCache = false;

	beforeAll(() => {
		// A local Python run leaves bytecode next to the integration; the export must never ship it.
		if (!existsSync(strayCache)) {
			mkdirSync(strayCache);
			createdCache = true;
		}
		writeFileSync(strayFile, 'bytecode');
		out = mkdtempSync(join(tmpdir(), 'hacs-export-'));
		execFileSync(process.execPath, [SCRIPT, '--out', out], { stdio: 'pipe' });
		files = walk(out).map((f) => relative(out, f).split('\\').join('/'));
	});

	afterAll(() => {
		rmSync(out, { recursive: true, force: true });
		rmSync(strayFile, { force: true });
		if (createdCache) rmSync(strayCache, { recursive: true, force: true });
	});

	it('ships no Python bytecode or __pycache__ directories', () => {
		expect(files.filter((f) => f.includes('__pycache__') || /\.py[cod]$/.test(f))).toEqual([]);
	});

	it('ships the HACS repository layout with the local brand icons and both validation workflows', () => {
		for (const f of [
			'hacs.json',
			'README.md',
			'LICENSE',
			'custom_components/three_ws/manifest.json',
			'custom_components/three_ws/brand/icon.png',
			'custom_components/three_ws/brand/icon@2x.png',
			'custom_components/three_ws/brand/dark_icon.png',
			'custom_components/three_ws/brand/dark_icon@2x.png',
			'.github/workflows/hassfest.yml',
			'.github/workflows/hacs.yml',
		]) {
			expect(files).toContain(f);
		}
	});

	it('keeps the manifest version and the HACS minimum Home Assistant version in the exported tree', () => {
		const manifest = JSON.parse(readFileSync(join(out, 'custom_components/three_ws/manifest.json'), 'utf8'));
		const hacs = JSON.parse(readFileSync(join(out, 'hacs.json'), 'utf8'));
		expect(manifest.domain).toBe('three_ws');
		expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
		expect(hacs.name).toBe('three.ws');
		expect(hacs.homeassistant).toMatch(/^\d{4}\.\d+\.\d+$/);
	});
});
