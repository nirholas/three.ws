// /pano-scene: upload a 360 photo, follow the real job, then stand inside the result.
import { PanoSceneStage } from './pano-scene-stage.js';
import {
	MAX_PHOTO_BYTES,
	classifyFile,
	isEquirectSize,
	stepStates,
	stageCopy,
	errorCopy,
} from './pano-scene-core.js';

const $ = (sel) => document.querySelector(sel);
const POLL_MS = 3000;

let stage = null;
let pollTimer = null;
let runId = 0;
let lastFile = null;
let lanes = null;
let busyKind = 'equirect_image';

const els = {
	stage: $('#ps-stage'),
	host: $('#ps-host'),
	idle: $('#ps-idle'),
	loading: $('#ps-loading'),
	error: $('#ps-error'),
	hud: $('#ps-hud'),
	laneNote: $('#ps-lane-note'),
	steps: $('#ps-steps'),
	bar: $('#ps-bar'),
	file: $('#ps-file'),
	pick: $('#ps-pick'),
};

function show(which) {
	els.idle.hidden = which !== 'idle';
	els.loading.hidden = which !== 'loading';
	els.error.hidden = which !== 'error';
	els.hud.hidden = which !== 'scene';
	$('#ps-done').hidden = which !== 'scene';
}

function renderProgress(kind, stg, progress, status) {
	els.steps.replaceChildren(
		...stepStates(kind, stg, status).map((s) => {
			const li = document.createElement('li');
			li.className = 'ps-step';
			li.dataset.state = s.state;
			li.textContent = s.label;
			if (s.state === 'active') li.setAttribute('aria-current', 'step');
			return li;
		}),
	);
	els.bar.style.width = `${Math.round(Math.min(1, Math.max(0, progress || 0)) * 100)}%`;
	$('#ps-loading-title').textContent = stg === 'upload' ? 'Uploading' : 'Building your scene';
	$('#ps-loading-sub').textContent = stageCopy(stg, progress);
}

function showError(code, message, { retry = false } = {}) {
	const copy = errorCopy(code, message);
	$('#ps-error-title').textContent = copy.title;
	$('#ps-error-sub').textContent = copy.body;
	const signin = $('#ps-error-signin');
	signin.hidden = !copy.signIn;
	signin.href = `/login?next=${encodeURIComponent('/pano-scene')}`;
	$('#ps-error-retry').hidden = !retry || !lastFile;
	show('error');
}

function stopPolling() {
	if (pollTimer) clearTimeout(pollTimer);
	pollTimer = null;
}

async function api(url, init) {
	const res = await fetch(url, { credentials: 'include', ...init });
	const body = await res.json().catch(() => ({}));
	return { res, body };
}

function imageSize(file) {
	return new Promise((resolve) => {
		const url = URL.createObjectURL(file);
		const img = new Image();
		img.onload = () => {
			URL.revokeObjectURL(url);
			resolve({ width: img.naturalWidth, height: img.naturalHeight });
		};
		img.onerror = () => {
			URL.revokeObjectURL(url);
			resolve(null);
		};
		img.src = url;
	});
}

async function upload(file, cls) {
	const presign = await api('/api/scene-upload', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ content_type: cls.contentType, size_bytes: file.size, filename: file.name }),
	});
	if (presign.res.status === 401) throw Object.assign(new Error(presign.body.message), { code: 'sign_in_required' });
	if (presign.res.status === 503) throw Object.assign(new Error(presign.body.message), { code: 'unconfigured' });
	if (!presign.res.ok) throw new Error(presign.body.message || `Upload could not start (HTTP ${presign.res.status}).`);
	const put = await fetch(presign.body.upload_url, {
		method: 'PUT',
		headers: presign.body.headers || { 'content-type': cls.contentType },
		body: file,
	});
	if (!put.ok) throw new Error(`Upload failed (HTTP ${put.status}).`);
	return presign.body.public_url;
}

async function handleFile(file) {
	if (!file) return;
	stopPolling();
	const id = ++runId;
	lastFile = file;
	const cls = classifyFile(file);
	if (!cls) return showError('unsupported_type');
	if (file.size > MAX_PHOTO_BYTES) return showError('too_large');
	if (cls.kind === 'equirect_image') {
		const size = await imageSize(file);
		if (id !== runId) return;
		if (size && !isEquirectSize(size.width, size.height)) return showError('not_equirect');
	}
	if (lanes && lanes[cls.kind] === false) return showError('unconfigured', 'Photo-to-3D is not switched on yet on this server.');

	busyKind = cls.kind;
	show('loading');
	renderProgress(cls.kind, 'upload', 0, 'running');
	let publicUrl;
	try {
		publicUrl = await upload(file, cls);
	} catch (err) {
		if (id !== runId) return;
		return showError(err.code || 'upload_failed', err.message, { retry: !err.code });
	}
	if (id !== runId) return;

	const start = await api('/api/pano-scene', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ image_url: publicUrl, source_kind: cls.kind }),
	}).catch(() => null);
	if (id !== runId) return;
	if (!start) return showError('network', 'Could not reach the server. Check your connection.', { retry: true });
	if (start.res.status === 401) return showError('sign_in_required', start.body.message);
	if (start.res.status === 503) return showError('unconfigured', start.body.message);
	if (!start.res.ok) return showError(start.body.error, start.body.message, { retry: true });
	renderProgress(cls.kind, start.body.stage || 'depth', start.body.progress, start.body.status);
	poll(id, start.body.job_id, cls.kind);
}

function poll(id, jobId, kind) {
	pollTimer = setTimeout(async () => {
		let r;
		try {
			r = await api(`/api/pano-scene?job=${encodeURIComponent(jobId)}`);
		} catch {
			if (id === runId) poll(id, jobId, kind);
			return;
		}
		if (id !== runId) return;
		const { res, body } = r;
		if (res.status === 401) return showError('sign_in_required', body.message);
		if (res.status === 404) return showError('job_not_found', 'That scene is no longer available. Upload the photo again.', { retry: true });
		if (res.status === 503) return showError('unconfigured', body.message);
		if (!res.ok) return poll(id, jobId, kind);
		if (body.status === 'failed' || body.error) {
			return showError(body.error?.code, body.error?.message || 'The scene could not be built.', { retry: true });
		}
		if (body.status === 'succeeded' && body.result) return finish(id, body.result);
		renderProgress(kind, body.stage, body.progress, body.status);
		poll(id, jobId, kind);
	}, POLL_MS);
}

async function finish(id, result) {
	renderProgress(busyKind, 'done', 1, 'succeeded');
	$('#ps-dl-glb').href = result.glb_url;
	$('#ps-dl-ply').href = result.ply_url || '#';
	$('#ps-dl-ply').hidden = !result.ply_url;
	$('#ps-open').href = result.viewer_url || `/viewer?src=${encodeURIComponent(result.glb_url)}`;
	try {
		if (!stage) stage = new PanoSceneStage(els.host);
		await stage.load(result.glb_url, { medianDepthM: result.stats?.median_depth_m ?? null });
	} catch (err) {
		if (id !== runId) return;
		return showError('viewer_failed', `The scene was built but could not be shown here (${err.message}). Download the GLB instead.`);
	}
	if (id !== runId) return;
	show('scene');
	$('#ps-hud-label').textContent = 'Drag to look around. Press W A S D or Step to move.';
	stage.invalidate();
}

function bind() {
	const choose = () => els.file.click();
	els.pick.addEventListener('click', choose);
	els.idle.addEventListener('click', choose);
	$('#ps-error-pick').addEventListener('click', choose);
	$('#ps-error-retry').addEventListener('click', () => handleFile(lastFile));
	els.file.addEventListener('change', () => {
		const f = els.file.files?.[0];
		els.file.value = '';
		handleFile(f);
	});
	for (const ev of ['dragenter', 'dragover']) {
		els.stage.addEventListener(ev, (e) => { e.preventDefault(); els.stage.classList.add('is-dragover'); });
	}
	for (const ev of ['dragleave', 'drop']) {
		els.stage.addEventListener(ev, (e) => { e.preventDefault(); els.stage.classList.remove('is-dragover'); });
	}
	els.stage.addEventListener('drop', (e) => handleFile(e.dataTransfer?.files?.[0]));

	const stepBtn = $('#ps-step');
	stepBtn.addEventListener('click', () => {
		stage?.toggleStep();
		stepBtn.setAttribute('aria-pressed', String(!!stage?.stepped));
	});
	$('#ps-recenter').addEventListener('click', () => {
		stage?.recenter();
		stepBtn.setAttribute('aria-pressed', 'false');
	});
	$('#ps-shot').addEventListener('click', () => {
		const url = stage?.screenshot();
		if (!url) return;
		const a = document.createElement('a');
		a.href = url;
		a.download = 'pano-scene-view.png';
		a.click();
	});
	const gyroBtn = $('#ps-gyro');
	if (typeof window.DeviceOrientationEvent !== 'undefined' && matchMedia('(pointer: coarse)').matches) {
		gyroBtn.hidden = false;
	}
	gyroBtn.addEventListener('click', async () => {
		if (!stage) return;
		if (stage.gyroActive) stage.disableGyro();
		else {
			try { await stage.enableGyro(); } catch (err) { $('#ps-hud-label').textContent = err.message || 'Gyroscope is not available.'; }
		}
		gyroBtn.setAttribute('aria-pressed', String(stage.gyroActive));
	});
	window.addEventListener('keydown', (e) => {
		if (!stage || els.hud.hidden || e.target.closest?.('input,textarea')) return;
		if (e.key.toLowerCase() === 'r') stage.recenter();
	});
}

async function loadLanes() {
	try {
		const { res, body } = await api('/api/pano-scene');
		if (res.ok && body.lanes) {
			lanes = body.lanes;
			if (!lanes.equirect_image && !lanes.insp) {
				els.laneNote.textContent = 'Photo-to-3D is not switched on yet on this server.';
				els.laneNote.hidden = false;
			} else if (!lanes.insp) {
				els.laneNote.textContent = 'Raw .insp files are not switched on yet. Export a 360 JPEG.';
				els.laneNote.hidden = false;
			}
		}
	} catch { /* lane check is advisory; the real submit reports its own errors */ }
}

bind();
show('idle');
loadLanes();
window.addEventListener('pagehide', () => { stopPolling(); stage?.dispose(); });
