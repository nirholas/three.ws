// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	MAX_MOTION_UPLOAD_BYTES,
	isEquirectSize,
	isRawCameraFile,
	wrapYaw,
	rayToYawPitch,
	yawPitchToDirection,
	pixelToYawPitch,
	buildCaptureBody,
	classifyCaptureError,
	reframeUrlOf,
	fileProblem,
	planReframeSync,
	createReframePanel,
	createMotion360Stage,
} from '../src/motion-360.js';

const root = resolve(import.meta.dirname, '..');

describe('2:1 detection', () => {
	it('accepts the sizes real 360 exports use', () => {
		expect(isEquirectSize(5760, 2880)).toBe(true);
		expect(isEquirectSize(3840, 1920)).toBe(true);
		expect(isEquirectSize(7680, 3840)).toBe(true);
		expect(isEquirectSize(1920, 960)).toBe(true);
	});
	it('rejects regular and unreadable frames', () => {
		expect(isEquirectSize(1920, 1080)).toBe(false);
		expect(isEquirectSize(1080, 1920)).toBe(false);
		expect(isEquirectSize(3840, 2160)).toBe(false);
		expect(isEquirectSize(0, 0)).toBe(false);
		expect(isEquirectSize(NaN, 100)).toBe(false);
	});
	it('recognises raw camera files by extension, case-insensitively', () => {
		expect(isRawCameraFile({ name: 'VID_20260101_X5.insv' })).toBe(true);
		expect(isRawCameraFile({ name: 'a.INSP' })).toBe(true);
		expect(isRawCameraFile({ name: 'a.lrv' })).toBe(true);
		expect(isRawCameraFile({ name: 'a.mp4' })).toBe(false);
		expect(isRawCameraFile(null)).toBe(false);
	});
});

describe('click ray to yaw and pitch (C3 convention)', () => {
	it('centre of the frame is yaw 0 pitch 0', () => {
		expect(rayToYawPitch(0, 0, -1)).toEqual({ yaw_deg: 0, pitch_deg: 0 });
	});
	it('yaw grows to the right', () => {
		expect(rayToYawPitch(1, 0, 0).yaw_deg).toBe(90);
		expect(rayToYawPitch(-1, 0, 0).yaw_deg).toBe(-90);
		expect(rayToYawPitch(1, 0, -1).yaw_deg).toBe(45);
	});
	it('pitch grows upward and reaches the poles', () => {
		expect(rayToYawPitch(0, 1, 0).pitch_deg).toBe(90);
		expect(rayToYawPitch(0, -1, 0).pitch_deg).toBe(-90);
		expect(rayToYawPitch(0, 1, -1).pitch_deg).toBe(45);
	});
	it('straight behind the viewer is the seam, +180 or -180', () => {
		expect(Math.abs(rayToYawPitch(0, 0, 1).yaw_deg)).toBe(180);
		expect(rayToYawPitch(0.001, 0, 1).yaw_deg).toBeGreaterThan(179);
		expect(rayToYawPitch(-0.001, 0, 1).yaw_deg).toBeLessThan(-179);
	});
	it('ignores ray length and survives a zero ray', () => {
		expect(rayToYawPitch(0, 0, -50)).toEqual({ yaw_deg: 0, pitch_deg: 0 });
		expect(rayToYawPitch(0, 0, 0)).toEqual({ yaw_deg: 0, pitch_deg: 0 });
	});
	it('matches the pixel formula the worker documents, at every edge', () => {
		const W = 5760;
		const H = 2880;
		for (const [px, py] of [
			[W / 2, H / 2],
			[0, H / 2],
			[W - 1, H / 2],
			[W / 4, H / 4],
			[(3 * W) / 4, (3 * H) / 4],
			[W / 2, 0],
			[W / 2, H],
		]) {
			const a = pixelToYawPitch(px, py, W, H);
			const d = yawPitchToDirection(a.yaw_deg, a.pitch_deg);
			const back = rayToYawPitch(d.x, d.y, d.z);
			if (Math.abs(a.pitch_deg) < 90) {
				expect(back.yaw_deg).toBeCloseTo(a.yaw_deg, 1);
			}
			expect(back.pitch_deg).toBeCloseTo(a.pitch_deg, 1);
		}
		expect(pixelToYawPitch(W / 2, H / 2, W, H)).toEqual({ yaw_deg: 0, pitch_deg: 0 });
		expect(pixelToYawPitch(0, 0, W, H)).toEqual({ yaw_deg: -180, pitch_deg: 90 });
		expect(pixelToYawPitch(W, H, W, H)).toEqual({ yaw_deg: 180, pitch_deg: -90 });
		expect(pixelToYawPitch(W * 0.75, H * 0.25, W, H)).toEqual({ yaw_deg: 90, pitch_deg: 45 });
	});
	it('wrapYaw keeps angles in range', () => {
		expect(wrapYaw(190)).toBe(-170);
		expect(wrapYaw(-190)).toBe(170);
		expect(wrapYaw(180)).toBe(180);
		expect(wrapYaw(360)).toBe(0);
	});
});

describe('request body shape', () => {
	const url = 'https://cdn.example.com/clip.mp4';
	it('is unchanged for a regular video', () => {
		expect(buildCaptureBody(url)).toEqual({ video_url: url });
		expect(buildCaptureBody(url, null)).toEqual({ video_url: url });
		expect(buildCaptureBody(url, { projection: 'perspective' })).toEqual({ video_url: url });
	});
	it('sends projection and subject when a person was picked', () => {
		const body = buildCaptureBody(url, {
			projection: 'equirect',
			subject: { yaw_deg: 42.5, pitch_deg: -8 },
		});
		expect(body).toEqual({
			video_url: url,
			projection: 'equirect',
			subject: { yaw_deg: 42.5, pitch_deg: -8 },
		});
	});
	it('leaves subject out for Pick for me', () => {
		const body = buildCaptureBody(url, { projection: 'equirect' });
		expect(body).toEqual({ video_url: url, projection: 'equirect' });
		expect('subject' in body).toBe(false);
	});
	it('clamps to the contract ranges and drops non-numeric subjects', () => {
		expect(
			buildCaptureBody(url, { projection: 'equirect', subject: { yaw_deg: 400, pitch_deg: -120 } }).subject,
		).toEqual({ yaw_deg: 180, pitch_deg: -90 });
		expect(
			'subject' in buildCaptureBody(url, { projection: 'equirect', subject: { yaw_deg: NaN, pitch_deg: 0 } }),
		).toBe(false);
	});
	it('carries the pick time only when it is past the first frame', () => {
		const at = (t_s) =>
			buildCaptureBody(url, { projection: 'equirect', subject: { yaw_deg: 1, pitch_deg: 2, t_s } }).subject;
		expect(at(0)).toEqual({ yaw_deg: 1, pitch_deg: 2 });
		expect(at(12.345)).toEqual({ yaw_deg: 1, pitch_deg: 2, t_s: 12.35 });
	});
});

describe('errors and limits', () => {
	it('classifies a lost subject from the code or the worker message', () => {
		expect(classifyCaptureError('x', 'subject_lost')).toBe('subject_lost');
		expect(classifyCaptureError('The subject was lost after 12 s.')).toBe('subject_lost');
		expect(classifyCaptureError('Could not find the person you picked.')).toBe('subject_lost');
		expect(classifyCaptureError('The person could not be found in the 360 frame.')).toBe('subject_lost');
		expect(classifyCaptureError('Capture failed. Make sure one person is clearly visible.')).toBe('generic');
	});
	it('rejects oversize files with wording for 360 and regular clips', () => {
		const big = { size: MAX_MOTION_UPLOAD_BYTES + 1 };
		expect(fileProblem(big, { is360: true })).toMatch(/360 clip.*3840 x 1920/);
		expect(fileProblem(big)).toMatch(/Trim it down/);
		expect(fileProblem({ size: MAX_MOTION_UPLOAD_BYTES })).toBeNull();
	});
	it('keeps the client cap equal to the API presign cap and the worker cap', () => {
		const api = readFileSync(resolve(root, 'api/_lib/anon-upload-limits.js'), 'utf8');
		expect(api).toMatch(/'motion-swap\/uploads\/': 256 \* 1024 \* 1024/);
		const worker = readFileSync(resolve(root, 'workers/model-video2motion/main.py'), 'utf8');
		expect(worker).toMatch(/MAX_VIDEO_BYTES = 256 \* 1024 \* 1024/);
		expect(MAX_MOTION_UPLOAD_BYTES).toBe(256 * 1024 * 1024);
	});
	it('returns the reframe url only when it is usable', () => {
		expect(reframeUrlOf({ reframe_url: 'https://r2.example.com/a.mp4' })).toBe('https://r2.example.com/a.mp4');
		expect(reframeUrlOf({ reframe_url: 'http://insecure.example.com/a.mp4' })).toBeNull();
		expect(reframeUrlOf({})).toBeNull();
		expect(reframeUrlOf({ reframe_url: '' })).toBeNull();
		expect(reframeUrlOf(null)).toBeNull();
	});
});

describe('reframe sync plan', () => {
	it('seeks only past the tolerance and follows play state', () => {
		expect(planReframeSync({ current: 1, target: 1.1, paused: false, wantPlaying: true })).toEqual({ seekTo: null, action: null });
		expect(planReframeSync({ current: 1, target: 2, paused: false, wantPlaying: true })).toEqual({ seekTo: 2, action: null });
		expect(planReframeSync({ current: 0, target: 0, paused: true, wantPlaying: true })).toEqual({ seekTo: null, action: 'play' });
		expect(planReframeSync({ current: 3, target: 3, paused: false, wantPlaying: false })).toEqual({ seekTo: null, action: 'pause' });
	});
});

describe('result panel toggling', () => {
	let host;
	beforeEach(() => {
		HTMLMediaElement.prototype.load = vi.fn();
		HTMLMediaElement.prototype.pause = vi.fn();
		HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
		host = document.createElement('div');
		document.body.replaceChildren(host);
	});
	it('starts hidden, shows with a reframe video, hides again', () => {
		const panel = createReframePanel(host);
		expect(host.hidden).toBe(true);
		panel.show('https://r2.example.com/reframe.mp4');
		expect(host.hidden).toBe(false);
		expect(host.querySelector('video').getAttribute('src')).toBe('https://r2.example.com/reframe.mp4');
		expect(host.textContent).toContain('What the tracker followed');
		panel.hide();
		expect(host.hidden).toBe(true);
		expect(host.querySelector('video')).toBeNull();
	});
	it('hides itself when the video fails to load, so no broken player stays', () => {
		const panel = createReframePanel(host);
		panel.show('https://r2.example.com/missing.mp4');
		host.querySelector('video').dispatchEvent(new Event('error'));
		expect(host.hidden).toBe(true);
		expect(panel.visible).toBe(false);
	});
	it('a result without reframe_url leaves the panel hidden', () => {
		const panel = createReframePanel(host);
		const url = reframeUrlOf({ clip_url: 'https://x/clip.json' });
		if (url) panel.show(url);
		else panel.hide();
		expect(host.hidden).toBe(true);
	});
});

describe('360 stage', () => {
	it('explains a raw .insv instead of uploading it', async () => {
		const parent = document.createElement('div');
		const host = document.createElement('div');
		parent.append(host);
		document.body.replaceChildren(parent);
		const onStart = vi.fn();
		const onCancel = vi.fn();
		const stage = createMotion360Stage(host, { onStart, onRegular: vi.fn(), onCancel });
		await stage.review({ name: 'VID_001.insv', size: 5 }, { kind: 'raw' });
		expect(host.hidden).toBe(false);
		expect(host.textContent).toContain('stitched 360 clip');
		expect(host.textContent).toContain('Insta360 Studio');
		expect(host.querySelector('a[href="/capture"]')).not.toBeNull();
		expect(onStart).not.toHaveBeenCalled();
		host.querySelector('button').click();
		expect(onCancel).toHaveBeenCalled();
		stage.hide();
		expect(host.hidden).toBe(true);
	});
	it('shows a designed subject-lost failure with the worker message and a retry', () => {
		const parent = document.createElement('div');
		const host = document.createElement('div');
		parent.append(host);
		document.body.replaceChildren(parent);
		const onRetry = vi.fn();
		const stage = createMotion360Stage(host, { onStart: vi.fn(), onRegular: vi.fn(), onCancel: vi.fn() });
		stage.failure({ title: 'We lost the person', text: 'The subject left the frame at 12 s.', retryLabel: 'Pick again', onRetry });
		expect(host.textContent).toContain('The subject left the frame at 12 s.');
		host.querySelector('.m360-btn--primary').click();
		expect(onRetry).toHaveBeenCalled();
	});
});
