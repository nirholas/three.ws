// /insta360 landing page: the file classifier behind "Check your file", the
// page wiring (route, build entry, discovery, nav, SEO) and the copy rules the
// campaign binds the page to (nominative trademark use, no dash glyphs).

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	LANES,
	SHARP_EQUIRECT_WIDTH,
	assessFile,
	cameraModelFromTrailer,
	extensionOf,
	isStitchableCamera,
	trailerLength,
	isEquirect,
	isSplitLensName,
	kindOf,
} from '../src/insta360-file-check.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

const NEW_FILES = [
	'pages/insta360.html',
	'src/insta360-landing.js',
	'src/insta360-file-check.js',
	'src/insta360.css',
	'docs/tutorials/insta360-to-3d.md',
	'docs/marketing/insta360-launch.md',
];

const html = read('pages/insta360.html');
const ids = (result) => result.lanes.map((l) => l.id);

describe('kindOf and helpers', () => {
	it('recognises raw camera files by extension, case-insensitively', () => {
		expect(kindOf('VID_20261101_120000_00_001.insv')).toBe('insv');
		expect(kindOf('IMG_1.INSP')).toBe('insp');
		expect(kindOf('LRV_1.lrv')).toBe('lrv');
		expect(kindOf('pano.dng')).toBe('dng');
		expect(kindOf('studio.exr')).toBe('exr');
	});

	it('falls back to MIME type when the extension is unfamiliar', () => {
		expect(kindOf('clip', 'video/mp4')).toBe('video');
		expect(kindOf('photo', 'image/jpeg')).toBe('image');
		expect(kindOf('notes.txt', 'text/plain')).toBe('unknown');
		expect(extensionOf('  a.b.MP4 ')).toBe('mp4');
		expect(extensionOf('noext')).toBe('');
	});

	it('spots the one-file-per-lens naming of X3 and older', () => {
		expect(isSplitLensName('VID_20261101_120000_00_001.insv')).toBe(true);
		expect(isSplitLensName('VID_20261101_120000_10_001.insv')).toBe(true);
		expect(isSplitLensName('VID_20261101_120000_001.insv')).toBe(false);
	});

	it('treats 2:1 within tolerance as equirectangular', () => {
		expect(isEquirect(5760, 2880)).toBe(true);
		expect(isEquirect(7680, 3840)).toBe(true);
		expect(isEquirect(3840, 1920)).toBe(true);
		expect(isEquirect(1920, 1080)).toBe(false);
		expect(isEquirect(0, 0)).toBe(false);
	});
});

describe('assessFile', () => {
	it('routes a raw .insv to the splat and motion lanes', () => {
		const r = assessFile({ name: 'VID_20261101_120000_001.insv' });
		expect(r.verdict).toBe('raw');
		expect(ids(r)).toEqual(['splat', 'motion']);
		expect(r.notes.some((n) => n.includes('_00_'))).toBe(false);
	});

	it('tells a split-lens .insv owner to add both files', () => {
		const r = assessFile({ name: 'VID_20261101_120000_00_001.insv' });
		expect(r.notes.some((n) => n.includes('Add both files'))).toBe(true);
	});

	it('steers an .lrv proxy back to the full .insv', () => {
		const r = assessFile({ name: 'LRV_20261101_120000_01_001.lrv' });
		expect(r.title).toMatch(/proxy/i);
		expect(r.notes[0]).toMatch(/\.insv/);
	});

	it('routes a raw .insp to the pano scene and environment lanes', () => {
		const r = assessFile({ name: 'IMG_1.insp' });
		expect(ids(r)).toEqual(['panoScene', 'environment']);
	});

	it('routes an EXR to the environment lane first', () => {
		expect(ids(assessFile({ name: 'hdr.exr' }))[0]).toBe('environment');
	});

	it('accepts a sharp stitched 360 video inside the walk window', () => {
		const r = assessFile({ name: 'walk.mp4', width: 5760, height: 2880, durationS: 95 });
		expect(r.verdict).toBe('equirect');
		expect(ids(r)).toEqual(['splat', 'motion']);
		expect(r.notes.some((n) => n.includes('1 min 35 s is inside'))).toBe(true);
		expect(r.notes.some((n) => n.includes(`Under ${SHARP_EQUIRECT_WIDTH}`))).toBe(false);
	});

	it('flags a short, soft stitched video', () => {
		const r = assessFile({ name: 'walk.mp4', width: 3840, height: 1920, durationS: 12 });
		expect(r.notes.some((n) => n.includes(`Under ${SHARP_EQUIRECT_WIDTH}`))).toBe(true);
		expect(r.notes.some((n) => n.startsWith('12 s is short'))).toBe(true);
	});

	it('flags a walk longer than three minutes', () => {
		const r = assessFile({ name: 'walk.mov', width: 7680, height: 3840, durationS: 245 });
		expect(r.notes.some((n) => n.startsWith('4 min 05 s is longer'))).toBe(true);
	});

	it('sends a flat video to the existing capture and motion lanes', () => {
		const r = assessFile({ name: 'action.mp4', width: 3840, height: 2160, durationS: 60 });
		expect(r.verdict).toBe('flat');
		expect(ids(r)).toEqual(['flatCapture', 'flatMotion']);
	});

	it('explains an undecodable video without blocking the upload', () => {
		const r = assessFile({ name: 'hevc.mp4', readError: true });
		expect(r.verdict).toBe('unknown');
		expect(r.summary).toMatch(/HEVC/);
		expect(r.lanes.length).toBeGreaterThan(0);
	});

	it('routes a stitched 360 photo and a flat photo apart', () => {
		expect(ids(assessFile({ name: 'p.jpg', width: 11904, height: 5952 }))).toEqual(['panoScene', 'environment']);
		expect(ids(assessFile({ name: 'p.jpg', width: 4000, height: 3000 }))).toEqual(['imageTo3d']);
	});

	it('names the formats it does read when the file is something else', () => {
		const r = assessFile({ name: 'model.blend' });
		expect(r.verdict).toBe('unknown');
		expect(r.lanes).toEqual([]);
		expect(r.summary).toMatch(/\.insv/);
	});

	it('only ever points at lanes it defines', () => {
		const samples = [
			{ name: 'a.insv' },
			{ name: 'a.insp' },
			{ name: 'a.lrv' },
			{ name: 'a.dng' },
			{ name: 'a.exr' },
			{ name: 'a.mp4', width: 5760, height: 2880, durationS: 60 },
			{ name: 'a.mp4', width: 1920, height: 1080 },
			{ name: 'a.png', width: 6080, height: 3040 },
		];
		for (const s of samples) {
			for (const lane of assessFile(s).lanes) expect(LANES[lane.id]).toBeDefined();
		}
	});
});

describe('page and lane status agree', () => {
	it('badges each 360 lane card the way LANES says', () => {
		for (const id of ['splat', 'panoScene', 'environment', 'motion']) {
			const card = new RegExp(`data-lane="${id}"[\\s\\S]*?data-lane-status="([a-z-]+)"`).exec(html);
			expect(card, `card ${id}`).not.toBeNull();
			expect(card[1]).toBe(LANES[id].status === 'rolling-out' ? 'rolling-out' : 'live');
		}
	});

	it('loads the checker and links every lane surface and the tutorial', () => {
		expect(html).toContain('src="/src/insta360-landing.js"');
		for (const href of ['/capture', '/pano-scene', '/app', '/video-to-motion', '/tutorials/insta360-to-3d']) {
			expect(html).toContain(`href="${href}"`);
		}
	});

	it('wires every element id the checker script looks up', () => {
		const js = read('src/insta360-landing.js');
		const wanted = [...js.matchAll(/\$\('([a-z0-9-]+)'\)/g)].map((m) => m[1]);
		expect(wanted.length).toBeGreaterThan(5);
		for (const id of new Set(wanted)) expect(html).toContain(`id="${id}"`);
	});
});

describe('routing, discovery and SEO', () => {
	const vercel = JSON.parse(read('vercel.json'));
	const viteConfig = read('vite.config.js');
	const pages = JSON.parse(read('data/pages.json'));
	const pagePaths = new Set();
	const walk = (node) => {
		if (Array.isArray(node)) return node.forEach(walk);
		if (!node || typeof node !== 'object') return;
		if (typeof node.path === 'string') pagePaths.add(node.path);
		Object.values(node).forEach(walk);
	};
	walk(pages);

	it('serves /insta360 and /insta360/ before the filesystem phase', () => {
		const fsIdx = vercel.routes.findIndex((r) => r.handle === 'filesystem');
		for (const path of ['/insta360', '/insta360/']) {
			const idx = vercel.routes.findIndex(
				(r) => typeof r.src === 'string' && r.dest === '/insta360.html' && new RegExp(`^${r.src}$`).test(path),
			);
			expect(idx, path).toBeGreaterThan(-1);
			expect(fsIdx).toBeGreaterThan(idx);
		}
	});

	it('is a build entry and resolves in the dev server route map', () => {
		expect(viteConfig).toContain("insta360: resolve(__dirname, 'pages/insta360.html')");
		expect(viteConfig).toContain("'/insta360': resolve(root, 'pages/insta360.html')");
		expect(viteConfig).toContain("'/insta360/': resolve(root, 'pages/insta360.html')");
	});

	it('is declared in data/pages.json with its tutorial', () => {
		expect(pagePaths.has('/insta360')).toBe(true);
		expect(pagePaths.has('/tutorials/insta360-to-3d')).toBe(true);
		expect(read('public/tutorials-manifest.js')).toContain("slug: 'insta360-to-3d'");
	});

	it('is reachable from the nav and from /capture', () => {
		expect(read('public/nav-data.js')).toContain("href: '/insta360'");
		expect(read('pages/capture.html')).toContain('href="/insta360"');
	});

	it('carries canonical, OG card, Twitter card and HowTo structured data', () => {
		expect(html).toContain('<link rel="canonical" href="https://three.ws/insta360"');
		expect(html).toMatch(/<meta property="og:image" content="https:\/\/three\.ws\/api\/page-og\?/);
		expect(html).toContain('<meta name="twitter:card" content="summary_large_image"');
		const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);
		const graph = JSON.parse(ld[1])['@graph'];
		const howTo = graph.find((n) => n['@type'] === 'HowTo');
		expect(howTo.step.length).toBeGreaterThanOrEqual(5);
	});
});

describe('copy rules', () => {
	it('uses no em-dash or en-dash in any file this page ships', () => {
		for (const f of NEW_FILES) expect(read(f), f).not.toMatch(/[\u2013\u2014]/);
	});

	it('states non-affiliation and never puts the camera brand in a product name', () => {
		expect(html).toMatch(/not affiliated with(, sponsored by)? or endorsed by Insta360/);
		expect(read('docs/tutorials/insta360-to-3d.md')).toMatch(/not affiliated with or endorsed by Insta360/);
		expect(html).not.toMatch(/three\.ws Insta360|Insta360 (Studio|Capture|Splat) by three\.ws/i);
		expect(html).toContain('any 360 camera');
	});

	it('keeps coin and price words off the capture surface', () => {
		const text = html.replace(/<script[\s\S]*?<\/script>/g, '');
		expect(text).not.toMatch(/\$THREE|\btoken\b|\bcoin\b|\bUSDC\b|\bprice\b/i);
	});

	it('has every new file on disk', () => {
		for (const f of NEW_FILES) expect(existsSync(resolve(ROOT, f)), f).toBe(true);
	});
});

// The trailer Insta360 appends to .insv and .insp files, built byte for byte the
// way workers/model-pano2splat/pano_stitch/trailer.py reads it: records each closed
// by a 6 byte footer (format u8, id u8, length u32 LE), then 32 reserved bytes, the
// trailer size, a version and the 32 byte magic.
const MAGIC = '8db42d694ccc418790edff439fe026bf';
const enc = new TextEncoder();
function protoString(field, text) {
	const bytes = enc.encode(text);
	return [(field << 3) | 2, bytes.length, ...bytes];
}
function footer(fmt, id, length) {
	return [fmt, id, length & 255, (length >> 8) & 255, (length >> 16) & 255, (length >>> 24) & 255];
}
function u32(n) {
	return [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
}
function withTail(payload) {
	const size = payload.length + 72;
	return Uint8Array.from([...payload, ...new Array(32).fill(0), ...u32(size), ...u32(3), ...enc.encode(MAGIC)]);
}
function walkedTrailer(model) {
	const meta = [...protoString(1, 'IAEBA1234'), ...protoString(2, model)];
	const imu = [1, 2, 3, 4, 5, 6, 7, 8];
	return withTail([...meta, ...footer(0, 1, meta.length), ...imu, ...footer(0, 3, imu.length)]);
}
function indexedTrailer(model) {
	const meta = [...protoString(2, model), ...protoString(3, 'v1.2.3')];
	const pad = new Array(5).fill(0);
	const entry = (id, len, off) => [id, 0, ...u32(len), ...u32(off)];
	const dir = [...entry(1, meta.length, pad.length), ...entry(0, 0, 0)];
	return withTail([...pad, ...meta, ...dir, ...footer(0, 0, dir.length)]);
}

describe('camera model from the raw file trailer', () => {
	it('finds the trailer length from the last 72 bytes, or 0 when there is none', () => {
		const t = walkedTrailer('Insta360 X3');
		expect(trailerLength(t.slice(-72), 5_000_000)).toBe(t.length);
		expect(trailerLength(new Uint8Array(72), 5_000_000)).toBe(0);
		expect(trailerLength(t.slice(-72), 10)).toBe(0);
	});

	it('reads the model from a walked trailer (X3 and older) and an indexed one (X4 and later)', () => {
		expect(cameraModelFromTrailer(walkedTrailer('Insta360 ONE'))).toBe('Insta360 ONE');
		expect(cameraModelFromTrailer(indexedTrailer('Insta360 X5'))).toBe('Insta360 X5');
		expect(cameraModelFromTrailer(new Uint8Array(100))).toBe('');
	});

	it('accepts exactly the cameras the stitcher accepts', () => {
		for (const m of ['Insta360 ONE X', 'Insta360 ONE X2', 'Insta360 ONE R', 'Insta360 ONE RS', 'Insta360 X3', 'Insta360 X4', 'Insta360 X6']) {
			expect(isStitchableCamera(m)).toBe(true);
		}
		expect(isStitchableCamera('Insta360 ONE')).toBe(false);
		expect(isStitchableCamera('Insta360 Pro2')).toBe(false);
	});

	it('warns before upload when a raw file comes from a camera the stitcher refuses', () => {
		const photo = assessFile({ name: 'IMG_20180318_205851_239.insp', cameraModel: 'Insta360 ONE' });
		expect(photo.title).toContain('Insta360 ONE');
		expect(photo.summary).toMatch(/cannot be stitched/);
		expect(photo.summary).toMatch(/JPEG/);
		expect(photo.notes.join(' ')).not.toMatch(/Upload it as it is/);
		const video = assessFile({ name: 'VID_1_00_001.insv', cameraModel: 'Insta360 ONE' });
		expect(video.summary).toMatch(/MP4/);
		expect(video.notes.join(' ')).not.toMatch(/Upload it as it is/);
	});

	it('keeps the upload-as-is copy for a supported camera or an unread trailer', () => {
		expect(assessFile({ name: 'a.insp', cameraModel: 'Insta360 X3' }).notes[0]).toMatch(/Upload it as it is/);
		expect(assessFile({ name: 'a.insp' }).notes[0]).toMatch(/Upload it as it is/);
	});
});
