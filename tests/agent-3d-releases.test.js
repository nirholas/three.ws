// The <agent-3d> release ledger and the SRI pins that depend on it.
//
// /agent-3d/<version>/ is served `immutable` and embedders pin it with an
// integrity hash. Until 2026-10-01 its bytes were rebuilt on every deploy while
// the version stayed 1.5.2, so the documented pin (sha384-qCG5gH4...) no longer
// matched the served file (sha384-KdAiFR...) and browsers refused to run it.
// These tests pin the three things that stop that recurring: the pin finder
// sees every pinned tag, the checker flags and rewrites a stale pin, and the
// archive fetch refuses bytes that do not match the ledger. The last block runs
// the real check over this repo's docs, so a stale pin fails `npm test` before
// it ever reaches a build.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
	RELEASE_FILES,
	checkPins,
	fetchReleaseFile,
	findPins,
	readLedger,
	releasedVersions,
	sri,
} from '../scripts/lib/agent-3d-releases.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const GOOD = 'sha384-KdAiFRsdcCbQMu4O5rkoL8hOEYLkmrdpf9ELd7jro+9NTNipWis3oqqFLll7v20Q';
const STALE = 'sha384-qCG5gH4q2+k2Gsf98zs9RFXyN8iezoklCWt63pA2Xk2YF7Onae4rfUwu+oZSqRzN';

const ledgerWith = (integrity) => ({
	archive: 'https://storage.googleapis.com/example/agent-3d',
	releases: { '1.5.2': { integrity: { 'agent-3d.js': integrity, 'agent-3d.umd.cjs': integrity } } },
});

describe('findPins', () => {
	it('finds a multi-line pinned tag in any attribute order', () => {
		const text = [
			'<script',
			'  integrity="' + STALE + '"',
			'  type="module"',
			'  src="https://three.ws/agent-3d/1.5.2/agent-3d.js"',
			'  crossorigin="anonymous"',
			'></script>',
		].join('\n');
		const [pin] = findPins(text);
		expect(pin).toMatchObject({ version: '1.5.2', file: 'agent-3d.js', integrity: STALE, line: 2 });
		expect(text.slice(pin.start, pin.end)).toBe(STALE);
	});

	it('ignores placeholders, moving channels and tags without integrity', () => {
		const text = [
			'<script type="module" src="https://three.ws/agent-3d/1.5.2/agent-3d.js" integrity="sha384-…"></script>',
			'<script type="module" src="https://three.ws/agent-3d/latest/agent-3d.js" integrity="' + GOOD + '"></script>',
			'<script type="module" src="https://three.ws/agent-3d/1.5.2/agent-3d.js"></script>',
		].join('\n');
		expect(findPins(text)).toEqual([]);
	});
});

describe('checkPins', () => {
	let dir;
	beforeAll(() => {
		dir = mkdtempSync(join(tmpdir(), 'sri-pins-'));
		mkdirSync(join(dir, 'docs'));
	});
	afterAll(() => rmSync(dir, { recursive: true, force: true }));

	const doc = (integrity, version = '1.5.2') =>
		`# Embed\n\n<script type="module" src="https://three.ws/agent-3d/${version}/agent-3d.js" integrity="${integrity}" crossorigin="anonymous"></script>\n`;

	it('flags a pin whose hash is not the released hash', () => {
		writeFileSync(join(dir, 'docs', 'a.md'), doc(STALE));
		const r = checkPins(dir, ledgerWith(GOOD), { roots: ['docs'] });
		expect(r.checked).toBe(1);
		expect(r.problems).toHaveLength(1);
		expect(r.problems[0]).toMatchObject({ file: join('docs', 'a.md'), line: 3 });
		expect(r.problems[0].message).toMatch(/browsers will refuse it/);
	});

	it('rewrites the stale hash from the ledger with fix', () => {
		writeFileSync(join(dir, 'docs', 'a.md'), doc(STALE));
		const r = checkPins(dir, ledgerWith(GOOD), { fix: true, roots: ['docs'] });
		expect(r.fixed).toBe(1);
		expect(r.problems).toEqual([]);
		expect(readFileSync(join(dir, 'docs', 'a.md'), 'utf8')).toBe(doc(GOOD));
	});

	it('cannot fix a pin on a version that was never released', () => {
		writeFileSync(join(dir, 'docs', 'a.md'), doc(GOOD, '9.9.9'));
		const r = checkPins(dir, ledgerWith(GOOD), { fix: true, roots: ['docs'] });
		expect(r.fixed).toBe(0);
		expect(r.problems[0].message).toMatch(/9\.9\.9, which .* has never released/);
	});
});

describe('fetchReleaseFile', () => {
	let server;
	let origin;
	let served;
	let cacheDir;
	beforeAll(async () => {
		server = createServer((req, res) => {
			res.end(served);
		});
		await new Promise((r) => server.listen(0, '127.0.0.1', r));
		origin = `http://127.0.0.1:${server.address().port}`;
		cacheDir = mkdtempSync(join(tmpdir(), 'release-cache-'));
	});
	afterAll(() => {
		server.close();
		rmSync(cacheDir, { recursive: true, force: true });
	});

	const ledgerAt = (integrity) => ({ ...ledgerWith(integrity), archive: `${origin}/agent-3d` });

	it('returns archived bytes that match the ledger and caches them', async () => {
		served = Buffer.from('export const released = true;\n');
		const bytes = await fetchReleaseFile(ledgerAt(sri(served)), '1.5.2', 'agent-3d.js', { cacheDir });
		expect(bytes.equals(served)).toBe(true);
		expect(readFileSync(join(cacheDir, '1.5.2', 'agent-3d.js')).equals(served)).toBe(true);
	});

	it('refuses archived bytes that do not match the ledger', async () => {
		const released = Buffer.from('export const released = true;\n');
		served = Buffer.from('export const released = "altered";\n');
		await expect(fetchReleaseFile(ledgerAt(sri(released)), '1.5.2', 'agent-3d.umd.cjs')).rejects.toThrow(
			/refusing to publish altered bytes/,
		);
	});

	it('refetches instead of trusting a corrupt cache entry', async () => {
		served = Buffer.from('export const fresh = 1;\n');
		mkdirSync(join(cacheDir, '1.5.2'), { recursive: true });
		writeFileSync(join(cacheDir, '1.5.2', 'agent-3d.umd.cjs'), 'corrupt');
		const bytes = await fetchReleaseFile(ledgerAt(sri(served)), '1.5.2', 'agent-3d.umd.cjs', { cacheDir });
		expect(bytes.equals(served)).toBe(true);
	});
});

describe('this repo', () => {
	const ledger = readLedger(ROOT);

	it('records both files of every release as sha384 SRI', () => {
		const versions = releasedVersions(ledger);
		expect(versions.length).toBeGreaterThan(0);
		for (const v of versions) {
			for (const f of RELEASE_FILES) expect(ledger.releases[v].integrity[f]).toMatch(/^sha384-[A-Za-z0-9+/]{64}$/);
		}
		expect(ledger.archive).toMatch(/^https:\/\/storage\.googleapis\.com\//);
	});

	it('has released the version package.json declares', () => {
		const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
		expect(Object.keys(ledger.releases)).toContain(version);
	});

	it('pins every documented agent-3d SRI hash to its released bytes', () => {
		const { problems, checked } = checkPins(ROOT, ledger);
		expect(problems).toEqual([]);
		expect(checked).toBeGreaterThan(0);
	});
});
