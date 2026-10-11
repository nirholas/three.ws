// Terminal command language, Task Manager maths and Media Player queue logic.
// The terminal runs against an in-memory file system that implements the same
// API as src/desktop/os/fs.js (whose path helpers are used as-is).
import { describe, it, expect, beforeEach } from 'vitest';
import * as realFs from '../src/desktop/os/fs.js';
import { parseLine, runLine, createEnv, complete, suggest, editDistance, commonPrefix, formatBytes as tBytes } from '../src/desktop/os/apps/term-commands.js';
import * as perf from '../src/desktop/os/apps/perf-logic.js';
import * as pl from '../src/desktop/os/apps/playlist-logic.js';

function memFs() {
	const nodes = new Map();
	const dir = (path) => ({ path, name: realFs.nameOf(path), parent: realFs.parentOf(path), type: 'dir', size: 0, mtime: 1 });
	for (const d of ['/', '/Documents', '/Music', '/Trash']) nodes.set(d, dir(d));
	const meta = ({ data, ...n }) => n;
	return {
		normalize: realFs.normalize, join: realFs.join, nameOf: realFs.nameOf, parentOf: realFs.parentOf, kindOf: realFs.kindOf,
		async stat(p) {
			p = realFs.normalize(p);
			return nodes.has(p) ? meta(nodes.get(p)) : null;
		},
		async list(p) {
			p = realFs.normalize(p);
			return [...nodes.values()].filter((n) => n.path !== '/' && n.parent === (p === '/' ? '' : p) || (n.path !== '/' && realFs.parentOf(n.path) === p)).map(meta).sort((a, b) => a.name.localeCompare(b.name));
		},
		async read(p) {
			const n = nodes.get(realFs.normalize(p));
			return n && n.type === 'file' ? { node: meta(n), blob: new Blob([n.data]) } : null;
		},
		async readText(p) {
			return nodes.get(realFs.normalize(p))?.data ?? null;
		},
		async write(p, data) {
			p = realFs.normalize(p);
			if (!nodes.has(realFs.parentOf(p))) throw new Error(`Folder not found: ${realFs.parentOf(p)}`);
			const text = typeof data === 'string' ? data : await data.text();
			nodes.set(p, { path: p, name: realFs.nameOf(p), parent: realFs.parentOf(p), type: 'file', size: text.length, mtime: 2, data: text });
		},
		async mkdir(p) {
			p = realFs.normalize(p);
			if (nodes.has(p)) throw new Error('Something with that name already exists');
			nodes.set(p, dir(p));
		},
		async move(a, b) {
			a = realFs.normalize(a);
			b = realFs.normalize(b);
			const n = nodes.get(a);
			if (!n) throw new Error('Source not found');
			nodes.delete(a);
			nodes.set(b, { ...n, path: b, name: realFs.nameOf(b), parent: realFs.parentOf(b) });
		},
		async copy(a, b) {
			const n = nodes.get(realFs.normalize(a));
			if (!n) throw new Error('Source not found');
			b = realFs.normalize(b);
			nodes.set(b, { ...n, path: b, name: realFs.nameOf(b), parent: realFs.parentOf(b) });
		},
		async remove(p) {
			p = realFs.normalize(p);
			const n = nodes.get(p);
			nodes.delete(p);
			const t = `/Trash/${n.name}`;
			nodes.set(t, { ...n, path: t, parent: '/Trash' });
			return t;
		},
		async walk(p) {
			p = realFs.normalize(p);
			return [...nodes.values()].filter((n) => n.path !== p && (p === '/' ? n.path !== '/' : n.path.startsWith(`${p}/`))).map(meta);
		},
		_nodes: nodes,
	};
}

const res = (body, ok = true, status = 200) => ({ ok, status, statusText: ok ? 'OK' : 'Err', headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

let env;
let fetched;
const sh = async (line) => {
	const r = await runLine(line, env);
	return { text: r.out.text(), code: r.code, r };
};

beforeEach(() => {
	fetched = [];
	let t = 0;
	const routes = {
		'/api/three-token/stats': { token: { price_usd: 0.00123, price_change_24h: -4.5, market_cap: 1230000, volume_24h: 5000, holders: 321 } },
		'/api/agents/public': { agents: [{ name: 'Nova', description: 'First' }, { name: 'Atlas', description: 'Second' }] },
		'/api/pump/launches': { data: { launches: [{ symbol: 'ABC', name: 'Alpha Coin', mint: 'So11111111111111111111111111111111111111112' }] } },
	};
	env = createEnv({
		fs: memFs(),
		fetch: async (url) => {
			fetched.push(String(url));
			const u = new URL(url);
			if (u.host === 'geocoding-api.open-meteo.com') return res({ results: [{ name: 'Paris', country: 'France', latitude: 1, longitude: 2 }] });
			if (u.host === 'api.open-meteo.com') return res({ current: { temperature_2m: 12, apparent_temperature: 10, relative_humidity_2m: 70, wind_speed_10m: 9, weather_code: 3 }, current_units: { temperature_2m: 'C', wind_speed_10m: 'km/h' }, daily: { time: ['2026-01-01'], temperature_2m_min: [5], temperature_2m_max: [13], weather_code: [61] } });
			if (u.pathname in routes) return res(routes[u.pathname]);
			if (u.pathname === '/boom') throw new TypeError('Failed to fetch');
			return res({ error: 'nope' }, false, 404);
		},
		perfNow: () => (t += 25),
		host: { userName: () => 'sam', apps: [{ id: 'notepad', title: 'Notepad' }], launchId: (id, o) => env.launched.push([id, o]), openPath: async (p) => env.launched.push(['open', p]), windows: () => [{ id: 'files', title: 'File Explorer' }], closeWindow: (id) => env.closed.push(id), setTheme: (m) => (env.theme = m), uptimeMs: () => 65000, sysinfo: () => ({ cores: 8, gpu: 'Test GPU', browser: 'Chrome 140' }) },
		baseUrl: 'https://three.ws/',
	});
	env.launched = [];
	env.closed = [];
});

describe('parseLine', () => {
	it('splits words, quotes, pipes and redirects', () => {
		expect(parseLine('echo "a b" c')).toEqual([{ argv: ['echo', 'a b', 'c'], redirect: null }]);
		expect(parseLine('cat f | grep x | wc -l').map((s) => s.argv[0])).toEqual(['cat', 'grep', 'wc']);
		expect(parseLine('echo hi >> out.txt')[0].redirect).toEqual({ mode: 'append', target: 'out.txt' });
		expect(parseLine("echo 'a | b'")[0].argv).toEqual(['echo', 'a | b']);
	});
	it('rejects broken syntax', () => {
		expect(() => parseLine('echo "oops')).toThrow(/quote/);
		expect(() => parseLine('ls |')).toThrow(/empty/);
		expect(() => parseLine('echo >')).toThrow(/file name/);
	});
});

describe('terminal on the file system', () => {
	it('echo redirect writes and appends, cat reads', async () => {
		await sh('echo hello > /Documents/a.txt');
		await sh('echo world >> /Documents/a.txt');
		expect((await sh('cat /Documents/a.txt')).text).toBe('hello\nworld\n');
	});
	it('cd and pwd resolve relative paths', async () => {
		await sh('cd Documents');
		expect((await sh('pwd')).text).toBe('/Documents\n');
		await sh('cd ..');
		expect(env.cwd).toBe('/');
		expect((await sh('cd nowhere')).code).toBe(1);
	});
	it('ls -l lists names, sizes and folders', async () => {
		await sh('echo abc > /Documents/x.txt');
		const { text } = await sh('ls -l /Documents');
		expect(text).toMatch(/x\.txt/);
		expect(text).toMatch(/4 B/);
		expect((await sh('ls /')).text).toContain('Documents/');
	});
	it('mkdir, touch, cp, mv, rm move through the file system', async () => {
		await sh('mkdir /Documents/sub');
		await sh('touch /Documents/sub/n.txt');
		await sh('cp /Documents/sub/n.txt /Documents/sub/m.txt');
		await sh('mv /Documents/sub/m.txt /Documents/k.txt');
		expect(await env.fs.stat('/Documents/k.txt')).toBeTruthy();
		const r = await sh('rm /Documents/sub');
		expect(r.code).toBe(1);
		expect((await sh('rm -r /Documents/sub')).code).toBe(0);
		expect(await env.fs.stat('/Trash/sub')).toBeTruthy();
	});
	it('pipes grep, head, tail and wc', async () => {
		await env.fs.write('/Documents/l.txt', 'one\ntwo\nthree\nfour\n');
		expect((await sh('cat /Documents/l.txt | grep o')).text).toBe('one\ntwo\nfour\n');
		expect((await sh('cat /Documents/l.txt | head -n 2')).text).toBe('one\ntwo\n');
		expect((await sh('tail -n 1 /Documents/l.txt')).text).toBe('four\n');
		expect((await sh('cat /Documents/l.txt | grep -v e | wc -l')).text.trim()).toBe('2');
		expect((await sh('grep -n thr /Documents/l.txt')).text).toBe('3:three\n');
	});
	it('find searches names and skips the Trash', async () => {
		await sh('echo x > /Documents/report.txt');
		await sh('rm /Documents/report.txt');
		await sh('echo x > /Documents/report2.txt');
		const { text } = await sh('find report');
		expect(text).toContain('/Documents/report2.txt');
		expect(text).not.toContain('/Trash');
	});
	it('open and edit call the desktop', async () => {
		await sh('echo x > /Documents/n.txt');
		await sh('open /Documents/n.txt');
		await sh('open notepad');
		await sh('edit /Documents/fresh.txt');
		expect(env.launched).toEqual([['open', '/Documents/n.txt'], ['notepad', undefined], ['notepad', { arg: '/Documents/fresh.txt' }]]);
		expect((await sh('open nothing')).code).toBe(1);
	});
	it('kill, theme, whoami, apps, history', async () => {
		expect((await sh('kill files')).text).toMatch(/Closed File Explorer/);
		expect(env.closed).toEqual(['files']);
		await sh('theme light');
		expect(env.theme).toBe('light');
		expect((await sh('theme purple')).code).toBe(1);
		expect((await sh('whoami')).text).toBe('sam\n');
		expect((await sh('apps')).text).toContain('notepad');
	});
	it('suggests the closest command for a typo', async () => {
		const r = await sh('lss');
		expect(r.code).toBe(127);
		expect(r.text).toContain('Did you mean "ls"');
		expect((await sh('zzzzzzzzzz')).text).toContain('Type help');
	});
	it('clear flags the screen', async () => {
		expect((await sh('clear')).r.cleared).toBe(true);
	});
});

describe('terminal network commands', () => {
	it('three price reads the real stats route', async () => {
		const { text } = await sh('three price');
		expect(fetched[0]).toBe('https://three.ws/api/three-token/stats');
		expect(text).toContain('$THREE');
		expect(text).toContain('-4.50% 24h');
	});
	it('three agents and launches use the real response shapes', async () => {
		expect((await sh('three agents 2')).text).toMatch(/Nova[\s\S]*Atlas/);
		expect(fetched[0]).toContain('/api/agents/public?limit=2');
		expect((await sh('three launches')).text).toMatch(/ABC\s+Alpha Coin\s+So1111\.\.\.1112/);
	});
	it('weather geocodes then forecasts', async () => {
		const { text } = await sh('weather Paris');
		expect(text).toContain('Paris');
		expect(text).toContain('Overcast');
		expect(fetched.some((u) => u.includes('api.open-meteo.com/v1/forecast'))).toBe(true);
	});
	it('curl prints status and body, and survives failure', async () => {
		const ok = await sh('curl /api/agents/public');
		expect(ok.text).toMatch(/^HTTP 200 OK/);
		const bad = await sh('curl /missing');
		expect(bad.code).toBe(22);
		const down = await sh('curl /boom');
		expect(down.code).toBe(7);
		expect(down.text).toMatch(/request failed/);
	});
	it('ping measures round trips', async () => {
		const { text, code } = await sh('ping');
		expect(code).toBe(0);
		expect(text).toMatch(/4 replies, min 25\.0 ms/);
	});
	it('reports an API failure instead of throwing', async () => {
		env.fetch = async () => res({}, false, 503);
		const r = await sh('three price');
		expect(r.code).toBe(1);
		expect(r.text).toMatch(/HTTP 503/);
	});
});

describe('completion and helpers', () => {
	it('completes commands and paths', async () => {
		expect((await complete('mkd', env)).matches).toEqual(['mkdir']);
		const r = await complete('cd Doc', env);
		expect(r.matches).toEqual(['Documents/']);
		expect(r.start).toBe(3);
		expect((await complete('ls | gr', env)).matches).toEqual(['grep']);
	});
	it('edit distance and suggestions', () => {
		expect(editDistance('kitten', 'sitting')).toBe(3);
		expect(suggest('hepl')).toBe('help');
		expect(commonPrefix(['abc', 'abd'])).toBe('ab');
		expect(tBytes(2048)).toBe('2.0 KB');
	});
});

describe('perf-logic', () => {
	it('ring buffer keeps the newest samples in order', () => {
		const b = new perf.RingBuffer(3);
		[1, 2, 3, 4].forEach((v) => b.push(v));
		expect(b.toArray()).toEqual([2, 3, 4]);
		expect(b.last()).toBe(4);
		expect(b.max()).toBe(4);
		const e = new perf.RingBuffer(3);
		e.push(null);
		expect(e.max()).toBe(0);
	});
	it('formats bytes, time and percentages', () => {
		expect(perf.formatBytes(1536)).toBe('1.50 KB');
		expect(perf.formatBytes(null)).toBe('n/a');
		expect(perf.formatMs(1500)).toBe('1.50 s');
		expect(perf.formatPct(0.256)).toBe('26%');
		expect(perf.formatDuration(65000)).toBe('1:05');
	});
	it('fps from frame times', () => {
		const t = Array.from({ length: 61 }, (_, i) => 5000 + i * (1000 / 60));
		expect(perf.fpsFromFrames(t, 6000)).toBeCloseTo(60, 0);
		expect(perf.fpsFromFrames([5990], 6000)).toBeNull();
	});
	it('main-thread load from long tasks and drift', () => {
		expect(perf.longTaskLoad([{ startTime: 100, duration: 250 }], 0, 1000)).toBeCloseTo(0.25);
		expect(perf.longTaskLoad([{ startTime: -100, duration: 300 }], 0, 1000)).toBeCloseTo(0.2);
		expect(perf.longTaskLoad([{ startTime: 0, duration: 5000 }], 0, 1000)).toBe(1);
		expect(perf.driftLoad(1000, 1300)).toBeCloseTo(0.3);
		expect(perf.driftLoad(1000, 900)).toBe(0);
		expect(perf.mainThreadLoad({ tasks: [{ startTime: 0, duration: 100 }], t0: 0, t1: 1000, expectedMs: 1000, actualMs: 1400 })).toBeCloseTo(0.4);
	});
	it('splits a total by weight', () => {
		const s = perf.shareTotal(100, [1, 3]);
		expect(s).toEqual([25, 75]);
		expect(perf.shareTotal(null, [1])).toEqual([0]);
		expect(perf.shareTotal(100, [0, 0])).toEqual([0, 0]);
	});
	it('summarizes resources and sorts rows with nulls last', () => {
		const sum = perf.summarizeResources([
			{ name: 'https://a/x.js', initiatorType: 'script', duration: 50, transferSize: 1000 },
			{ name: 'https://a/y.png', initiatorType: 'img', duration: 200, transferSize: 0 },
			{ name: 'https://a/z.js', initiatorType: 'script', duration: 10, transferSize: 500 },
		]);
		expect(sum.total).toBe(3);
		expect(sum.transfer).toBe(1500);
		expect(sum.byType[0]).toMatchObject({ type: 'script', count: 2, bytes: 1500 });
		expect(sum.slowest[0].name).toBe('https://a/y.png');
		const rows = perf.sortRows([{ k: 2 }, { k: null }, { k: 1 }], 'k', -1);
		expect(rows.map((r) => r.k)).toEqual([2, 1, null]);
		expect(perf.sortRows([{ k: 'b' }, { k: 'A' }], 'k').map((r) => r.k)).toEqual(['A', 'b']);
	});
	it('page timing', () => {
		expect(perf.pageTiming(null)).toBeNull();
		const t = perf.pageTiming({ domainLookupStart: 1, domainLookupEnd: 4, connectStart: 4, connectEnd: 10, responseStart: 30, domInteractive: 80, domContentLoadedEventEnd: 90, loadEventEnd: 0, transferSize: 5 });
		expect(t).toMatchObject({ dns: 3, connect: 6, ttfb: 30, load: null });
	});
});

describe('playlist-logic', () => {
	it('detects media kinds', () => {
		expect(pl.mediaKind('a.MP3')).toBe('audio');
		expect(pl.mediaKind('clip.webm')).toBe('video');
		expect(pl.mediaKind('x', 'audio/ogg')).toBe('audio');
		expect(pl.mediaKind('readme.txt')).toBeNull();
	});
	it('formats time', () => {
		expect(pl.formatTime(187)).toBe('3:07');
		expect(pl.formatTime(3729)).toBe('1:02:09');
		expect(pl.formatTime(NaN)).toBe('0:00');
		expect(pl.titleFromName('my_song.final.mp3')).toBe('my song.final');
	});
	it('builds orders; shuffle is a permutation starting with the current item', () => {
		expect(pl.buildOrder(4)).toEqual([0, 1, 2, 3]);
		const o = pl.buildOrder(6, { shuffle: true, current: 3, rng: () => 0.3 });
		expect(o[0]).toBe(3);
		expect([...o].sort()).toEqual([0, 1, 2, 3, 4, 5]);
	});
	it('next and previous honour repeat modes', () => {
		const o = [0, 1, 2];
		expect(pl.nextIndex(o, 0)).toBe(1);
		expect(pl.nextIndex(o, 2)).toBeNull();
		expect(pl.nextIndex(o, 2, { repeat: 'all' })).toBe(0);
		expect(pl.nextIndex(o, 1, { repeat: 'one', auto: true })).toBe(1);
		expect(pl.nextIndex(o, 1, { repeat: 'one', auto: false })).toBe(2);
		expect(pl.nextIndex([], 0)).toBeNull();
		expect(pl.prevIndex(o, 0)).toBe(0);
		expect(pl.prevIndex(o, 0, { repeat: 'all' })).toBe(2);
		expect(pl.prevIndex(o, 2)).toBe(1);
	});
	it('library keeps only media, audio before video, natural order', () => {
		const lib = pl.buildLibrary([
			{ type: 'file', path: '/Videos/b.mp4', name: 'b.mp4' },
			{ type: 'file', path: '/Music/10.mp3', name: '10.mp3' },
			{ type: 'file', path: '/Music/2.mp3', name: '2.mp3' },
			{ type: 'file', path: '/Music/n.txt', name: 'n.txt' },
			{ type: 'dir', path: '/Music/sub', name: 'sub' },
		]);
		expect(lib.map((l) => l.name)).toEqual(['2.mp3', '10.mp3', 'b.mp4']);
	});
	it('resume positions: remembered mid-track, dropped at the ends, bounded', () => {
		expect(pl.shouldRemember(3, 200)).toBe(false);
		expect(pl.shouldRemember(100, 200)).toBe(true);
		expect(pl.shouldRemember(198, 200)).toBe(false);
		expect(pl.shouldRemember(100, NaN)).toBe(false);
		let m = pl.updateResume({}, '/a', 100, 200);
		expect(m).toEqual({ '/a': 100 });
		m = pl.updateResume(m, '/a', 199, 200);
		expect(m).toEqual({});
		let big = {};
		for (let i = 0; i < 5; i++) big = pl.updateResume(big, `/f${i}`, 50, 200, 3);
		expect(Object.keys(big)).toEqual(['/f2', '/f3', '/f4']);
	});
});
