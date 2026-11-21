// /capture 360 mode: pick footage from any 360 camera, preview and trim it
// locally, upload it in resumable parts, then follow the reconstruction job to
// a splat you own. Talks to contract C4: /api/capture-upload/* for bytes and
// /api/pano-capture for the job. The Standard video flow lives in
// scene-capture.js and is left alone; this module only adds the other tab.

import './capture-360.css';
import {
	classifyFiles,
	matchingLensName,
	serializeTrim,
	QUALITIES,
	QUALITY_PRESETS,
	estimateProcessing,
	formatDurationRange,
	formatBytes,
	formatClock,
	formatRemaining,
	formatSpeed,
	buildJobBody,
	stageView,
	overallProgress,
	nextPollDelay,
	isTerminal,
	describeCaptureError,
	timeAgo,
	resultStatsLine,
	SOURCE_KIND_LABELS,
	STAGE_LABELS,
	isRawName,
} from './capture-360-core.js';
import { uploadFile, findResumable, discardUpload, UploadError } from './multipart-upload.js';
import { PREVIEW_MESSAGES, PreviewError, mountSpherePlayer, mountGyroPreview, sampleThumbnails } from './capture-360-preview.js';
import { createTrimTimeline } from './capture-360-trim.js';
import { h } from './capture-360-dom.js';

const API = '/api/pano-capture';
const PENDING_KEY = 'c3.pending';
const $ = (id) => document.getElementById(id);

const state = {
	cls: null,
	preview: null,
	trim: null,
	trimData: null,
	thumbAbort: null,
	quality: 'standard',
	abort: null,
	uploading: false,
	wakeLock: null,
	job: null,
	jobId: null,
	pollTimer: null,
	pollFailures: 0,
	resultScene: null,
	resumeInfo: null,
	pendingPick: null,
};

// ── small helpers ───────────────────────────────────────────────────────────

const show = (el, on = true) => { el.hidden = !on; };

function readPending() {
	try { return JSON.parse(localStorage.getItem(PENDING_KEY) || 'null'); } catch { return null; }
}
function writePending(value) {
	try {
		if (value) localStorage.setItem(PENDING_KEY, JSON.stringify(value));
		else localStorage.removeItem(PENDING_KEY);
	} catch { /* storage blocked: resume still works through IndexedDB */ }
}

// ── alerts ──────────────────────────────────────────────────────────────────

function clearAlert() {
	show($('c3-alert'), false);
}

/** Designed error state for any C4 error code. `onRetry` backs the Try again button. */
function showError(code, { status = 0, message = '', onRetry, title, action } = {}) {
	const view = { ...describeCaptureError(code, { status, message }) };
	if (title) view.title = title;
	if (message && title) view.message = message;
	if (action) view.action = action;
	const box = $('c3-alert');
	box.dataset.tone = view.tone;
	$('c3-alert-title').textContent = view.title;
	$('c3-alert-msg').textContent = view.message;
	const actions = $('c3-alert-actions');
	actions.replaceChildren();
	if (view.action === 'sign_in') {
		const next = encodeURIComponent('/capture?mode=360');
		actions.append(h('a', { class: 'pc-btn pc-btn--primary c3-btn-link', href: `/login?next=${next}` }, 'Sign in'));
	}
	if (view.action === 'retry' && onRetry) actions.append(h('button', { class: 'pc-btn pc-btn--primary', type: 'button', onclick: () => { clearAlert(); onRetry(); } }, 'Try again'));
	if (view.action === 'open_pano_scene') actions.append(h('a', { class: 'pc-btn pc-btn--primary c3-btn-link', href: '/pano-scene' }, 'Step inside this photo'));
	if (view.action === 'pick_other' || view.action === 'open_pano_scene') actions.append(h('button', { class: 'pc-btn', type: 'button', onclick: () => { clearAlert(); resetToPick(); } }, 'Choose other footage'));
	actions.append(h('button', { class: 'pc-btn', type: 'button', onclick: clearAlert }, 'Dismiss'));
	show(box, true);
	box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ── tabs ────────────────────────────────────────────────────────────────────

function selectTab(which, { focus = false, push = true } = {}) {
	const is360 = which === '360';
	$('c3-tab-360').setAttribute('aria-selected', String(is360));
	$('c3-tab-standard').setAttribute('aria-selected', String(!is360));
	$('c3-tab-360').tabIndex = is360 ? 0 : -1;
	$('c3-tab-standard').tabIndex = is360 ? -1 : 0;
	show($('c3-section'), is360);
	show($('pc-standard'), !is360);
	if (focus) (is360 ? $('c3-tab-360') : $('c3-tab-standard')).focus();
	if (push) {
		const url = new URL(location.href);
		if (is360) url.searchParams.set('mode', '360');
		else url.searchParams.delete('mode');
		history.replaceState(null, '', url);
	}
	if (is360) refreshCaptures();
	else if (state.pollTimer) clearTimeout(state.pollTimer);
	if (is360 && state.jobId && !state.pollTimer) schedulePoll(0);
}

function initTabs() {
	const tabs = [$('c3-tab-standard'), $('c3-tab-360')];
	tabs.forEach((tab) => tab.addEventListener('click', () => selectTab(tab === tabs[1] ? '360' : 'standard')));
	$('c3-tabs').addEventListener('keydown', (e) => {
		const i = tabs.indexOf(document.activeElement);
		if (i < 0) return;
		let next = null;
		if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % tabs.length;
		else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i + tabs.length - 1) % tabs.length;
		else if (e.key === 'Home') next = 0;
		else if (e.key === 'End') next = tabs.length - 1;
		if (next == null) return;
		e.preventDefault();
		selectTab(next === 1 ? '360' : 'standard', { focus: true });
	});
}

// ── probing and classification ──────────────────────────────────────────────

function probeVideo(file) {
	return new Promise((resolve, reject) => {
		const url = URL.createObjectURL(file);
		const v = document.createElement('video');
		v.preload = 'metadata';
		v.muted = true;
		const done = (fn, val) => { v.removeAttribute('src'); v.load(); URL.revokeObjectURL(url); fn(val); };
		const timer = setTimeout(() => done(reject, new Error('timeout')), 15000);
		v.addEventListener('loadedmetadata', () => { clearTimeout(timer); done(resolve, { width: v.videoWidth, height: v.videoHeight, duration: v.duration }); }, { once: true });
		v.addEventListener('error', () => { clearTimeout(timer); done(reject, new Error('unreadable')); }, { once: true });
		v.src = url;
	});
}

async function probeImage(file) {
	const bmp = await createImageBitmap(file);
	const out = { width: bmp.width, height: bmp.height };
	bmp.close?.();
	return out;
}

/** True when a file the Standard tab was given is really 360 footage. */
async function looksLike360(file) {
	if (isRawName(file.name)) return true;
	if (!/\.(mp4|mov|m4v)$/i.test(file.name) && !(file.type || '').startsWith('video/')) return false;
	try {
		const d = await probeVideo(file);
		return d.width > 0 && Math.abs(d.width / d.height - 2) <= 0.02;
	} catch {
		return false;
	}
}

// ── review: preview, trim, quality ──────────────────────────────────────────

function teardownPreview() {
	state.thumbAbort?.abort();
	state.thumbAbort = null;
	state.preview?.dispose();
	state.preview = null;
	state.trim?.destroy();
	state.trim = null;
	state.trimData = null;
	$('c3-preview').replaceChildren();
	show($('c3-trim-wrap'), false);
}

function resetToPick() {
	teardownPreview();
	state.cls = null;
	state.resumeInfo = null;
	show($('c3-review'), false);
	show($('c3-work'), false);
	show($('c3-result'), false);
	show($('c3-pick'), true);
	disposeResultScene();
}

function previewBar(handle) {
	const play = h('button', { class: 'pc-btn c3-play', type: 'button', 'aria-label': 'Play preview' }, 'Play');
	const time = h('span', { class: 'c3-time', 'aria-hidden': 'true' }, '0:00');
	const bar = h('div', { class: 'c3-preview-bar' }, play, time);
	const sync = () => { play.textContent = handle.paused ? 'Play' : 'Pause'; play.setAttribute('aria-label', handle.paused ? 'Play preview' : 'Pause preview'); };
	play.addEventListener('click', async () => {
		if (handle.paused) await handle.play(); else handle.pause();
		sync();
	});
	handle.onTime((t) => { time.textContent = `${formatClock(t)} / ${formatClock(handle.duration)}`; state.trim?.setPlayhead(t); sync(); });
	if (handle.gyroAvailable && handle.enableGyro) {
		const gyro = h('button', { class: 'pc-btn', type: 'button', 'aria-pressed': 'false' }, 'Look around with motion');
		gyro.addEventListener('click', async () => {
			if (handle.gyroActive) { handle.disableGyro(); gyro.setAttribute('aria-pressed', 'false'); return; }
			const r = await handle.enableGyro();
			gyro.setAttribute('aria-pressed', String(r.ok));
			if (!r.ok) $('c3-preview-note').textContent = 'Motion control is not available on this device. You can still drag to look around.';
		});
		bar.append(gyro);
	}
	return bar;
}

function attachTrim(handle, file) {
	if (!handle || !Number.isFinite(handle.duration) || handle.duration <= 0) return;
	const dur = handle.duration;
	state.trim = createTrimTimeline($('c3-trim'), {
		duration: dur,
		onChange: (t) => { state.trimData = t; handle.setRange(t.start, t.end); updateEstimate(); },
		onSeek: (t) => handle.seek(t),
	});
	state.trimData = { start: 0, end: dur };
	handle.setRange(0, dur);
	show($('c3-trim-wrap'), true);
	if (file) {
		state.thumbAbort = new AbortController();
		sampleThumbnails(file, 12, (i, canvas) => state.trim?.setThumb(i, canvas), { signal: state.thumbAbort.signal });
	}
}

async function buildPreview(cls) {
	const host = $('c3-preview');
	const note = $('c3-preview-note');
	note.textContent = '';
	show($('c3-pair'), false);
	host.classList.add('is-loading');
	try {
		if (cls.sourceKind === 'equirect_video') {
			const handle = await mountSpherePlayer(host, cls.main);
			state.preview = handle;
			host.after(previewBar(handle));
			attachTrim(handle, cls.main);
			note.textContent = 'Drag to look around. Scroll or pinch to zoom.';
		} else if (cls.sourceKind === 'insv') {
			const handle = await mountGyroPreview(host, { main: cls.main, second: cls.second });
			state.preview = handle;
			host.after(previewBar(handle));
			attachTrim(handle, null);
			note.textContent = 'Stitched in your browser for a quick look. The sharp version is built on our servers.';
		} else if (cls.sourceKind === 'equirect_images') {
			host.replaceChildren(h('div', { class: 'c3-photo-grid' }, cls.files.slice(0, 12).map((f) => {
				const img = h('img', { alt: f.name, loading: 'lazy' });
				img.src = URL.createObjectURL(f);
				img.addEventListener('load', () => URL.revokeObjectURL(img.src), { once: true });
				return img;
			})));
			note.textContent = `${cls.files.length} photos selected.`;
		} else {
			showPreviewFallback(host, PREVIEW_MESSAGES.fallback);
		}
	} catch (err) {
		const code = err instanceof PreviewError ? err.code : 'fallback';
		showPreviewFallback(host, PREVIEW_MESSAGES[code] || PREVIEW_MESSAGES.fallback);
	} finally {
		if (cls.sourceKind === 'insv' && !cls.second) offerPair(cls);
		host.classList.remove('is-loading');
	}
}

function showPreviewFallback(host, message) {
	teardownPreviewBar();
	host.replaceChildren(h('div', { class: 'c3-preview-fallback' }, h('p', {}, message)));
	$('c3-preview-note').textContent = 'You can upload now. The preview never blocks the upload.';
}

function teardownPreviewBar() {
	document.querySelectorAll('#c3-section .c3-preview-bar').forEach((n) => n.remove());
}

function offerPair(cls) {
	const want = matchingLensName(cls.main.name);
	if (!want) return;
	$('c3-pair-msg').textContent = `This recording is split across two files. Add ${want} to preview it stitched, or upload this one alone.`;
	show($('c3-pair'), true);
}

function renderQuality() {
	const box = $('c3-quality');
	box.replaceChildren();
	for (const q of QUALITIES) {
		const p = QUALITY_PRESETS[q];
		const id = `c3-q-${q}`;
		const input = h('input', { type: 'radio', name: 'c3-quality', id, value: q, checked: q === state.quality });
		input.addEventListener('change', () => { state.quality = q; updateEstimate(); });
		box.append(h('label', { class: 'c3-q', for: id }, input, h('span', { class: 'c3-q-body' }, h('strong', {}, p.label), h('span', {}, p.blurb))));
	}
}

function keptSeconds() {
	if (state.trimData) return Math.max(0, state.trimData.end - state.trimData.start);
	return 0;
}

function updateEstimate() {
	const cls = state.cls;
	if (!cls) return;
	const raw = cls.sourceKind === 'insv';
	const photos = cls.sourceKind === 'equirect_images' ? cls.files.length : 0;
	const dur = keptSeconds() || 60;
	const est = estimateProcessing({ durationS: dur, quality: state.quality, raw, photos });
	const known = Boolean(state.trimData) || photos > 0;
	$('c3-estimate').textContent = `${known ? 'Estimated' : 'Typically'} ${formatDurationRange(est.minSeconds, est.maxSeconds)} after the upload finishes. You can close this tab; the scene will be under Your captures.`;
}

function renderSummary(cls) {
	const box = $('c3-summary');
	box.replaceChildren();
	const total = cls.files.reduce((n, f) => n + f.size, 0);
	for (const f of cls.files) box.append(h('div', { class: 'c3-file-row' }, h('span', { class: 'c3-file-name' }, f.name), h('span', { class: 'c3-file-size' }, formatBytes(f.size))));
	box.append(h('div', { class: 'c3-file-row c3-file-total' }, h('span', {}, `${SOURCE_KIND_LABELS[cls.sourceKind] || 'File'}${cls.width ? `, ${cls.width} by ${cls.height}` : ''}`), h('span', {}, formatBytes(total))));
	const warn = $('c3-warnings');
	warn.replaceChildren(...cls.warnings.map((w) => h('li', {}, w)));
	show(warn, cls.warnings.length > 0);
}

async function handleFiles(files) {
	clearAlert();
	const list = Array.from(files || []);
	if (!list.length) return;
	const cls = await classifyFiles(list, { video: probeVideo, image: probeImage });
	if (!cls.ok) {
		if (cls.redirect) showError(cls.code);
		else showError(cls.code, { title: 'That footage cannot be used yet', message: cls.message, action: 'pick_other' });
		return;
	}
	await showReview(cls);
}

async function showReview(cls) {
	teardownPreview();
	teardownPreviewBar();
	disposeResultScene();
	state.cls = cls;
	state.pendingPick = cls.files;
	show($('c3-pick'), false);
	show($('c3-work'), false);
	show($('c3-result'), false);
	show($('c3-review'), true);
	renderSummary(cls);
	renderQuality();
	updateEstimate();
	await refreshStartButton();
	buildPreview(cls).then(() => updateEstimate());
	$('c3-review').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/** The start button becomes "Resume upload" when this exact file is half sent. */
async function refreshStartButton() {
	const cls = state.cls;
	const start = $('c3-start');
	let bytesDone = 0;
	let total = 0;
	for (const f of cls.files) {
		total += f.size;
		const found = await findResumable(f);
		if (found) bytesDone += found.bytesDone;
	}
	state.resumeInfo = bytesDone > 0 ? { bytesDone, total } : null;
	if (state.resumeInfo) {
		start.textContent = `Resume upload (${Math.round((bytesDone / total) * 100)}% already sent)`;
		$('c3-start-hint').textContent = 'These exact files were partly uploaded before. Only the missing parts are sent.';
	} else {
		start.textContent = 'Upload and build my scene';
		$('c3-start-hint').textContent = 'You need to be signed in to build a scene. Your footage is uploaded privately and used only for this scene.';
	}
}

// ── upload + job ────────────────────────────────────────────────────────────

async function acquireWakeLock() {
	try {
		if ('wakeLock' in navigator) state.wakeLock = await navigator.wakeLock.request('screen');
	} catch { state.wakeLock = null; }
}
function releaseWakeLock() {
	try { state.wakeLock?.release(); } catch { /* already released */ }
	state.wakeLock = null;
}
const beforeUnload = (e) => { e.preventDefault(); e.returnValue = ''; };
document.addEventListener('visibilitychange', () => {
	if (document.visibilityState === 'visible' && state.uploading && !state.wakeLock) acquireWakeLock();
});

function renderSteps(view) {
	const list = $('c3-steps');
	list.replaceChildren(...view.map((s) => {
		const li = h('li', { class: `c3-step is-${s.state}`, 'aria-current': s.state === 'active' ? 'step' : null },
			h('span', { class: 'c3-step-dot', 'aria-hidden': 'true' }, s.state === 'done' ? '✓' : ''),
			h('span', { class: 'c3-step-label' }, s.label),
			h('span', { class: 'c3-step-pct' }, s.state === 'active' ? `${Math.round(s.fraction * 100)}%` : s.state === 'done' ? 'Done' : ''));
		return li;
	}));
}

function setWork(title, pill) {
	$('c3-work-title').textContent = title;
	$('c3-work-pill').textContent = pill || '';
}

function startFlow() {
	const cls = state.cls;
	if (!cls) return;
	clearAlert();
	let trim;
	try {
		trim = state.trimData ? serializeTrim({ ...state.trimData, duration: state.trim?.trim.duration ?? state.preview?.duration }) : undefined;
	} catch (err) {
		showError('invalid_trim', { message: err.message });
		return;
	}
	runUploadAndJob(cls, trim);
}

async function runUploadAndJob(cls, trim) {
	const files = cls.files;
	const total = files.reduce((n, f) => n + f.size, 0);
	state.abort = new AbortController();
	state.uploading = true;
	show($('c3-review'), false);
	show($('c3-work'), true);
	show($('c3-meter'), true);
	$('c3-work-actions').replaceChildren(h('button', { class: 'pc-btn', type: 'button', onclick: cancelUpload }, 'Cancel upload'));
	setWork('Uploading your footage', 'Step 1');
	$('c3-work-note').textContent = 'Keep this tab open until the upload finishes. If the connection drops, it resumes by itself.';
	renderSteps(stageView({ status: 'running', stage: 'download', progress: 0 }, cls.sourceKind));
	window.addEventListener('beforeunload', beforeUnload);
	acquireWakeLock();
	writePending({ name: files[0].name, size: files[0].size, count: files.length, at: Date.now() });
	show($('c3-resume'), false);

	const done = [];
	let sent = 0;
	try {
		for (const file of files) {
			const base = sent;
			const out = await uploadFile(file, {
				signal: state.abort.signal,
				onProgress: (p) => {
					const loaded = base + p.loaded;
					const frac = total ? loaded / total : 0;
					renderSteps(stageView({ status: 'running', stage: 'download', progress: frac }, cls.sourceKind));
					$('c3-bar-fill').style.width = `${(frac * 100).toFixed(1)}%`;
					const bits = [`${formatBytes(loaded)} of ${formatBytes(total)}`, formatSpeed(p.bytesPerSecond), p.secondsRemaining != null ? formatRemaining(p.secondsRemaining) : ''];
					$('c3-meter-text').textContent = bits.filter(Boolean).join(' · ') + (p.resumed ? ' · resumed' : '');
					document.title = `${Math.round(frac * 100)}% uploading · three.ws`;
				},
				onRetry: ({ attempt }) => { $('c3-work-note').textContent = `The connection stumbled. Retrying part (attempt ${attempt + 1})...`; },
			});
			done.push(out);
			sent += file.size;
		}
	} catch (err) {
		onUploadFailed(err, cls, trim);
		return;
	} finally {
		state.uploading = false;
		window.removeEventListener('beforeunload', beforeUnload);
		releaseWakeLock();
	}

	writePending(null);
	setWork('Starting your scene', 'Step 2');
	$('c3-work-note').textContent = 'Upload complete. Handing your footage to the reconstruction worker.';
	$('c3-work-actions').replaceChildren();
	try {
		const body = buildJobBody({
			sourceUrl: done[0].source_url,
			sourceUrls: done.length > 1 ? done.map((d) => d.source_url) : undefined,
			sourceKind: cls.sourceKind,
			trim,
			quality: state.quality,
		});
		const res = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) });
		const data = await res.json().catch(() => ({}));
		if (!res.ok) throw new UploadError(data.error || `http_${res.status}`, data.message || '', { status: res.status });
		state.jobId = data.job_id;
		state.job = { job_id: data.job_id, status: data.status, stage: 'download', progress: 0, source_kind: cls.sourceKind };
		rememberJob(data.job_id);
		renderJob(state.job, cls.sourceKind);
		schedulePoll(1500);
		refreshCaptures();
	} catch (err) {
		show($('c3-work'), false);
		show($('c3-review'), true);
		showError(err.code || 'network', { status: err.status, message: err.message, onRetry: () => runUploadAndJob(cls, trim) });
	}
}

function onUploadFailed(err, cls, trim) {
	document.title = document.title.replace(/^\d+% uploading . /, '');
	if (err?.name === 'AbortError' || err?.code === 'aborted') {
		show($('c3-work'), false);
		show($('c3-review'), true);
		refreshStartButton();
		return;
	}
	show($('c3-work'), false);
	show($('c3-review'), true);
	refreshStartButton();
	const retry = () => runUploadAndJob(cls, trim);
	if (err?.code === 'network') {
		showError('network_lost', { message: err.message, onRetry: retry });
		autoResumeWhenOnline(retry);
		return;
	}
	showError(err?.code || 'upload_failed', { status: err?.status, message: err?.message, onRetry: retry });
}

let onlineHandler = null;
function autoResumeWhenOnline(retry) {
	if (onlineHandler) window.removeEventListener('online', onlineHandler);
	onlineHandler = () => {
		window.removeEventListener('online', onlineHandler);
		onlineHandler = null;
		if (!state.uploading && state.cls) { clearAlert(); retry(); }
	};
	window.addEventListener('online', onlineHandler);
}

function cancelUpload() {
	state.abort?.abort();
}

// ── job progress ────────────────────────────────────────────────────────────

function rememberJob(id) {
	const url = new URL(location.href);
	url.searchParams.set('mode', '360');
	if (id) url.searchParams.set('job', id); else url.searchParams.delete('job');
	history.replaceState(null, '', url);
}

function renderJob(job, sourceKind) {
	const kind = sourceKind || job.source_kind || state.cls?.sourceKind || 'equirect_video';
	show($('c3-pick'), false);
	show($('c3-review'), false);
	show($('c3-work'), true);
	if (job.status === 'succeeded' || job.status === 'done') { show($('c3-work'), false); renderResult(job); return; }
	show($('c3-result'), false);
	if (job.status === 'failed' || job.status === 'cancelled') {
		const e = job.error || {};
		setWork(job.status === 'cancelled' ? 'Cancelled' : 'This scene did not finish', '');
		show($('c3-meter'), false);
		renderSteps(stageView(job, kind));
		$('c3-work-note').textContent = '';
		$('c3-work-actions').replaceChildren(
			h('button', { class: 'pc-btn pc-btn--primary', type: 'button', onclick: () => { rememberJob(null); state.jobId = null; resetToPick(); } }, 'Start a new capture'));
		if (job.status === 'failed') showError(e.code || 'job_failed', { message: e.message });
		return;
	}
	const view = stageView(job, kind);
	renderSteps(view);
	const active = view.find((s) => s.state === 'active');
	setWork(job.status === 'queued' ? 'Waiting for a worker' : active ? `${STAGE_LABELS[active.key]}...` : 'Working', job.status === 'queued' ? 'Queued' : 'Running');
	show($('c3-meter'), true);
	const frac = overallProgress(view);
	$('c3-bar-fill').style.width = `${(frac * 100).toFixed(1)}%`;
	$('c3-meter-text').textContent = `${Math.round(frac * 100)}% overall`;
	$('c3-work-note').textContent = 'You can close this tab. Your scene keeps building and will be waiting under Your captures.';
	$('c3-work-actions').replaceChildren(h('button', { class: 'pc-btn', type: 'button', onclick: () => cancelJob(job.job_id) }, 'Cancel'));
	document.title = `${Math.round(frac * 100)}% building · three.ws`;
}

function schedulePoll(delay) {
	clearTimeout(state.pollTimer);
	state.pollTimer = setTimeout(pollJob, delay);
}

async function pollJob() {
	state.pollTimer = null;
	if (!state.jobId) return;
	try {
		const res = await fetch(`${API}?job=${encodeURIComponent(state.jobId)}`, { credentials: 'same-origin' });
		const data = await res.json().catch(() => ({}));
		if (!res.ok) throw new UploadError(data.error || `http_${res.status}`, data.message || '', { status: res.status });
		state.pollFailures = 0;
		state.job = data;
		renderJob(data);
		if (isTerminal(data.status)) { document.title = document.title.replace(/^\d+% \w+ . /, ''); refreshCaptures(); return; }
	} catch (err) {
		if (err.status === 401 || err.status === 404) { showError(err.code, { status: err.status, message: err.message }); return; }
		state.pollFailures++;
	}
	schedulePoll(nextPollDelay({ failures: state.pollFailures, hidden: document.hidden }));
}
document.addEventListener('visibilitychange', () => {
	if (!document.hidden && state.jobId && !isTerminal(state.job?.status) && $('c3-section') && !$('c3-section').hidden) schedulePoll(0);
});

async function cancelJob(id) {
	try {
		const res = await fetch(`${API}?job=${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'same-origin' });
		if (!res.ok) { const d = await res.json().catch(() => ({})); throw new UploadError(d.error || `http_${res.status}`, d.message, { status: res.status }); }
		state.jobId = null;
		rememberJob(null);
		resetToPick();
		refreshCaptures();
	} catch (err) {
		showError(err.code || 'network', { status: err.status, message: err.message });
	}
}

// ── result ──────────────────────────────────────────────────────────────────

function disposeResultScene() {
	state.resultScene?.dispose?.();
	state.resultScene = null;
}

async function renderResult(job) {
	if (state.resultJob === job.job_id && !$('c3-result').hidden) return;
	state.resultJob = job.job_id;
	const r = job.result || {};
	show($('c3-result'), true);
	show($('c3-captures-wrap'), true);
	document.title = document.title.replace(/^\d+% \w+ . /, '');
	$('c3-result-stats').textContent = resultStatsLine(job.stats) || 'Orbit it with a drag. Scroll to zoom.';

	const actions = $('c3-result-actions');
	actions.replaceChildren();
	if (r.viewer_url) actions.append(h('a', { class: 'pc-btn pc-btn--primary c3-btn-link', href: r.viewer_url }, 'Open in /splat'));
	if (r.spz_url) actions.append(h('a', { class: 'pc-btn c3-btn-link', href: r.spz_url, download: 'scene.spz' }, 'Download SPZ'));
	if (r.ply_url) actions.append(h('a', { class: 'pc-btn c3-btn-link', href: r.ply_url, download: 'scene.ply' }, 'Download PLY'));
	if (r.preview_url) actions.append(h('button', { class: 'pc-btn', type: 'button', onclick: () => shareResult(r) }, 'Share preview'));
	actions.append(h('button', { class: 'pc-btn', type: 'button', onclick: () => { state.jobId = null; state.resultJob = null; rememberJob(null); resetToPick(); } }, 'Capture another'));

	const video = $('c3-result-video');
	if (r.preview_url) { video.src = r.preview_url; if (r.poster_url) video.poster = r.poster_url; show(video, true); } else show(video, false);

	const stage = $('c3-result-stage');
	stage.replaceChildren(h('div', { class: 'c3-skeleton', role: 'status' }, 'Loading your scene...'));
	const src = r.spz_url || r.ply_url;
	if (!src) { stage.replaceChildren(h('p', { class: 'c3-hint' }, 'This scene has no downloadable splat yet.')); return; }
	try {
		const res = await fetch(src);
		if (!res.ok) throw new Error(`status ${res.status}`);
		const buf = await res.arrayBuffer();
		const { mountSplatScene } = await import('./splat-stage.js');
		disposeResultScene();
		state.resultScene = await mountSplatScene(stage, buf, { fileName: r.spz_url ? 'scene.spz' : 'scene.ply' });
	} catch (err) {
		stage.replaceChildren(h('div', { class: 'c3-preview-fallback' }, h('p', {}, 'The scene could not be shown in this browser. You can still download it or open it in /splat.'),
			h('button', { class: 'pc-btn', type: 'button', onclick: () => renderResult({ ...job }) }, 'Try again')));
		state.resultJob = null;
		console.warn('capture-360: result viewer failed', err);
	}
}

async function shareResult(r) {
	const url = new URL(r.viewer_url || r.preview_url, location.href).href;
	try {
		if (navigator.share) { await navigator.share({ title: 'My 3D scene', url }); return; }
	} catch (err) { if (err.name === 'AbortError') return; }
	try {
		await navigator.clipboard.writeText(url);
		flash('Link copied');
	} catch {
		flash(url);
	}
}

function flash(text) {
	const note = $('c3-result-stats');
	const prev = note.textContent;
	note.textContent = text;
	setTimeout(() => { note.textContent = prev; }, 2500);
}

// ── Your captures ───────────────────────────────────────────────────────────

async function refreshCaptures() {
	const box = $('c3-captures');
	if (!box.childElementCount) box.replaceChildren(h('div', { class: 'c3-skeleton-row' }), h('div', { class: 'c3-skeleton-row' }));
	try {
		const res = await fetch(`${API}?mine=1`, { credentials: 'same-origin' });
		const data = await res.json().catch(() => ({}));
		if (res.status === 401) {
			box.replaceChildren(h('p', { class: 'c3-empty' }, 'Sign in to see your 360 captures. ', h('a', { class: 'c3-link', href: `/login?next=${encodeURIComponent('/capture?mode=360')}` }, 'Sign in')));
			return;
		}
		if (!res.ok) throw new Error(data.message || `status ${res.status}`);
		renderCaptures(data.captures || []);
	} catch {
		box.replaceChildren(h('p', { class: 'c3-empty' }, 'Your captures could not be loaded. ', h('button', { class: 'c3-link', type: 'button', onclick: refreshCaptures }, 'Try again')));
	}
}

function renderCaptures(list) {
	const box = $('c3-captures');
	if (!list.length) {
		box.replaceChildren(h('p', { class: 'c3-empty' }, 'Nothing here yet. Upload 360 footage above and your scene will be saved here.'));
		return;
	}
	box.replaceChildren(h('ul', { class: 'c3-cap-list' }, list.map((c) => captureRow(c))));
}

function captureRow(c) {
	const failed = c.status === 'failed' || c.status === 'cancelled';
	const done = c.status === 'succeeded' || c.status === 'done';
	const label = done ? 'Ready' : failed ? (c.status === 'cancelled' ? 'Cancelled' : 'Failed') : (STAGE_LABELS[stageView(c, c.source_kind).find((s) => s.state === 'active')?.key] || 'Building');
	const li = h('li', { class: `c3-cap is-${done ? 'done' : failed ? 'failed' : 'running'}` });
	li.append(c.poster_url ? h('img', { class: 'c3-cap-poster', src: c.poster_url, alt: '', loading: 'lazy' }) : h('div', { class: 'c3-cap-poster c3-cap-poster--empty', 'aria-hidden': 'true' }));
	li.append(h('div', { class: 'c3-cap-body' },
		h('strong', {}, SOURCE_KIND_LABELS[c.source_kind] || '360 capture'),
		h('span', { class: 'c3-cap-meta' }, `${label} · ${timeAgo(c.created_at)}`),
		failed && c.error ? h('span', { class: 'c3-cap-err' }, describeCaptureError(c.error.code, { message: c.error.message }).title) : null));
	const actions = h('div', { class: 'c3-cap-actions' });
	actions.append(h('button', { class: 'pc-btn', type: 'button', onclick: () => openCapture(c) }, done ? 'Open' : failed ? 'Details' : 'Follow'));
	if (failed) actions.append(h('button', { class: 'pc-btn', type: 'button', onclick: () => { resetToPick(); window.scrollTo({ top: $('c3-section').offsetTop, behavior: 'smooth' }); } }, 'Retry'));
	const del = h('button', { class: 'pc-btn c3-danger', type: 'button' }, 'Delete');
	del.addEventListener('click', () => confirmDelete(li, c, actions));
	actions.append(del);
	li.append(actions);
	return li;
}

function confirmDelete(li, c, actions) {
	const previous = Array.from(actions.childNodes);
	const cancel = h('button', { class: 'pc-btn', type: 'button', onclick: () => actions.replaceChildren(...previous) }, 'Keep');
	const yes = h('button', { class: 'pc-btn c3-danger', type: 'button', onclick: async () => {
		yes.disabled = true;
		try {
			const res = await fetch(`${API}?job=${encodeURIComponent(c.job_id)}`, { method: 'DELETE', credentials: 'same-origin' });
			if (!res.ok) throw new Error('delete failed');
			if (state.jobId === c.job_id) { state.jobId = null; rememberJob(null); resetToPick(); }
			refreshCaptures();
		} catch {
			yes.disabled = false;
			actions.replaceChildren(h('span', { class: 'c3-cap-err' }, 'Could not delete. '), ...previous);
		}
	} }, 'Delete for good');
	actions.replaceChildren(h('span', { class: 'c3-confirm', role: 'alert' }, 'Delete this scene?'), yes, cancel);
	yes.focus();
}

function openCapture(c) {
	state.jobId = c.job_id;
	state.resultJob = null;
	state.job = c;
	rememberJob(c.job_id);
	show($('c3-pick'), false);
	clearAlert();
	schedulePoll(0);
	$('c3-section').scrollIntoView({ block: 'start', behavior: 'smooth' });
}

// ── wiring ──────────────────────────────────────────────────────────────────

function wireDropAndPick() {
	const drop = $('c3-drop');
	const input = $('c3-file');
	drop.addEventListener('click', () => input.click());
	input.addEventListener('change', () => { const f = Array.from(input.files || []); input.value = ''; if (f.length) handleFiles(f); });
	const zone = $('c3-section');
	['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('is-dragover'); }));
	['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => { if (ev === 'dragleave' && zone.contains(e.relatedTarget)) return; drop.classList.remove('is-dragover'); }));
	zone.addEventListener('drop', (e) => {
		e.preventDefault();
		const f = Array.from(e.dataTransfer?.files || []);
		if (f.length) handleFiles(f);
	});

	$('c3-change').addEventListener('click', resetToPick);
	$('c3-start').addEventListener('click', startFlow);
	$('c3-pair-add').addEventListener('click', () => {
		const pickPair = document.createElement('input');
		pickPair.type = 'file';
		pickPair.accept = '.insv';
		pickPair.addEventListener('change', () => {
			const extra = pickPair.files?.[0];
			if (!extra || !state.cls) return;
			handleFiles([...state.cls.files, extra]);
		});
		pickPair.click();
	});
	$('c3-resume-go').addEventListener('click', () => input.click());
	$('c3-resume-discard').addEventListener('click', async () => {
		const p = state.pendingPick;
		writePending(null);
		show($('c3-resume'), false);
		if (p) for (const f of p) await discardUpload(f);
	});
}

function showResumeBanner() {
	const p = readPending();
	if (!p || state.uploading) return;
	$('c3-resume-msg').textContent = `Your upload of ${p.name}${p.count > 1 ? ` and ${p.count - 1} more` : ''} (${formatBytes(p.size)}) did not finish. Choose the same file again and it continues from where it stopped.`;
	show($('c3-resume'), true);
	selectTab('360', { push: false });
}

export function initCapture360() {
	if (!$('c3-section')) return;
	initTabs();
	wireDropAndPick();
	showResumeBanner();
	window.pcVideoRouter = async (file) => {
		if (!(await looksLike360(file))) return false;
		selectTab('360');
		await handleFiles([file]);
		return true;
	};
	const params = new URLSearchParams(location.search);
	const mode360 = params.get('mode') === '360' || params.has('job');
	if (mode360) selectTab('360', { push: false });
	const jobId = params.get('job');
	if (jobId) { state.jobId = jobId; show($('c3-pick'), false); schedulePoll(0); }
	window.addEventListener('pagehide', () => { state.thumbAbort?.abort(); });
}

initCapture360();
