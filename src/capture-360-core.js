// Pure logic for the /capture 360 mode: what a dropped file is, how a trim is
// sent, how long a job takes, which stage a worker report maps to, and what to
// tell a visitor for each error. No DOM and no network here, so all of it is
// unit-tested in node (tests/capture-360.test.js). The page wiring lives in
// capture-360.js.

export const RAW_EXTENSIONS = ['.insv', '.insp', '.lrv'];
export const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.m4v'];
export const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.exr'];

export const QUALITIES = ['preview', 'standard', 'high'];
export const MIN_TRIM_SECONDS = 2;
export const MIN_PHOTOS = 3;
export const RECOMMENDED_PHOTOS = 20;

export function fileExt(name) {
	const m = /\.[^./\\]+$/.exec(String(name || '').toLowerCase());
	return m ? m[0] : '';
}

export const isRawName = (name) => RAW_EXTENSIONS.includes(fileExt(name));
export const isVideoName = (name) => VIDEO_EXTENSIONS.includes(fileExt(name));
export const isImageName = (name) => IMAGE_EXTENSIONS.includes(fileExt(name));

/** An equirectangular frame is twice as wide as it is tall. A little slack covers odd encoder padding. */
export function isEquirectRatio(width, height, tolerance = 0.02) {
	if (!(width > 0) || !(height > 0)) return false;
	return Math.abs(width / height - 2) <= tolerance;
}

// Insta360 names split-lens recordings VID_YYYYMMDD_HHMMSS_00_NNN.insv and
// VID_YYYYMMDD_HHMMSS_10_NNN.insv (one file per lens); the same scheme holds for
// .lrv low-resolution proxies and for IMG_..._00_NNN.insp photos.
const LENS_RE = /^(.*_)(00|10)(_\d+\.[a-z0-9]+)$/i;

/** The lens-pair stem of an Insta360 file name, or null when the name is not in that scheme. */
export function lensInfo(name) {
	const m = LENS_RE.exec(String(name || ''));
	return m ? { stem: `${m[1]}__${m[3]}`.toLowerCase(), lens: m[2] } : null;
}

/** The name the other lens's file would have, for the "choose the matching file" prompt. */
export function matchingLensName(name) {
	const m = LENS_RE.exec(String(name || ''));
	if (!m) return null;
	return `${m[1]}${m[2] === '00' ? '10' : '00'}${m[3]}`;
}

/**
 * Classify what was dropped or picked.
 *
 * `probe` supplies the pixel size of a media file (`{ width, height }`) so this
 * stays testable without a DOM: `probe.video(file)` reads a video element's
 * metadata, `probe.image(file)` an image's natural size.
 *
 * @returns {Promise<{ok:true, sourceKind:string, main:File, files:File[], second?:File, warnings:string[], width?:number, height?:number}
 *   | {ok:false, code:string, message:string, files:File[]}>}
 */
export async function classifyFiles(files, probe = {}) {
	const list = Array.from(files || []);
	const fail = (code, message) => ({ ok: false, code, message, files: list });
	if (!list.length) return fail('no_file', 'Choose a file to begin.');

	const raw = list.filter((f) => isRawName(f.name));
	const videos = list.filter((f) => isVideoName(f.name) || (f.type || '').startsWith('video/'));
	const images = list.filter((f) => isImageName(f.name) || /^image\/(jpeg|png|x-exr)$/.test(f.type || ''));
	const known = new Set([...raw, ...videos, ...images]);
	if (list.some((f) => !known.has(f))) {
		return fail('unsupported_file', 'That file type is not supported. Use an .insv or .insp file, or a 360 video or photo from any 360 camera.');
	}
	if ([raw, videos, images].filter((g) => g.length).length > 1) {
		return fail('mixed_files', 'Choose one kind of file at a time: a recording, a video, or a set of photos.');
	}

	if (raw.length) {
		const photos = raw.filter((f) => fileExt(f.name) === '.insp');
		if (photos.length) {
			if (photos.length !== raw.length || photos.length > 1) {
				return fail('mixed_files', 'Choose a single .insp photo, or a recording made of .insv files.');
			}
			return { ok: true, sourceKind: 'insp', main: photos[0], files: photos, warnings: [] };
		}
		if (raw.length === 1) {
			const warnings = [];
			if (fileExt(raw[0].name) === '.lrv') {
				warnings.push('A .lrv file is the camera’s low-resolution proxy. It works, but the matching .insv gives a much sharper scene.');
			}
			return { ok: true, sourceKind: 'insv', main: raw[0], files: raw, warnings };
		}
		if (raw.length === 2) {
			const [a, b] = raw.map((f) => ({ f, info: lensInfo(f.name) }));
			if (a.info && b.info && a.info.stem === b.info.stem && a.info.lens !== b.info.lens) {
				const lens00 = a.info.lens === '00' ? a.f : b.f;
				const lens10 = a.info.lens === '00' ? b.f : a.f;
				return { ok: true, sourceKind: 'insv', main: lens00, second: lens10, files: [lens00, lens10], warnings: [] };
			}
			return fail('unpaired_files', 'Those two files are not the two lenses of one recording. Choose the _00_ and _10_ files that share the rest of their name.');
		}
		return fail('mixed_files', 'Choose one recording: a single .insv file, or the _00_ and _10_ pair.');
	}

	if (videos.length) {
		if (videos.length > 1) return fail('too_many_videos', 'Choose one video at a time.');
		const file = videos[0];
		let dims = null;
		try {
			dims = probe.video ? await probe.video(file) : null;
		} catch {
			dims = null;
		}
		if (!dims) {
			return fail('unreadable_video', 'This browser could not read that video’s size. Re-export it as H.264 MP4, or use Standard video.');
		}
		if (!isEquirectRatio(dims.width, dims.height)) {
			return fail('not_equirect', `That video is ${dims.width} by ${dims.height}, not a 2:1 equirectangular 360 video. Export it from your camera app as a 360 video, or use Standard video for flat footage.`);
		}
		return { ok: true, sourceKind: 'equirect_video', main: file, files: [file], warnings: [], width: dims.width, height: dims.height };
	}

	if (images.length < MIN_PHOTOS) {
		return fail('too_few_photos', `A walkaround needs at least ${MIN_PHOTOS} equirectangular photos. A single 360 photo becomes a place you can step inside on the 360 photo page.`);
	}
	for (const f of images) {
		let dims = null;
		try {
			dims = probe.image ? await probe.image(f) : null;
		} catch {
			dims = null;
		}
		if (!dims || !isEquirectRatio(dims.width, dims.height)) {
			return fail('not_equirect', `${f.name} is not a 2:1 equirectangular photo. Export stitched 360 photos from your camera app.`);
		}
	}
	const warnings = [];
	if (images.length < RECOMMENDED_PHOTOS) {
		warnings.push(`${images.length} photos can work in a small space. Most scenes reconstruct best from ${RECOMMENDED_PHOTOS} or more, taken a step apart.`);
	}
	const sorted = [...images].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
	return { ok: true, sourceKind: 'equirect_images', main: sorted[0], files: sorted, warnings };
}

/**
 * The `trim` field sent to the job API. `undefined` means "the whole clip": the
 * server stitches and trains on everything, so a no-op trim is not sent at all.
 */
export function serializeTrim({ start, end, duration }) {
	if (!(duration > 0)) return undefined;
	const s = Math.max(0, Math.min(Number(start) || 0, duration));
	const e = Math.max(0, Math.min(Number.isFinite(end) ? end : duration, duration));
	if (e - s < MIN_TRIM_SECONDS && duration >= MIN_TRIM_SECONDS) {
		throw new RangeError(`Keep at least ${MIN_TRIM_SECONDS} seconds.`);
	}
	if (s <= 0.05 && e >= duration - 0.05) return undefined;
	const r = (n) => Math.round(n * 1000) / 1000;
	return { start_s: r(s), end_s: r(e) };
}

/** Move a trim handle, never past the other one (minimum span) or outside the clip. */
export function moveHandle({ start, end, duration }, which, value) {
	const v = Math.max(0, Math.min(value, duration));
	if (which === 'start') return { start: Math.min(v, Math.max(0, end - MIN_TRIM_SECONDS)), end };
	return { start, end: Math.max(v, Math.min(duration, start + MIN_TRIM_SECONDS)) };
}

/** Keyboard step for a trim handle: arrows nudge 0.1 s, shift 1 s, page keys 10 s. */
export function nudgeStep(key, shiftKey = false) {
	if (key === 'ArrowLeft' || key === 'ArrowDown') return shiftKey ? -1 : -0.1;
	if (key === 'ArrowRight' || key === 'ArrowUp') return shiftKey ? 1 : 0.1;
	if (key === 'PageDown') return -10;
	if (key === 'PageUp') return 10;
	return 0;
}

/** Quality presets, mirroring the worker's `quality` contract. */
export const QUALITY_PRESETS = {
	preview: { label: 'Preview', blurb: '1 fps, up to 120 frames, 7,000 training steps. Quick look.', fps: 1, maxFrames: 120, iterations: 7000 },
	standard: { label: 'Standard', blurb: '2 fps, up to 300 frames, 30,000 training steps. The default.', fps: 2, maxFrames: 300, iterations: 30000 },
	high: { label: 'High', blurb: '3 fps, up to 600 frames, 30,000 steps, up to 6 million Gaussians. Slowest.', fps: 3, maxFrames: 600, iterations: 30000 },
};

// Throughput model, deliberately on the slow side. Derived from the worker's
// documented reference run (240 frames of 8 views solved in 512 s, 30,000
// training steps in 1,310 s) plus a fixed allowance for fetching the file,
// cold start and export. Real runs finish inside the range; these are
// estimates until a measured run replaces the constants.
const SOLVE_SECONDS_PER_FRAME = 2.2;
const TRAIN_SECONDS_PER_STEP = 0.0437;
const FIXED_OVERHEAD_SECONDS = 150;
const STITCH_SECONDS_PER_CLIP_SECOND = 0.7;
const RANGE_SPREAD = 0.35;

/**
 * Time estimate for a job, as a `{ minSeconds, maxSeconds }` range.
 * @param {{ durationS?:number, quality:string, raw?:boolean, photos?:number }} input
 */
export function estimateProcessing({ durationS = 0, quality = 'standard', raw = false, photos = 0 }) {
	const q = QUALITY_PRESETS[quality] || QUALITY_PRESETS.standard;
	const frames = photos > 0 ? Math.min(photos, q.maxFrames) : Math.min(q.maxFrames, Math.max(1, Math.round(durationS * q.fps)));
	const stitch = raw ? durationS * STITCH_SECONDS_PER_CLIP_SECOND : 0;
	const mid = FIXED_OVERHEAD_SECONDS + stitch + frames * SOLVE_SECONDS_PER_FRAME + q.iterations * TRAIN_SECONDS_PER_STEP;
	return { frames, minSeconds: Math.round(mid * (1 - RANGE_SPREAD)), maxSeconds: Math.round(mid * (1 + RANGE_SPREAD)) };
}

export function formatDurationRange(minSeconds, maxSeconds) {
	const m = (s) => Math.max(1, Math.round(s / 60));
	const a = m(minSeconds);
	const b = m(maxSeconds);
	return a === b ? `about ${a} min` : `${a} to ${b} min`;
}

export function formatBytes(n) {
	if (!Number.isFinite(n) || n < 0) return '';
	if (n < 1024) return `${n} B`;
	const units = ['KB', 'MB', 'GB', 'TB'];
	let v = n / 1024;
	let i = 0;
	while (v >= 1024 && i < units.length - 1) {
		v /= 1024;
		i++;
	}
	return `${v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${units[i]}`;
}

export function formatClock(seconds) {
	if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
	const total = Math.round(seconds);
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export function formatRemaining(seconds) {
	if (!Number.isFinite(seconds) || seconds == null) return 'estimating';
	if (seconds < 90) return `${Math.max(1, Math.round(seconds))} s left`;
	if (seconds < 5400) return `${Math.round(seconds / 60)} min left`;
	return `${(seconds / 3600).toFixed(1)} h left`;
}

export const formatSpeed = (bytesPerSecond) => (bytesPerSecond > 0 ? `${formatBytes(bytesPerSecond)}/s` : '');

/** Shortest `source_kind` -> API body, used by tests and by the page when it posts a job. */
export function buildJobBody({ sourceUrl, sourceUrls, sourceKind, trim, quality }) {
	const body = { source_url: sourceUrl, source_kind: sourceKind, quality: QUALITIES.includes(quality) ? quality : 'standard' };
	if (sourceUrls && sourceUrls.length > 1) body.source_urls = sourceUrls;
	if (trim) body.trim = trim;
	return body;
}

// ── job stages ──────────────────────────────────────────────────────────────

export const STAGE_ORDER = ['upload', 'stitch', 'frames', 'sfm', 'train', 'export'];
export const STAGE_LABELS = {
	upload: 'Upload',
	stitch: 'Stitch',
	frames: 'Frames',
	sfm: 'Camera solve',
	train: 'Training',
	export: 'Export',
};

// The worker reports download|stitch|frames|sfm|train|export|upload. The first
// ("download") is the worker fetching what we uploaded, so it belongs to our
// Upload step; the last ("upload") is the worker publishing results.
const WORKER_STAGE_TO_STEP = { download: 'upload', stitch: 'stitch', frames: 'frames', sfm: 'sfm', train: 'train', export: 'export', upload: 'export' };

/** The steps a job of this kind shows. Only raw recordings are stitched on our servers. */
export function stagesFor(sourceKind) {
	return STAGE_ORDER.filter((s) => s !== 'stitch' || sourceKind === 'insv' || sourceKind === 'insp');
}

/**
 * Turn a job report into a per-step view.
 * @param {{status:string, stage?:string, progress?:number}} job
 * @returns {{key:string, label:string, state:'done'|'active'|'pending', fraction:number}[]}
 */
export function stageView(job, sourceKind) {
	const steps = stagesFor(sourceKind);
	const succeeded = job?.status === 'succeeded' || job?.status === 'done';
	const active = succeeded ? steps.length : steps.indexOf(WORKER_STAGE_TO_STEP[job?.stage] || 'upload');
	const idx = active < 0 ? 0 : active;
	return steps.map((key, i) => {
		const state = succeeded || i < idx ? 'done' : i === idx ? 'active' : 'pending';
		const fraction = state === 'done' ? 1 : state === 'active' ? Math.max(0, Math.min(1, Number(job?.progress) || 0)) : 0;
		return { key, label: STAGE_LABELS[key], state, fraction };
	});
}

/** Overall 0..1 progress across the steps, for the page title and a compact bar. */
export function overallProgress(view) {
	if (!view.length) return 0;
	return view.reduce((sum, s) => sum + s.fraction, 0) / view.length;
}

/** Poll delay: 5 s foreground, slower when the tab is hidden, backing off on failures. */
export function nextPollDelay({ failures = 0, hidden = false } = {}) {
	const base = hidden ? 30_000 : 5_000;
	return Math.min(60_000, base * 2 ** Math.min(failures, 4));
}

export const TERMINAL_STATUSES = ['succeeded', 'done', 'failed', 'cancelled'];
export const isTerminal = (status) => TERMINAL_STATUSES.includes(status);

// ── errors ──────────────────────────────────────────────────────────────────

/**
 * Visitor-facing copy for an error from the upload or job API. Operator hints
 * (`hint`) are never rendered; `unconfigured` says only that this deployment
 * cannot run 360 captures yet.
 * @returns {{title:string, message:string, tone:'error'|'info', action?:'sign_in'|'retry'|'pick_other'|'wait'}}
 */
export function describeCaptureError(code, { status = 0, message = '' } = {}) {
	const c = String(code || '');
	switch (c) {
		case 'unconfigured':
			return { title: '360 capture is not switched on here yet', message: 'This deployment has no reconstruction worker connected. Your file has not been touched. Try again later, or use three.ws.', tone: 'info', action: 'retry' };
		case 'too_few_registered':
		case 'registration_failed':
			return {
				title: 'The camera path could not be solved',
				message: 'Too few frames lined up to rebuild the space. Walk slowly in a lit place with plenty of texture, hold the camera on a stick above your head, keep the same height, and avoid mirrors and bare white walls. Then try again.',
				tone: 'error',
				action: 'pick_other',
			};
		case 'file_too_large':
			return { title: 'That file is too large', message: 'Files up to 8 GB can be uploaded. Trim the recording in your camera app, or export a lower-resolution version.', tone: 'error', action: 'pick_other' };
		case 'unauthorized':
		case 'unauthenticated':
		case 'sign_in_required':
			return { title: 'Sign in to capture in 360', message: 'Uploads and captures belong to your account so you can find them later.', tone: 'info', action: 'sign_in' };
		case 'rate_limited':
		case 'too_many_requests':
			return { title: 'Too many captures at once', message: 'You have reached the hourly limit. Wait a few minutes, then start again. Your uploaded file is kept.', tone: 'info', action: 'wait' };
		case 'unsupported_camera':
		case 'unsupported_input':
			return { title: 'That camera format is not supported yet', message: message || 'We could not read that recording. Export a stitched 360 video from your camera app and upload that instead.', tone: 'error', action: 'pick_other' };
		case 'corrupt_input':
		case 'unreadable_input':
			return { title: 'That file looks damaged', message: 'The recording could not be read to the end. Copy it from the card again and retry.', tone: 'error', action: 'pick_other' };
		case 'network':
			return { title: 'Connection lost', message: 'Your connection dropped. The upload resumes by itself when you are back online; nothing already sent is lost.', tone: 'info', action: 'retry' };
		case 'etag_unreadable':
			return { title: 'The upload could not be confirmed', message: 'The browser sent the file but could not read the storage receipt. Reload this page and choose the file again; it will continue from where it stopped.', tone: 'error', action: 'retry' };
		case 'empty_file':
			return { title: 'That file is empty', message: 'The file has no data. Copy it from the card again.', tone: 'error', action: 'pick_other' };
		case 'aborted':
			return { title: 'Upload cancelled', message: 'Nothing was kept on our servers.', tone: 'info', action: 'pick_other' };
		default:
			if (status === 401) return describeCaptureError('unauthorized');
			if (status === 413) return describeCaptureError('file_too_large');
			if (status === 429) return describeCaptureError('rate_limited');
			if (status === 503) return describeCaptureError('unconfigured');
			return {
				title: 'Something went wrong',
				message: message || 'The capture could not continue. Try again; if it keeps failing, choose the file again.',
				tone: 'error',
				action: 'retry',
			};
	}
}

/** The source URL(s) to link a user to for sharing and to open a result in /splat. */
export function splatUrlFor(result) {
	if (result?.viewer_url) return result.viewer_url;
	if (result?.spz_url) return `/splat?src=${encodeURIComponent(result.spz_url)}`;
	return null;
}

/** Relative time for the "Your captures" list. */
export function timeAgo(iso, now = Date.now()) {
	const t = Date.parse(iso);
	if (!Number.isFinite(t)) return '';
	const s = Math.max(0, Math.round((now - t) / 1000));
	if (s < 60) return 'just now';
	if (s < 3600) return `${Math.floor(s / 60)} min ago`;
	if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
	if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
	return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export const SOURCE_KIND_LABELS = {
	insv: 'Raw recording',
	insp: 'Raw photo',
	equirect_video: '360 video',
	equirect_images: '360 photos',
};
