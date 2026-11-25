import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findNewestMedia, mediaKind } from '../src/find-media.js';
import { MakeError, forgeModel, uploadImage } from '../src/make.js';
import { grabVideoFrame } from '../src/video-frame.js';

function scripted(steps) {
	const seen = [];
	const fetchImpl = async (url, init = {}) => {
		const step = steps[seen.length] ?? steps[steps.length - 1];
		seen.push({ url, init });
		const status = step.status ?? 200;
		return {
			ok: status < 400,
			status,
			async text() { return JSON.stringify(step.body ?? {}); },
		};
	};
	return { fetchImpl, seen };
}

function clock() {
	let t = 0;
	return {
		now: () => t,
		sleep: async (ms) => { t += ms; },
	};
}

describe('forgeModel', () => {
	it('refuses a prompt that is too short before any request', async () => {
		let called = false;
		await expect(forgeModel({
			prompt: 'no',
			fetchImpl: () => { called = true; },
		})).rejects.toThrow(/at least 3/);
		expect(called).toBe(false);
	});

	it('returns a model that finished inside the POST', async () => {
		const { fetchImpl, seen } = scripted([
			{ body: { status: 'done', glb_url: 'https://cdn.example/pot.glb', job_id: null } },
		]);
		const made = await forgeModel({ prompt: 'a ceramic teapot', fetchImpl, origin: 'https://three.ws' });
		expect(made.glbUrl).toBe('https://cdn.example/pot.glb');
		expect(seen).toHaveLength(1);
		expect(seen[0].url).toBe('https://three.ws/api/forge');
		expect(JSON.parse(seen[0].init.body)).toMatchObject({ prompt: 'a ceramic teapot', tier: 'draft' });
	});

	it('polls a queued job until the GLB is ready', async () => {
		const { fetchImpl, seen } = scripted([
			{ body: { status: 'pending', job_id: 'job-1', retry_after: 2 } },
			{ body: { status: 'running', job_id: 'job-1' } },
			{ body: { status: 'done', glb_url: 'https://cdn.example/chair.glb' } },
		]);
		const time = clock();
		const phases = [];
		const made = await forgeModel({
			prompt: 'a wooden chair',
			imageUrls: ['https://cdn.example/chair.jpg'],
			fetchImpl,
			origin: 'https://three.ws',
			now: time.now,
			sleep: time.sleep,
			onStatus: (ev) => phases.push(ev.phase),
		});
		expect(made.glbUrl).toBe('https://cdn.example/chair.glb');
		expect(seen[1].url).toContain('job=job-1');
		expect(seen).toHaveLength(3);
		expect(JSON.parse(seen[0].init.body).image_urls).toEqual(['https://cdn.example/chair.jpg']);
		expect(phases).toContain('done');
	});

	it('says how to sign in when the account is missing', async () => {
		const { fetchImpl } = scripted([{
			status: 401,
			body: {
				error: 'sign_in_required',
				message: 'Sign in to make a 3D model. A three.ws account is free.',
				sign_in_url: '/login',
				api_keys_url: '/dashboard/api-keys',
			},
		}]);
		const err = await forgeModel({ prompt: 'a brass bell', fetchImpl, origin: 'https://three.ws' }).catch((e) => e);
		expect(err).toBeInstanceOf(MakeError);
		expect(err.code).toBe('sign_in_required');
		expect(err.signInUrl).toBe('https://three.ws/login');
		expect(err.keysUrl).toBe('https://three.ws/dashboard/api-keys');
	});

	it('stops when the job fails', async () => {
		const { fetchImpl } = scripted([
			{ body: { status: 'pending', job_id: 'job-9' } },
			{ body: { status: 'failed', message: 'the photo has no subject' } },
		]);
		const time = clock();
		await expect(forgeModel({
			prompt: 'a red kettle',
			fetchImpl,
			now: time.now,
			sleep: time.sleep,
			maxWaitMs: 60_000,
		})).rejects.toThrow(/no subject/);
	});
});

describe('uploadImage', () => {
	it('presigns, puts the bytes, and returns the public URL', async () => {
		const bytes = new Uint8Array([1, 2, 3, 4]);
		const { fetchImpl, seen } = scripted([
			{ body: { upload_url: 'https://bucket.example/put', public_url: 'https://cdn.example/a.jpg', method: 'PUT' } },
			{ body: {} },
		]);
		const url = await uploadImage({
			bytes,
			contentType: 'image/jpeg',
			fetchImpl,
			origin: 'https://three.ws',
			apiKey: 'test-key',
		});
		expect(url).toBe('https://cdn.example/a.jpg');
		expect(seen[0].init.headers.authorization).toBe('Bearer test-key');
		expect(JSON.parse(seen[0].init.body)).toMatchObject({ content_type: 'image/jpeg', size_bytes: 4 });
		expect(seen[1].url).toBe('https://bucket.example/put');
		expect(seen[1].init.body).toBe(bytes);
	});

	it('rejects a photo that is too large before any request', async () => {
		let called = false;
		await expect(uploadImage({
			bytes: new Uint8Array(8 * 1024 * 1024 + 1),
			contentType: 'image/png',
			fetchImpl: () => { called = true; },
		})).rejects.toThrow(/8/);
		expect(called).toBe(false);
	});
});

describe('findNewestMedia', () => {
	it('picks the newest photo and can be asked for a video instead', () => {
		const dir = mkdtempSync(join(tmpdir(), 'tty-find-'));
		const older = join(dir, 'older.jpg');
		const newer = join(dir, 'newer.png');
		const clip = join(dir, 'clip.mp4');
		writeFileSync(older, 'a');
		writeFileSync(newer, 'b');
		writeFileSync(clip, 'c');
		const oldTime = new Date('2020-01-01T00:00:00Z');
		const newTime = new Date('2024-01-01T00:00:00Z');
		utimesSync(older, oldTime, oldTime);
		utimesSync(newer, newTime, newTime);
		utimesSync(clip, newTime, newTime);
		expect(findNewestMedia(dir, 'image')).toBe(newer);
		expect(findNewestMedia(dir, 'video')).toBe(clip);
		expect(mediaKind(newer)).toBe('image');
		expect(mediaKind(clip)).toBe('video');
		expect(findNewestMedia(join(dir, 'missing'), 'image')).toBeNull();
	});
});

describe('grabVideoFrame', () => {
	it('says ffmpeg is missing instead of inventing a frame', async () => {
		await expect(grabVideoFrame('/tmp/does-not-matter.mp4', { ffmpeg: 'three-tty-ffmpeg-missing' }))
			.rejects.toThrow(/ffmpeg is not installed/);
	});

	const ffmpeg = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
	it.skipIf(ffmpeg.status !== 0)('reads a jpeg from a clip shorter than the one second seek', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'tty-vid-'));
		const file = join(dir, 'short.mp4');
		const made = spawnSync('ffmpeg', [
			'-hide_banner', '-loglevel', 'error',
			'-f', 'lavfi', '-i', 'color=c=red:s=32x32:d=0.2',
			'-frames:v', '5',
			file,
		], { encoding: 'utf8' });
		expect(made.status, made.stderr).toBe(0);
		const frame = await grabVideoFrame(file);
		expect(frame[0]).toBe(0xff);
		expect(frame[1]).toBe(0xd8);
	});
});

const bin = join(import.meta.dirname, '../bin/three-tty.js');

function runCli(args, env = {}) {
	return spawnSync(process.execPath, [bin, ...args], {
		encoding: 'utf8',
		timeout: 15000,
		env: {
			...process.env,
			THREE_WS_API_KEY: '',
			THREE_WS_BASE: 'http://127.0.0.1:9',
			...env,
		},
	});
}

describe('three-tty make flags', () => {
	it('prints prompt and find in the help', () => {
		const result = runCli(['--help']);
		expect(result.status).toBe(0);
		expect(result.stdout).toMatch(/--prompt/);
		expect(result.stdout).toMatch(/--find/);
	});

	it('rejects a short prompt before any network call', () => {
		const result = runCli(['--prompt', 'no', '--once'], { THREE_WS_API_KEY: 'test' });
		expect(result.status).toBe(1);
		expect(result.stderr).toMatch(/at least 3/);
		expect(result.stderr).not.toMatch(/ECONNREFUSED|ENOTFOUND|fetch failed/i);
	});

	it('says the folder has no photo before it asks for a key', () => {
		const dir = mkdtempSync(join(tmpdir(), 'tty-empty-'));
		const result = runCli(['--find', dir]);
		expect(result.status).toBe(1);
		expect(result.stderr).toMatch(/no photo or video/);
		expect(result.stderr).not.toMatch(/THREE_WS_API_KEY/);
	});

	it('names the photo it found, then asks for a key, and does not upload', () => {
		const dir = mkdtempSync(join(tmpdir(), 'tty-jpg-'));
		writeFileSync(join(dir, 'pot.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
		const result = runCli([dir]);
		expect(result.status).toBe(1);
		expect(result.stderr).toMatch(/using .*pot\.jpg/);
		expect(result.stderr).toMatch(/THREE_WS_API_KEY/);
		expect(result.stderr).not.toMatch(/ECONNREFUSED|reading one frame/);
	});

	it('uses a video when the folder has no photo', () => {
		const dir = mkdtempSync(join(tmpdir(), 'tty-onlyvid-'));
		writeFileSync(join(dir, 'clip.mp4'), Buffer.from('not a real video'));
		const result = runCli(['--find', dir]);
		expect(result.status).toBe(1);
		expect(result.stderr).toMatch(/using .*clip\.mp4/);
		expect(result.stderr).toMatch(/THREE_WS_API_KEY/);
		expect(result.stderr).not.toMatch(/reading one frame/);
	});

	it('with --video and no file, picks the newest video and ignores photos', () => {
		const dir = mkdtempSync(join(tmpdir(), 'tty-pickvid-'));
		writeFileSync(join(dir, 'pot.jpg'), Buffer.from([0xff, 0xd8]));
		writeFileSync(join(dir, 'clip.mp4'), Buffer.from('clip'));
		const result = runCli(['--find', '--video', dir]);
		expect(result.status).toBe(1);
		expect(result.stderr).toMatch(/clip\.mp4/);
		expect(result.stderr).not.toMatch(/pot\.jpg/);
	});

	it('refuses a scene and a prompt together', () => {
		const result = runCli(['--scene', 'donut', '--prompt', 'a ceramic teapot'], { THREE_WS_API_KEY: 'test' });
		expect(result.status).toBe(1);
		expect(result.stderr).toMatch(/not both/);
	});

	it('refuses a model file passed beside a prompt', () => {
		const dir = mkdtempSync(join(tmpdir(), 'tty-glb-'));
		const glb = join(dir, 'model.glb');
		writeFileSync(glb, 'not a glb');
		const result = runCli([glb, '--prompt', 'a ceramic teapot']);
		expect(result.status).toBe(1);
		expect(result.stderr).toMatch(/not a photo or a video/);
		expect(result.stderr).not.toMatch(/could not load/);
	});
});

describe('tty page wiring', () => {
	it('offers a prompt, a photo, and a video on the page', () => {
		const html = readFileSync(join(import.meta.dirname, '../../../pages/tty.html'), 'utf8');
		expect(html).toContain('id="make-prompt"');
		expect(html).toContain('id="make-photo"');
		expect(html).toContain('id="make-video"');
		expect(html).toContain('id="make-status"');
		const page = readFileSync(join(import.meta.dirname, '../../../src/tty-page.js'), 'utf8');
		expect(page).toContain("from '../packages/tty-3d/src/make.js'");
		expect(page).not.toContain('find-media');
		expect(page).not.toContain('video-frame');
	});
});
