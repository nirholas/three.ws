import { describe, it, expect } from 'vitest';
import {
	classifyFiles,
	isEquirectRatio,
	lensInfo,
	matchingLensName,
	serializeTrim,
	moveHandle,
	nudgeStep,
	estimateProcessing,
	formatDurationRange,
	formatBytes,
	formatClock,
	formatRemaining,
	buildJobBody,
	stagesFor,
	stageView,
	overallProgress,
	nextPollDelay,
	isTerminal,
	describeCaptureError,
	splatUrlFor,
	timeAgo,
} from '../src/capture-360-core.js';

const f = (name, type = '') => ({ name, type, size: 10 });
const dims = (map) => ({
	video: async (file) => map[file.name] ?? null,
	image: async (file) => map[file.name] ?? null,
});

describe('equirect detection', () => {
	it('accepts 2:1 and rejects everything else', () => {
		expect(isEquirectRatio(7680, 3840)).toBe(true);
		expect(isEquirectRatio(5760, 2880)).toBe(true);
		expect(isEquirectRatio(3840, 1920)).toBe(true);
		expect(isEquirectRatio(1920, 1080)).toBe(false);
		expect(isEquirectRatio(3840, 2160)).toBe(false);
		expect(isEquirectRatio(0, 0)).toBe(false);
	});
});

describe('source-kind detection', () => {
	it('treats one .insv as a raw recording', async () => {
		const r = await classifyFiles([f('VID_20260814_132640_00_013.insv')]);
		expect(r).toMatchObject({ ok: true, sourceKind: 'insv' });
		expect(r.second).toBeUndefined();
	});
	it('pairs lens files whose names drop the trailing counter', async () => {
		const a = f('exemplar_00.insv');
		const b = f('exemplar_10.insv');
		expect(matchingLensName('exemplar_00.insv')).toBe('exemplar_10.insv');
		const r = await classifyFiles([b, a]);
		expect(r).toMatchObject({ ok: true, sourceKind: 'insv' });
		expect(r.second).toBeTruthy();
	});

	it('pairs the _00_ and _10_ lens files by name, in either order', async () => {
		const a = f('VID_20260814_132640_00_013.insv');
		const b = f('VID_20260814_132640_10_013.insv');
		for (const order of [[a, b], [b, a]]) {
			const r = await classifyFiles(order);
			expect(r.ok).toBe(true);
			expect(r.main).toBe(a);
			expect(r.second).toBe(b);
		}
	});
	it('refuses two .insv files that are not one recording', async () => {
		const r = await classifyFiles([f('VID_20260814_132640_00_013.insv'), f('VID_20260814_140000_10_014.insv')]);
		expect(r).toMatchObject({ ok: false, code: 'unpaired_files' });
	});
	it('names the file to ask for when only one lens is given', () => {
		expect(matchingLensName('VID_20260814_132640_00_013.insv')).toBe('VID_20260814_132640_10_013.insv');
		expect(matchingLensName('VID_20260814_132640_10_013.insv')).toBe('VID_20260814_132640_00_013.insv');
		expect(matchingLensName('walk.insv')).toBeNull();
		expect(lensInfo('walk.insv')).toBeNull();
	});
	it('accepts .insp and warns about .lrv proxies', async () => {
		expect(await classifyFiles([f('IMG_20260814_132640_00_013.insp')])).toMatchObject({ ok: true, sourceKind: 'insp' });
		const lrv = await classifyFiles([f('LRV_20260814_132640_01_013.lrv')]);
		expect(lrv).toMatchObject({ ok: true, sourceKind: 'insv' });
		expect(lrv.warnings[0]).toMatch(/low-resolution/);
	});
	it('accepts a 2:1 mp4 and mov as equirect_video using probed dimensions', async () => {
		const probe = dims({ 'walk.mp4': { width: 5760, height: 2880 }, 'walk.mov': { width: 3840, height: 1920 } });
		expect(await classifyFiles([f('walk.mp4', 'video/mp4')], probe)).toMatchObject({ ok: true, sourceKind: 'equirect_video', width: 5760 });
		expect(await classifyFiles([f('walk.mov', 'video/quicktime')], probe)).toMatchObject({ ok: true, sourceKind: 'equirect_video' });
	});
	it('rejects a flat video with an explanation and a way out', async () => {
		const r = await classifyFiles([f('phone.mp4', 'video/mp4')], dims({ 'phone.mp4': { width: 1920, height: 1080 } }));
		expect(r).toMatchObject({ ok: false, code: 'not_equirect' });
		expect(r.message).toMatch(/Standard video/);
	});
	it('reports an unreadable video instead of guessing', async () => {
		const r = await classifyFiles([f('odd.mp4', 'video/mp4')], dims({}));
		expect(r).toMatchObject({ ok: false, code: 'unreadable_video' });
	});
	it('accepts a set of 2:1 photos as equirect_images, sorted naturally, with a count warning', async () => {
		const names = ['p10.jpg', 'p2.jpg', 'p1.jpg'];
		const probe = dims(Object.fromEntries(names.map((n) => [n, { width: 6080, height: 3040 }])));
		const r = await classifyFiles(names.map((n) => f(n, 'image/jpeg')), probe);
		expect(r.ok).toBe(true);
		expect(r.sourceKind).toBe('equirect_images');
		expect(r.files.map((x) => x.name)).toEqual(['p1.jpg', 'p2.jpg', 'p10.jpg']);
		expect(r.warnings[0]).toMatch(/20 or more/);
	});
	it('rejects too few photos and non-2:1 photos', async () => {
		expect(await classifyFiles([f('a.jpg', 'image/jpeg'), f('b.jpg', 'image/jpeg')], dims({}))).toMatchObject({ ok: false, code: 'too_few_photos' });
		const probe = dims({ 'a.jpg': { width: 6000, height: 3000 }, 'b.jpg': { width: 4000, height: 3000 }, 'c.jpg': { width: 6000, height: 3000 } });
		const r = await classifyFiles(['a.jpg', 'b.jpg', 'c.jpg'].map((n) => f(n, 'image/jpeg')), probe);
		expect(r).toMatchObject({ ok: false, code: 'not_equirect' });
		expect(r.message).toMatch(/b\.jpg/);
	});
	it('rejects mixed kinds, unknown files and empty input', async () => {
		expect(await classifyFiles([f('a.insv'), f('b.mp4', 'video/mp4')])).toMatchObject({ code: 'mixed_files' });
		expect(await classifyFiles([f('notes.txt')])).toMatchObject({ code: 'unsupported_file' });
		expect(await classifyFiles([])).toMatchObject({ code: 'no_file' });
	});
});

describe('trim serialisation', () => {
	it('sends nothing when the whole clip is kept', () => {
		expect(serializeTrim({ start: 0, end: 60, duration: 60 })).toBeUndefined();
		expect(serializeTrim({ start: 0.02, end: 59.98, duration: 60 })).toBeUndefined();
	});
	it('serialises start_s and end_s to milliseconds', () => {
		expect(serializeTrim({ start: 12.3456, end: 48.7891, duration: 90 })).toEqual({ start_s: 12.346, end_s: 48.789 });
		expect(serializeTrim({ start: 5, end: 90, duration: 90 })).toEqual({ start_s: 5, end_s: 90 });
	});
	it('clamps to the clip and refuses a span under two seconds', () => {
		expect(serializeTrim({ start: -4, end: 500, duration: 60 })).toBeUndefined();
		expect(() => serializeTrim({ start: 10, end: 11, duration: 60 })).toThrow(RangeError);
	});
	it('returns nothing for an unknown duration', () => {
		expect(serializeTrim({ start: 1, end: 2, duration: 0 })).toBeUndefined();
	});
	it('moves handles without crossing and nudges by key', () => {
		const t = { start: 10, end: 30, duration: 60 };
		expect(moveHandle(t, 'start', 40)).toEqual({ start: 28, end: 30 });
		expect(moveHandle(t, 'end', 5)).toEqual({ start: 10, end: 12 });
		expect(moveHandle(t, 'end', 999)).toEqual({ start: 10, end: 60 });
		expect(nudgeStep('ArrowRight')).toBe(0.1);
		expect(nudgeStep('ArrowLeft', true)).toBe(-1);
		expect(nudgeStep('PageUp')).toBe(10);
		expect(nudgeStep('a')).toBe(0);
	});
});

describe('job body', () => {
	it('includes source_kind, quality and trim only when set', () => {
		expect(buildJobBody({ sourceUrl: 'https://x/y.insv', sourceKind: 'insv', quality: 'high', trim: { start_s: 1, end_s: 9 } })).toEqual({
			source_url: 'https://x/y.insv',
			source_kind: 'insv',
			quality: 'high',
			trim: { start_s: 1, end_s: 9 },
		});
		const plain = buildJobBody({ sourceUrl: 'https://x/y.mp4', sourceKind: 'equirect_video', quality: 'nonsense' });
		expect(plain).toEqual({ source_url: 'https://x/y.mp4', source_kind: 'equirect_video', quality: 'standard' });
	});
	it('passes source_urls for sets of photos or a lens pair', () => {
		const b = buildJobBody({ sourceUrl: 'u1', sourceUrls: ['u1', 'u2'], sourceKind: 'equirect_images', quality: 'preview' });
		expect(b.source_urls).toEqual(['u1', 'u2']);
	});
});

describe('estimates', () => {
	it('grows with quality and with trimmed length, and stitching adds time for raw files', () => {
		const p = estimateProcessing({ durationS: 90, quality: 'preview' });
		const s = estimateProcessing({ durationS: 90, quality: 'standard' });
		const h = estimateProcessing({ durationS: 90, quality: 'high' });
		expect(p.maxSeconds).toBeLessThan(s.maxSeconds);
		expect(s.maxSeconds).toBeLessThan(h.maxSeconds);
		expect(estimateProcessing({ durationS: 180, quality: 'standard' }).maxSeconds).toBeGreaterThan(s.maxSeconds);
		expect(estimateProcessing({ durationS: 90, quality: 'standard', raw: true }).minSeconds).toBeGreaterThan(s.minSeconds);
	});
	it('caps frames at the preset budget so long clips do not promise impossible times', () => {
		expect(estimateProcessing({ durationS: 3600, quality: 'preview' }).frames).toBe(120);
		expect(estimateProcessing({ durationS: 3600, quality: 'standard' }).frames).toBe(300);
	});
	it('is conservative: a standard 90 s walkaround lands in tens of minutes, not seconds', () => {
		const e = estimateProcessing({ durationS: 90, quality: 'standard' });
		expect(e.minSeconds).toBeGreaterThan(20 * 60);
		expect(formatDurationRange(e.minSeconds, e.maxSeconds)).toMatch(/^\d+ to \d+ min$/);
	});
	it('uses photo count for sets of photos', () => {
		expect(estimateProcessing({ photos: 40, quality: 'standard' }).frames).toBe(40);
	});
});

describe('formatting', () => {
	it('formats bytes, clocks and remaining time', () => {
		expect(formatBytes(1536)).toBe('1.50 KB');
		expect(formatBytes(1.2 * 1024 ** 3)).toBe('1.20 GB');
		expect(formatClock(75)).toBe('1:15');
		expect(formatClock(3725)).toBe('1:02:05');
		expect(formatRemaining(30)).toBe('30 s left');
		expect(formatRemaining(600)).toBe('10 min left');
		expect(formatRemaining(null)).toBe('estimating');
	});
});

describe('stage view', () => {
	it('hides the stitch step for stitched sources and shows it for raw files', () => {
		expect(stagesFor('equirect_video')).toEqual(['upload', 'frames', 'sfm', 'train', 'export']);
		expect(stagesFor('insv')).toEqual(['upload', 'stitch', 'frames', 'sfm', 'train', 'export']);
	});
	it('marks earlier steps done, the current active with its real progress, later pending', () => {
		const v = stageView({ status: 'running', stage: 'sfm', progress: 0.4 }, 'insv');
		expect(v.map((s) => s.state)).toEqual(['done', 'done', 'done', 'active', 'pending', 'pending']);
		expect(v.find((s) => s.state === 'active').fraction).toBe(0.4);
	});
	it('treats the worker download stage as Upload and its upload stage as Export', () => {
		expect(stageView({ status: 'running', stage: 'download', progress: 0.2 }, 'equirect_video')[0].state).toBe('active');
		const last = stageView({ status: 'running', stage: 'upload', progress: 0.5 }, 'equirect_video');
		expect(last.at(-1).state).toBe('active');
	});
	it('maps the API save stage to Export, and a queued job to Upload done', () => {
		const saving = stageView({ status: 'running', stage: 'save', progress: 0.99 }, 'equirect_video');
		expect(saving.at(-1).state).toBe('active');
		const queued = stageView({ status: 'queued', stage: 'queued', progress: 0 }, 'equirect_video');
		expect(queued[0].state).toBe('done');
		expect(queued.filter((s) => s.state === 'active')).toHaveLength(1);
	});
	it('is all done on success and computes overall progress', () => {
		const v = stageView({ status: 'succeeded' }, 'equirect_video');
		expect(v.every((s) => s.state === 'done')).toBe(true);
		expect(overallProgress(v)).toBe(1);
		expect(overallProgress(stageView({ status: 'running', stage: 'train', progress: 0.5 }, 'equirect_video'))).toBeCloseTo((3 + 0.5) / 5, 5);
	});
});

describe('polling', () => {
	it('polls every 5 s, slows when hidden and backs off on failures with a cap', () => {
		expect(nextPollDelay()).toBe(5000);
		expect(nextPollDelay({ hidden: true })).toBe(30000);
		expect(nextPollDelay({ failures: 2 })).toBe(20000);
		expect(nextPollDelay({ failures: 9 })).toBe(60000);
	});
	it('knows terminal statuses', () => {
		expect(isTerminal('succeeded')).toBe(true);
		expect(isTerminal('failed')).toBe(true);
		expect(isTerminal('running')).toBe(false);
	});
});

describe('error copy', () => {
	it('never shows operator hints for unconfigured', () => {
		const e = describeCaptureError('unconfigured', { message: 'Set GCP_PANO2SPLAT_URL' });
		expect(e.message).not.toMatch(/GCP_|env|PANO2SPLAT/i);
		expect(e.tone).toBe('info');
	});
	it('gives capture tips for too_few_registered', () => {
		const e = describeCaptureError('too_few_registered');
		expect(e.message).toMatch(/slowly/);
		expect(e.message).toMatch(/stick/);
	});
	it('maps signed-out, size, rate-limit and network cases to actions', () => {
		expect(describeCaptureError('unauthorized').action).toBe('sign_in');
		expect(describeCaptureError('x', { status: 401 }).action).toBe('sign_in');
		expect(describeCaptureError('file_too_large').message).toMatch(/8 GB/);
		expect(describeCaptureError('x', { status: 413 }).title).toMatch(/too large/);
		expect(describeCaptureError('x', { status: 429 }).action).toBe('wait');
		expect(describeCaptureError('x', { status: 503 }).title).toMatch(/not switched on/);
		expect(describeCaptureError('network').message).toMatch(/resumes by itself/);
	});
	it('covers every code the API and worker can return with a title, message and action', () => {
		const codes = ['unconfigured', 'too_few_registered', 'registration_too_low', 'file_too_large', 'source_too_large', 'unauthorized', 'sign_in_required', 'too_many_active', 'too_many_open_uploads', 'daily_quota_exceeded', 'invalid_content_type', 'rate_limited', 'unsupported_input', 'no_calibration', 'corrupt_input', 'no_frames_decoded', 'no_video_stream', 'no_images', 'upload_not_found', 'internal_error', 'stage_failed', 'worker_lost', 'nvenc_error', 'storage_error', 'cancelled', 'network', 'etag_unreadable', 'empty_file', 'aborted'];
		for (const c of codes) {
			const e = describeCaptureError(c);
			expect(e.title, c).not.toBe('Something went wrong');
			expect(e.message.length, c).toBeGreaterThan(20);
			expect(e.action, c).toBeTruthy();
			expect(`${e.title} ${e.message}`, c).not.toMatch(/\u2014|\u2013/);
		}
	});
	it('passes through a visitor-readable server message for unknown codes', () => {
		expect(describeCaptureError('weird', { message: 'The clip has no video track.' }).message).toBe('The clip has no video track.');
	});
});

describe('results and history helpers', () => {
	it('prefers the API viewer_url and falls back to /splat with the encoded SPZ', () => {
		expect(splatUrlFor({ viewer_url: '/splat?src=abc' })).toBe('/splat?src=abc');
		expect(splatUrlFor({ spz_url: 'https://r2/x y.spz' })).toBe('/splat?src=https%3A%2F%2Fr2%2Fx%20y.spz');
		expect(splatUrlFor({})).toBeNull();
	});
	it('formats relative times', () => {
		const now = Date.parse('2026-11-21T12:00:00Z');
		expect(timeAgo('2026-11-21T11:59:40Z', now)).toBe('just now');
		expect(timeAgo('2026-11-21T11:30:00Z', now)).toBe('30 min ago');
		expect(timeAgo('2026-11-21T07:00:00Z', now)).toBe('5 h ago');
		expect(timeAgo('2026-11-19T12:00:00Z', now)).toBe('2 d ago');
		expect(timeAgo('nope', now)).toBe('');
	});
});
