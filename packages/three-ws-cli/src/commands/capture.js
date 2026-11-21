// 360 capture from the terminal: footage from any 360 camera (works with
// Insta360 cameras, raw .insv and .insp included) in, owned 3D files out.
//
//   three-ws capture 360 <file...> [--quality preview|standard|high]
//                                  [--trim-start <s>] [--trim-end <s>] [--wait] [--out <dir>]
//   three-ws capture status <job> [--wait] [--out <dir>]
//   three-ws capture list
//   three-ws capture scene <photo|https-url> [--wait] [--out <dir>]
//
// Local files go to storage through the resumable multipart upload
// (POST /api/capture-upload/{create,sign,parts,complete}, contract C4 in
// prompts/finish/_context/insta360-00-CONTEXT.md): parts are read from disk and
// PUT straight to presigned storage URLs, several at a time, each retried with
// backoff. Progress is saved after every part under the CLI config dir, keyed by
// the file's path, size and modification time, so rerunning the same command
// after a dropped connection or a Ctrl+C uploads only the parts still missing.
// The upload then starts a job (POST /api/pano-capture or /api/pano-scene);
// with --wait the command polls it on one live line and downloads the results
// (PLY, SPZ, preview flythrough and poster; or GLB and PLY for a scene) into
// --out.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { c, line, rows, sym, printJson, tildify } from '../ui.js';
import { bearerFor } from '../oauth.js';
import { requestJson, ApiError, USER_AGENT } from '../http.js';
import { configDir } from '../paths.js';
import { CliError, EXIT_CODES } from '../automation.js';

export const QUALITIES = ['preview', 'standard', 'high'];
export const PART_CONCURRENCY = 4;
export const PART_ATTEMPTS = 5;
const SIGN_BATCH = 100;
const PART_TIMEOUT_MS = 10 * 60_000;
// The completed upload's source_url is signed for 7 days; reuse it for 6.
const SOURCE_URL_REUSE_MS = 6 * 24 * 3600_000;
const CAPTURE_POLL_MS = 15_000;
const SCENE_POLL_MS = 5_000;
const DOWNLOAD_TIMEOUT_MS = 60 * 60_000;

const FILE_TYPES = {
	'.mp4': { content_type: 'video/mp4', capture: 'equirect_video' },
	'.m4v': { content_type: 'video/mp4', capture: 'equirect_video' },
	'.mov': { content_type: 'video/quicktime', capture: 'equirect_video' },
	'.jpg': { content_type: 'image/jpeg', capture: 'equirect_images', scene: 'equirect_image' },
	'.jpeg': { content_type: 'image/jpeg', capture: 'equirect_images', scene: 'equirect_image' },
	'.png': { content_type: 'image/png', capture: 'equirect_images', scene: 'equirect_image' },
	'.exr': { content_type: 'image/x-exr', capture: 'equirect_images' },
	'.insv': { content_type: 'application/octet-stream', capture: 'insv' },
	'.insp': { content_type: 'application/octet-stream', capture: 'insp', scene: 'insp' },
};

const CAPTURE_FILES = [
	['ply_url', 'scene.ply'],
	['spz_url', 'scene.spz'],
	['preview_url', 'preview.mp4'],
	['poster_url', 'poster.jpg'],
];
const SCENE_FILES = [
	['glb_url', 'scene.glb'],
	['ply_url', 'scene.ply'],
];

const usage = (message) => new CliError(EXIT_CODES.USAGE, 'usage', message);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Poll interval: the default, or THREE_WS_CAPTURE_POLL_SECONDS (0.1 or more) for scripts that want another pace. */
function pollMs(ctx, fallback) {
	const secs = Number(ctx.env.vars?.THREE_WS_CAPTURE_POLL_SECONDS);
	return Number.isFinite(secs) && secs >= 0.1 ? Math.round(secs * 1000) : fallback;
}

async function authed(ctx) {
	const bearer = await bearerFor(ctx.env, { origin: ctx.origin });
	if (!bearer) throw new ApiError('sign in first: `npx three-ws login` (or set THREE_WS_API_KEY)', { code: 'login_required' });
	return { authorization: `Bearer ${bearer}` };
}

function api(ctx, auth, pathname, opts = {}) {
	return requestJson(`${ctx.origin}${pathname}`, { ...opts, headers: { ...auth, ...(opts.headers || {}) } });
}

function absolute(ctx, url) {
	return typeof url === 'string' && url.startsWith('/') ? `${ctx.origin}${url}` : url;
}

/** Diagnostics go to stderr so --json keeps stdout to one document. */
function note(text) {
	process.stderr.write(`${text}\n`);
}

// ── progress line ─────────────────────────────────────────────────────────────

function progressLine() {
	const isTTY = Boolean(process.stderr.isTTY);
	let last = '';
	return {
		update(text) {
			if (text === last) return;
			last = text;
			if (isTTY) process.stderr.write(`\r\x1b[2K${text}`);
			else note(text);
		},
		done() {
			if (isTTY && last) process.stderr.write('\n');
			last = '';
		},
	};
}

function bytes(n) {
	if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
	if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
	if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${n} B`;
}

// ── file classification ───────────────────────────────────────────────────────

export function classifyFile(file) {
	const ext = path.extname(file).toLowerCase();
	if (ext === '.lrv') {
		throw usage(`${path.basename(file)} is the camera's low-resolution proxy. Use the .insv with the same name beside it instead.`);
	}
	const type = FILE_TYPES[ext];
	if (!type) {
		throw usage(`${path.basename(file)}: unsupported file type. Use a 360 video (.mp4, .mov, .insv) or 360 photos (.jpg, .png, .exr, .insp).`);
	}
	return { ext, ...type };
}

/** The capture source_kind for a set of files, or a usage error for a mix that cannot be one capture. */
export function captureKind(files) {
	const kinds = [...new Set(files.map((f) => classifyFile(f).capture))];
	if (kinds.length > 1) throw usage('Pass one kind of footage per capture: one video, a pair of .insv files, or a set of 360 photos.');
	const kind = kinds[0];
	if (kind === 'equirect_video' && files.length > 1) throw usage('Pass one 360 video per capture.');
	if (kind === 'insv' && files.length > 2) throw usage('Pass one .insv file, or the two files of a split-lens recording.');
	if (kind === 'insp' && files.length > 1) throw usage('Pass one .insp photo, or stitched 360 photos (.jpg) for a multi-photo capture.');
	return kind;
}

// ── resumable upload state ────────────────────────────────────────────────────

function statePath(env) {
	return path.join(configDir(env), 'capture-uploads.json');
}

function readState(env) {
	try {
		const data = JSON.parse(fs.readFileSync(statePath(env), 'utf8'));
		return data && typeof data === 'object' && data.uploads ? data : { uploads: {} };
	} catch {
		return { uploads: {} };
	}
}

function writeState(env, state) {
	const file = statePath(env);
	fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
	const tmp = `${file}.${process.pid}.tmp`;
	fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
	fs.renameSync(tmp, file);
}

/** One upload's resume key: the file's absolute path, size and mtime, plus the server it went to. */
export function uploadKey(origin, absPath, stat) {
	return createHash('sha256').update(`${origin}\n${absPath}\n${stat.size}\n${Math.round(stat.mtimeMs)}`).digest('hex').slice(0, 32);
}

function saveEntry(env, key, entry) {
	const state = readState(env);
	if (entry) state.uploads[key] = entry;
	else delete state.uploads[key];
	writeState(env, state);
}

// ── multipart upload ──────────────────────────────────────────────────────────

async function readPart(handle, partSize, partNumber, total) {
	const start = (partNumber - 1) * partSize;
	const length = Math.min(partSize, total - start);
	const buf = Buffer.allocUnsafe(length);
	let off = 0;
	while (off < length) {
		const { bytesRead } = await handle.read(buf, off, length - off, start + off);
		if (bytesRead === 0) throw new CliError(EXIT_CODES.ERROR, 'file_changed', 'The file got shorter while it was uploading. Run the command again.');
		off += bytesRead;
	}
	return buf;
}

async function putPart(url, body) {
	let res;
	try {
		res = await fetch(url, {
			method: 'PUT',
			body,
			headers: { 'user-agent': USER_AGENT, 'content-length': String(body.length) },
			signal: AbortSignal.timeout(PART_TIMEOUT_MS),
		});
	} catch (err) {
		return { ok: false, retry: true, reason: err?.name === 'TimeoutError' ? 'timed out' : err?.cause?.code || err?.message || 'network error' };
	}
	await res.arrayBuffer().catch(() => null);
	const etag = res.headers.get('etag');
	if (res.ok && etag) return { ok: true, etag };
	if (res.ok) return { ok: false, retry: false, reason: 'storage accepted the part but sent no ETag' };
	// 403 is an expired or revoked signature: sign again before retrying.
	return { ok: false, retry: res.status === 403 || res.status === 408 || res.status === 429 || res.status >= 500, resign: res.status === 403, reason: `storage answered ${res.status}` };
}

async function signParts(ctx, auth, entry, numbers) {
	const urls = {};
	for (let i = 0; i < numbers.length; i += SIGN_BATCH) {
		const batch = numbers.slice(i, i + SIGN_BATCH);
		const out = await api(ctx, auth, '/api/capture-upload/sign', {
			method: 'POST',
			json: { upload_id: entry.upload_id, key: entry.key, part_numbers: batch },
		});
		Object.assign(urls, out?.urls || {});
	}
	return urls;
}

/** Parts the server already holds for a resumed upload; null when the upload is gone. */
async function storedParts(ctx, auth, entry) {
	try {
		const out = await api(ctx, auth, '/api/capture-upload/parts', { method: 'POST', json: { upload_id: entry.upload_id, key: entry.key } });
		return Object.fromEntries((out?.parts || []).map((p) => [String(p.part_number), p.etag]));
	} catch (err) {
		if (err instanceof ApiError && err.status === 404 && err.code === 'upload_not_found') return null;
		// A deployment without the parts listing: trust the parts this machine recorded.
		if (err instanceof ApiError && err.status === 404) return entry.parts || {};
		throw err;
	}
}

async function uploadMissingParts(ctx, auth, file, stat, entry, saveProgress, progress) {
	const missing = [];
	for (let n = 1; n <= entry.part_count; n++) if (!entry.parts[String(n)]) missing.push(n);
	if (!missing.length) return;
	const name = path.basename(file);
	let urls = await signParts(ctx, auth, entry, missing);
	const partBytes = (n) => Math.min(entry.part_size, stat.size - (n - 1) * entry.part_size);
	let done = Object.keys(entry.parts).reduce((sum, n) => sum + partBytes(Number(n)), 0);
	const started = Date.now();
	const startedBytes = done;
	const show = () => {
		const pct = Math.floor((done / stat.size) * 100);
		const secs = Math.max(1, (Date.now() - started) / 1000);
		const rate = (done - startedBytes) / secs;
		progress.update(`${sym.arrow} uploading ${name}: ${pct}% of ${bytes(stat.size)}${rate > 0 ? `, ${bytes(rate)}/s` : ''}`);
	};
	show();
	const handle = await fsp.open(file, 'r');
	try {
		const queue = [...missing];
		let failure = null;
		// After one part fails for good, start no new parts but let the ones in
		// flight finish, so every byte already sent is recorded for the resume.
		const worker = async () => {
			while (queue.length && !failure) {
				const n = queue.shift();
				const body = await readPart(handle, entry.part_size, n, stat.size);
				let result;
				for (let attempt = 1; attempt <= PART_ATTEMPTS; attempt++) {
					result = await putPart(urls[String(n)], body);
					if (result.ok || !result.retry) break;
					if (result.resign) urls = { ...urls, ...(await signParts(ctx, auth, entry, [n])) };
					if (attempt < PART_ATTEMPTS) await sleep(Math.min(16_000, 1000 * 2 ** (attempt - 1)));
				}
				if (!result.ok) {
					failure ||= { n, reason: result.reason };
					return;
				}
				entry.parts[String(n)] = result.etag;
				saveProgress();
				done += body.length;
				show();
			}
		};
		await Promise.all(Array.from({ length: Math.min(PART_CONCURRENCY, missing.length) }, worker));
		if (failure) {
			progress.done();
			throw new CliError(
				EXIT_CODES.NETWORK,
				'upload_failed',
				`Part ${failure.n} of ${name} did not upload (${failure.reason}). Run the same command again to resume: the ${Object.keys(entry.parts).length} of ${entry.part_count} finished parts are kept.`,
			);
		}
	} finally {
		await handle.close();
	}
}

/**
 * Upload one local file through C4 and return `{ source_url, size_bytes, resumed, reused }`.
 * Resumes a matching unfinished upload, and reuses a finished one whose URL is still valid.
 */
export async function uploadFile(ctx, auth, file, progress = progressLine()) {
	const abs = path.resolve(ctx.env.cwd || process.cwd(), file);
	let stat;
	try {
		stat = await fsp.stat(abs);
	} catch {
		throw usage(`${file}: no such file.`);
	}
	if (!stat.isFile()) throw usage(`${file} is not a file.`);
	if (stat.size === 0) throw usage(`${file} is empty.`);
	const type = classifyFile(abs);
	const key = uploadKey(ctx.origin, abs, stat);
	let entry = readState(ctx.env).uploads[key] || null;

	if (entry?.source_url && Date.now() - (entry.completed_at || 0) < SOURCE_URL_REUSE_MS) {
		return { file: abs, source_url: entry.source_url, size_bytes: stat.size, resumed: false, reused: true };
	}
	let resumed = false;
	if (entry && !entry.source_url) {
		const parts = await storedParts(ctx, auth, entry);
		if (parts) {
			entry.parts = parts;
			resumed = true;
		} else {
			entry = null;
		}
	}
	if (!entry || entry.source_url) {
		const created = await api(ctx, auth, '/api/capture-upload/create', {
			method: 'POST',
			json: { filename: path.basename(abs), content_type: type.content_type, size_bytes: stat.size, kind: 'pano' },
		});
		entry = { file: abs, size_bytes: stat.size, upload_id: created.upload_id, key: created.key, part_size: created.part_size, part_count: created.part_count, parts: {}, started_at: Date.now() };
		saveEntry(ctx.env, key, entry);
	}
	await uploadMissingParts(ctx, auth, abs, stat, entry, () => saveEntry(ctx.env, key, entry), progress);
	const parts = Object.entries(entry.parts)
		.map(([n, etag]) => ({ part_number: Number(n), etag }))
		.sort((a, b) => a.part_number - b.part_number);
	progress.update(`${sym.arrow} finishing ${path.basename(abs)}`);
	let completed;
	try {
		completed = await api(ctx, auth, '/api/capture-upload/complete', { method: 'POST', json: { upload_id: entry.upload_id, key: entry.key, parts } });
	} catch (err) {
		// The server discarded the object (size mismatch) or the upload expired: start clean next time.
		if (err instanceof ApiError && (err.code === 'size_mismatch' || err.code === 'upload_not_found')) saveEntry(ctx.env, key, null);
		throw err;
	}
	progress.done();
	saveEntry(ctx.env, key, { file: abs, size_bytes: stat.size, source_url: completed.source_url, completed_at: Date.now() });
	return { file: abs, source_url: completed.source_url, size_bytes: completed.size_bytes ?? stat.size, resumed, reused: false };
}

// ── polling and downloads ─────────────────────────────────────────────────────

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);

async function pollJob(ctx, auth, pathname, job, intervalMs, label) {
	const progress = progressLine();
	try {
		for (;;) {
			let data;
			try {
				data = await api(ctx, auth, `${pathname}?job=${encodeURIComponent(job)}`);
			} catch (err) {
				// A rate limit or a passing network fault is not the job's failure: wait and ask again.
				if (err instanceof ApiError && (err.status === 0 || err.status === 429 || err.status >= 502)) {
					progress.update(`${sym.warn} ${label}: ${err.status === 429 ? 'rate limited' : 'server unreachable'}, retrying`);
					await sleep(intervalMs * 2);
					continue;
				}
				throw err;
			}
			const pct = Number.isFinite(Number(data?.progress)) ? `${Math.round(Number(data.progress) * 100)}%` : '';
			progress.update(`${sym.arrow} ${label} ${data?.status || 'unknown'}${data?.stage ? `, ${data.stage}` : ''}${pct ? `, ${pct}` : ''}`);
			if (TERMINAL.has(data?.status)) return data;
			await sleep(intervalMs);
		}
	} finally {
		progress.done();
	}
}

async function download(url, dest) {
	let res;
	try {
		// Result URLs may redirect to signed storage, so follow redirects here.
		res = await fetch(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
	} catch (err) {
		throw new ApiError(`could not download ${path.basename(dest)}: ${err?.cause?.code || err?.message || 'network error'}`, { code: 'download_failed' });
	}
	if (!res.ok || !res.body) throw new ApiError(`download failed: ${res.status} for ${path.basename(dest)}`, { status: res.status, code: 'download_failed' });
	const tmp = `${dest}.part`;
	await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
	await fsp.rename(tmp, dest);
	return (await fsp.stat(dest)).size;
}

async function downloadResults(ctx, result, files, outDir) {
	const dir = path.resolve(ctx.env.cwd || process.cwd(), outDir);
	await fsp.mkdir(dir, { recursive: true });
	const saved = [];
	for (const [field, name] of files) {
		const url = absolute(ctx, result?.[field]);
		if (!url) continue;
		const dest = path.join(dir, name);
		const size = await download(url, dest);
		saved.push({ field, path: dest, bytes: size });
	}
	return saved;
}

function finishedJob(ctx, data) {
	const result = data?.result
		? Object.fromEntries(Object.entries(data.result).map(([k, v]) => [k, k.endsWith('_url') ? absolute(ctx, v) : v]))
		: undefined;
	return { ...data, ...(result ? { result } : {}) };
}

function printResult(job, files, saved) {
	const failed = job.status === 'failed' || job.status === 'cancelled';
	line(`${failed ? c.red(sym.fail) : c.green(sym.ok)} ${job.job_id}: ${job.status}${job.error?.message ? `. ${job.error.message}` : ''}`);
	if (job.result) {
		const pairs = files.filter(([field]) => job.result[field]).map(([field, name]) => [name, job.result[field]]);
		if (job.result.viewer_url) pairs.unshift(['viewer', job.result.viewer_url]);
		if (pairs.length) rows(pairs, '  ');
	}
	if (saved?.length) {
		line(c.bold('Saved'));
		rows(saved.map((s) => [path.basename(s.path), `${tildify(s.path)} (${bytes(s.bytes)})`]), '  ');
	}
}

function exitFor(job) {
	return job.status === 'succeeded' ? EXIT_CODES.OK : EXIT_CODES.ERROR;
}

async function waitAndCollect(ctx, auth, { pathname, job, intervalMs, label, files, defaultOut }) {
	const data = finishedJob(ctx, await pollJob(ctx, auth, pathname, job, intervalMs, label));
	let saved = [];
	if (data.status === 'succeeded' && data.result) saved = await downloadResults(ctx, data.result, files, ctx.flags.out || defaultOut);
	return { job: data, saved };
}

function outName(prefix, job) {
	return `${prefix}-${String(job).replace(/[^A-Za-z0-9]/g, '').slice(0, 12)}`;
}

function seconds(flag, name) {
	if (flag === undefined) return undefined;
	const n = Number(flag);
	if (!Number.isFinite(n) || n < 0) throw usage(`--${name} must be a number of seconds, 0 or more.`);
	return n;
}

// ── subcommands ───────────────────────────────────────────────────────────────

async function capture360(ctx) {
	const files = ctx.positionals;
	if (!files.length) throw usage('usage: three-ws capture 360 <file...> [--quality preview|standard|high] [--trim-start <s>] [--trim-end <s>] [--wait] [--out <dir>]');
	const kind = captureKind(files);
	const quality = ctx.flags.quality || 'standard';
	if (!QUALITIES.includes(quality)) throw usage('--quality must be preview, standard or high.');
	const start = seconds(ctx.flags['trim-start'], 'trim-start');
	const end = seconds(ctx.flags['trim-end'], 'trim-end');
	if ((start !== undefined || end !== undefined) && !['equirect_video', 'insv'].includes(kind)) throw usage('--trim-start and --trim-end apply to video only.');
	if (start !== undefined && end !== undefined && end <= start) throw usage('--trim-end must be later than --trim-start.');
	const auth = await authed(ctx);

	const uploads = [];
	for (const file of files) {
		const up = await uploadFile(ctx, auth, file);
		if (!ctx.flags.json) note(`${c.green(sym.ok)} ${path.basename(up.file)} ${up.reused ? 'already uploaded' : up.resumed ? 'upload resumed and finished' : 'uploaded'} (${bytes(up.size_bytes)})`);
		uploads.push(up);
	}

	const body = { source_url: uploads[0].source_url, source_kind: kind, quality };
	if (uploads.length > 1) body.source_urls = uploads.map((u) => u.source_url);
	if (start !== undefined || end !== undefined) body.trim = { ...(start !== undefined ? { start_s: start } : {}), ...(end !== undefined ? { end_s: end } : {}) };
	const started = await api(ctx, auth, '/api/pano-capture', { method: 'POST', json: body });
	const summary = {
		job_id: started.job_id,
		status: started.status || 'queued',
		source_kind: kind,
		quality,
		...(started.eta_seconds != null ? { eta_seconds: started.eta_seconds } : {}),
		uploads: uploads.map((u) => ({ file: u.file, size_bytes: u.size_bytes, resumed: u.resumed, reused: u.reused })),
	};

	if (!ctx.flags.wait) {
		if (ctx.flags.json) printJson(summary);
		else {
			line(`${c.green(sym.ok)} capture started: ${c.bold(summary.job_id)} (${quality}${summary.eta_seconds ? `, about ${Math.round(summary.eta_seconds / 60)} min` : ''})`);
			line(c.dim(`  check it: three-ws capture status ${summary.job_id} --wait`));
		}
		return EXIT_CODES.OK;
	}
	const { job, saved } = await waitAndCollect(ctx, auth, {
		pathname: '/api/pano-capture',
		job: summary.job_id,
		intervalMs: pollMs(ctx, CAPTURE_POLL_MS),
		label: '360 capture',
		files: CAPTURE_FILES,
		defaultOut: outName('capture', summary.job_id),
	});
	if (ctx.flags.json) printJson({ ...summary, ...job, files: saved });
	else printResult(job, CAPTURE_FILES, saved);
	return exitFor(job);
}

async function captureStatus(ctx) {
	const [job] = ctx.positionals;
	if (!job) throw usage('usage: three-ws capture status <job> [--wait] [--out <dir>]');
	const auth = await authed(ctx);
	if (ctx.flags.wait) {
		const out = await waitAndCollect(ctx, auth, { pathname: '/api/pano-capture', job, intervalMs: pollMs(ctx, CAPTURE_POLL_MS), label: '360 capture', files: CAPTURE_FILES, defaultOut: outName('capture', job) });
		if (ctx.flags.json) printJson({ ...out.job, files: out.saved });
		else printResult(out.job, CAPTURE_FILES, out.saved);
		return exitFor(out.job);
	}
	const data = finishedJob(ctx, await api(ctx, auth, `/api/pano-capture?job=${encodeURIComponent(job)}`));
	let saved = [];
	if (ctx.flags.out && data.status === 'succeeded' && data.result) saved = await downloadResults(ctx, data.result, CAPTURE_FILES, ctx.flags.out);
	if (ctx.flags.json) printJson({ ...data, ...(saved.length ? { files: saved } : {}) });
	else if (TERMINAL.has(data.status)) printResult(data, CAPTURE_FILES, saved);
	else line(`${sym.arrow} ${data.job_id || job}: ${data.status}${data.stage ? `, ${data.stage}` : ''}${Number.isFinite(Number(data.progress)) ? `, ${Math.round(Number(data.progress) * 100)}%` : ''}`);
	return data.status === 'failed' || data.status === 'cancelled' ? EXIT_CODES.ERROR : EXIT_CODES.OK;
}

async function captureList(ctx) {
	const auth = await authed(ctx);
	const data = await api(ctx, auth, '/api/pano-capture?mine=1');
	const captures = (data?.captures || []).map((cap) => ({ ...cap, poster_url: absolute(ctx, cap.poster_url), viewer_url: absolute(ctx, cap.viewer_url) }));
	if (ctx.flags.json) {
		printJson({ captures });
		return EXIT_CODES.OK;
	}
	if (!captures.length) {
		line('No 360 captures yet. Start one: three-ws capture 360 <file> --wait');
		return EXIT_CODES.OK;
	}
	rows(captures.map((cap) => [cap.job_id, [cap.status, cap.source_kind, cap.created_at, cap.viewer_url].filter(Boolean).join('  ')]));
	return EXIT_CODES.OK;
}

async function captureScene(ctx) {
	const [photo] = ctx.positionals;
	if (!photo || ctx.positionals.length > 1) throw usage('usage: three-ws capture scene <photo|https-url> [--wait] [--out <dir>]');
	const auth = await authed(ctx);
	let imageUrl;
	let kind;
	let upload;
	if (/^https:\/\//i.test(photo)) {
		imageUrl = photo;
		kind = /\.insp(\?|#|$)/i.test(new URL(photo).pathname) ? 'insp' : 'equirect_image';
	} else {
		const type = classifyFile(photo);
		if (!type.scene) throw usage(`${path.basename(photo)}: a scene needs one 360 photo (.jpg, .png or .insp). For video use: three-ws capture 360 <file>`);
		kind = type.scene;
		upload = await uploadFile(ctx, auth, photo);
		imageUrl = upload.source_url;
	}
	const started = await api(ctx, auth, '/api/pano-scene', { method: 'POST', json: { image_url: imageUrl, source_kind: kind } });
	const summary = {
		job_id: started.job_id,
		status: started.status || 'queued',
		source_kind: kind,
		...(upload ? { upload: { file: upload.file, size_bytes: upload.size_bytes, resumed: upload.resumed, reused: upload.reused } } : {}),
	};
	if (!ctx.flags.wait) {
		if (ctx.flags.json) printJson(summary);
		else {
			line(`${c.green(sym.ok)} scene started: ${c.bold(summary.job_id)}`);
			line(c.dim('  usually 1 to 5 minutes; rerun with --wait to watch it and save the GLB and PLY'));
		}
		return EXIT_CODES.OK;
	}
	const { job, saved } = await waitAndCollect(ctx, auth, {
		pathname: '/api/pano-scene',
		job: summary.job_id,
		intervalMs: pollMs(ctx, SCENE_POLL_MS),
		label: '360 scene',
		files: SCENE_FILES,
		defaultOut: outName('scene', summary.job_id),
	});
	if (ctx.flags.json) printJson({ ...summary, ...job, files: saved });
	else printResult(job, SCENE_FILES, saved);
	return exitFor(job);
}

export async function capture(ctx) {
	const [sub, ...rest] = ctx.positionals;
	const next = { ...ctx, positionals: rest };
	if (sub === '360') return capture360(next);
	if (sub === 'status') return captureStatus(next);
	if (sub === 'list') return captureList(next);
	if (sub === 'scene') return captureScene(next);
	throw usage('usage: three-ws capture <360 <file...>|status <job>|list|scene <photo>>');
}
