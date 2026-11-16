// Cosmos · Living Worlds: drive the /api/cosmos world lane and composite the
// result behind a live 3D avatar (Google <model-viewer>).
//
// Two ways to build a world:
//   Text            describe a place; Cosmos renders it.
//   From my scene   the avatar on the stage conditions the world:
//                     Still  a capture of the stage becomes frame 0 (image-to-world)
//                     Depth  a three.js depth render of the avatar steers the layout
//                     Edge   a three.js edge render of the avatar steers the layout
//
// The lane is a model ladder (api/_lib/cosmos-ladder.js). GET /api/cosmos says
// which modes are live right now; the picker only offers what can be served.
// Jobs are durable on the server, so the job id is kept in localStorage and a
// reload resumes the same render. Progress is the worker's own record (queue
// position, denoising step, ETA), never an elapsed-time guess.

import { captureStill, recordControl, sceneCaptureSupport } from './cosmos-scene-capture.js';

const $ = (id) => document.getElementById(id);

const els = {
	stage: $('cz-stage'),
	world: $('cz-world'),
	avatar: $('cz-avatar'),
	prompt: $('cz-prompt'),
	promptCount: $('cz-prompt-count'),
	chips: $('cz-chips'),
	generate: $('cz-generate'),
	secondary: $('cz-secondary'),
	cancel: $('cz-cancel'),
	regen: $('cz-regen'),
	note: $('cz-note'),
	avatars: $('cz-avatars'),
	seed: $('cz-seed'),
	resolution: $('cz-resolution'),
	frames: $('cz-frames'),
	download: $('cz-download'),
	copy: $('cz-copy'),
	overlay: $('cz-overlay'),
	toast: $('cz-toast'),
	progLabel: $('cz-prog-label'),
	progTime: $('cz-prog-time'),
	progFill: $('cz-prog-fill'),
	progBar: $('cz-prog-bar'),
	phases: $('cz-phases'),
	statusBadge: $('cz-status-badge'),
	statusText: $('cz-status-text'),
	modeText: $('cz-mode-text'),
	modeScene: $('cz-mode-scene'),
	modeHint: $('cz-mode-hint'),
	scene: $('cz-scene'),
	sceneKinds: $('cz-scene-kinds'),
	sceneThumb: $('cz-scene-thumb'),
	sceneEmpty: $('cz-scene-empty'),
	sceneMeta: $('cz-scene-meta'),
	sceneCapture: $('cz-scene-capture'),
	result: $('cz-result'),
	resultModel: $('cz-result-model'),
	resultTimes: $('cz-result-times'),
	foot: $('cz-foot'),
};

const IDEAS = [
	'a neon Tokyo street in the rain at night, reflections on the pavement',
	'a serene alpine lake at sunrise, mist drifting over the water',
	'a golden savanna at sunset, tall grass swaying in the wind',
	'a bioluminescent forest at midnight, glowing spores in the air',
	'a futuristic city skyline with flying traffic, volumetric haze',
	'an underwater coral reef, sun rays piercing the blue water',
	'a snowy mountain pass in a blizzard, dramatic clouds',
	'a desert canyon at dusk, warm light raking the red rock',
];

const BUNDLED = [
	{ name: 'Aria', url: '/avatars/realistic-female.glb' },
	{ name: 'Kai', url: '/avatars/realistic-male.glb' },
	{ name: 'Michelle', url: '/avatars/michelle.glb' },
	{ name: 'X-Bot', url: '/avatars/xbot.glb' },
	{ name: 'Mona', url: '/avatars/selfie-girl.glb' },
];
const DEFAULT_AVATAR = BUNDLED[0].url;

const JOB_KEY = 'cosmos.job.v1';
const POLL_FIRST_MS = 2500;
const POLL_GROWTH = 1.35;
const POLL_MAX_MS = 15000;
// A cold GPU loads a 35 GB checkpoint before the first step; a 720p transfer
// clip then runs 50 steps. Forty minutes covers both with room to spare.
const POLL_TIMEOUT_MS = 40 * 60 * 1000;
const POLL_NETWORK_FAILURES_MAX = 12;
const REVEAL_FALLBACK_MS = 1200;

const LANE_OFFLINE_COPY =
	'NVIDIA Cosmos world generation is offline right now. Your avatar keeps its living backdrop above; check back soon for generated worlds.';

const SCENE_KINDS = {
	image: { label: 'Still', hint: 'A capture of the stage becomes the first frame. Cosmos animates the world out from it.' },
	depth: { label: 'Depth', hint: 'A depth render of your avatar steers the layout. The prompt paints the world around that shape.' },
	edge: { label: 'Edge', hint: 'An edge render of your avatar steers the layout, keeping outlines and pose detail.' },
};
const PHASES = ['Capture', 'Queue', 'Shot', 'Frames', 'Encode'];

const state = {
	ladder: null, // GET /api/cosmos
	family: 'text', // 'text' | 'scene'
	sceneKind: 'image',
	capture: null, // { kind, dataUrl, previewUrl, bytes, avatar, resolution }
	capturing: false,
	support: { still: false, control: false },
	avatarUrl: null,
	job: null, // { id, startedAt, mode, prompt, model, avatar, seed, resolution, frames }
	pollTimer: null,
	pollDelay: POLL_FIRST_MS,
	pollFailures: 0,
	clock: null,
	lastStatus: null,
	lastVideoUrl: null,
	lastResult: null, // { prompt, mode, model, avatar, seed, timings }
};

// ── small helpers ────────────────────────────────────────────────────────────
function toast(msg) {
	els.toast.textContent = msg;
	els.toast.classList.add('show');
	clearTimeout(toast._t);
	toast._t = setTimeout(() => els.toast.classList.remove('show'), 2400);
}

// Notes render as text plus an optional real <button>. Server copy is never
// interpolated into innerHTML.
function showNote(kind, message, action = null) {
	els.note.className = `cz-note show ${kind}`;
	els.note.replaceChildren(document.createTextNode(message));
	if (!action) return;
	els.note.appendChild(document.createTextNode(' '));
	const btn = document.createElement('button');
	btn.type = 'button';
	btn.textContent = action.label;
	btn.addEventListener('click', action.onClick);
	els.note.appendChild(btn);
}
function clearNote() {
	els.note.className = 'cz-note';
	els.note.replaceChildren();
}

function setBadge(kind, text) {
	els.statusBadge.classList.toggle('is-off', kind === 'off');
	els.statusBadge.classList.toggle('is-idle', kind === 'idle');
	els.statusText.textContent = text;
}

function fmtSeconds(s) {
	if (!Number.isFinite(s) || s < 0) return '';
	const m = Math.floor(s / 60);
	const r = Math.round(s % 60);
	return m ? `${m}m ${String(r).padStart(2, '0')}s` : `${r}s`;
}

function fmtBytes(n) {
	if (!Number.isFinite(n)) return '';
	return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
}

function currentMode() {
	return state.family === 'text' ? 'text' : state.sceneKind;
}

function rungFor(mode) {
	return state.ladder?.rungs?.find((r) => r.configured && r.modes.includes(mode)) || null;
}

function storage() {
	try {
		return window.localStorage;
	} catch {
		return null;
	}
}
function saveJob() {
	const s = storage();
	if (!s) return;
	try {
		if (state.job) s.setItem(JOB_KEY, JSON.stringify(state.job));
		else s.removeItem(JOB_KEY);
	} catch {
		/* storage full or blocked: the job still runs, it just will not resume */
	}
}
function loadSavedJob() {
	try {
		const raw = storage()?.getItem(JOB_KEY);
		if (!raw) return null;
		const job = JSON.parse(raw);
		if (!job?.id || typeof job.id !== 'string' || !Number.isFinite(job.startedAt)) return null;
		if (Date.now() - job.startedAt > POLL_TIMEOUT_MS) return null;
		return job;
	} catch {
		return null;
	}
}

// ── ladder: which modes can be served right now ─────────────────────────────
async function loadLadder() {
	try {
		const res = await fetch('/api/cosmos', { headers: { accept: 'application/json' } });
		if (!res.ok) throw new Error(String(res.status));
		state.ladder = await res.json();
	} catch {
		state.ladder = null;
	}
	applyLadder();
}

function applyLadder() {
	const modes = state.ladder?.modes || [];
	const top = state.ladder?.rungs?.find((r) => r.configured);
	if (!state.ladder) setBadge('idle', 'NVIDIA Cosmos');
	else if (!top) setBadge('off', 'Cosmos offline');
	else setBadge('live', top.label);

	const sceneLive = ['image', 'depth', 'edge'].some((m) => modes.includes(m));
	els.modeScene.disabled = Boolean(state.ladder) && !sceneLive;
	els.modeScene.title = els.modeScene.disabled ? 'Scene worlds need the Cosmos 3 GPU worker, which is offline right now.' : '';
	for (const btn of els.sceneKinds.querySelectorAll('button')) {
		const kind = btn.dataset.kind;
		const served = !state.ladder || modes.includes(kind);
		const capturable = kind === 'image' ? state.support.still : state.support.control;
		btn.disabled = !served || !capturable;
		btn.title = !served
			? `${SCENE_KINDS[kind].label} worlds are offline right now.`
			: !capturable
				? kind === 'image'
					? 'This browser cannot capture WebGL stills.'
					: 'This browser cannot record a WebGL canvas.'
				: SCENE_KINDS[kind].hint;
	}
	if (state.family === 'scene' && els.modeScene.disabled) setFamily('text');
	if (state.family === 'scene') {
		const kindBtn = els.sceneKinds.querySelector(`button[data-kind="${state.sceneKind}"]`);
		if (kindBtn?.disabled) {
			const firstLive = els.sceneKinds.querySelector('button:not(:disabled)');
			if (firstLive) setSceneKind(firstLive.dataset.kind);
		}
	}
	applyLimits();
}

// Prompt length, resolution and length follow the rung that will serve the mode.
function applyLimits() {
	const rung = rungFor(currentMode());
	const max = rung?.limits?.prompt_max || 600;
	els.prompt.maxLength = max;
	if (els.prompt.value.length > max) els.prompt.value = els.prompt.value.slice(0, max);
	updateCount();
	const worker = rung?.kind === 'worker';
	els.resolution.disabled = !worker;
	els.frames.disabled = !worker;
	if (worker) {
		els.foot.textContent = `${rung.label} renders a ${els.frames.selectedOptions[0]?.dataset.label || '5 s'} clip at ${
			els.resolution.value === '480' ? '832×480' : '1280×720'
		} on a dedicated NVIDIA RTX PRO 6000. Average render about ${Math.round((rung.eta_seconds || 180) / 60)} min.`;
	} else if (rung) {
		els.foot.textContent = `${rung.label} renders a 5-second 1280×704 clip from text.`;
	} else {
		els.foot.textContent = 'World generation runs on NVIDIA Cosmos world models.';
	}
}

function updateCount() {
	els.promptCount.textContent = `${els.prompt.value.length} / ${els.prompt.maxLength}`;
}

// ── mode picker ──────────────────────────────────────────────────────────────
function setFamily(family) {
	state.family = family;
	els.modeText.setAttribute('aria-pressed', String(family === 'text'));
	els.modeScene.setAttribute('aria-pressed', String(family === 'scene'));
	els.scene.hidden = family !== 'scene';
	els.modeHint.textContent =
		family === 'text' ? 'Describe a place. Cosmos renders it as a short cinematic clip.' : SCENE_KINDS[state.sceneKind].hint;
	refreshScene();
	applyLimits();
}

function setSceneKind(kind) {
	if (!SCENE_KINDS[kind]) return;
	state.sceneKind = kind;
	for (const btn of els.sceneKinds.querySelectorAll('button')) btn.setAttribute('aria-pressed', String(btn.dataset.kind === kind));
	if (state.family === 'scene') els.modeHint.textContent = SCENE_KINDS[kind].hint;
	refreshScene();
	applyLimits();
}

// A capture belongs to one avatar, one mode and one resolution. Anything else
// is stale and is redone before submit.
function captureFresh() {
	const c = state.capture;
	return Boolean(c && c.kind === state.sceneKind && c.avatar === state.avatarUrl && c.resolution === els.resolution.value);
}

function refreshScene() {
	const fresh = captureFresh();
	els.sceneThumb.replaceChildren();
	if (fresh) {
		const c = state.capture;
		const media = c.kind === 'image' ? document.createElement('img') : document.createElement('video');
		media.src = c.previewUrl;
		if (media.tagName === 'VIDEO') {
			media.muted = true;
			media.loop = true;
			media.autoplay = true;
			media.playsInline = true;
		} else media.alt = 'Captured still of your scene';
		els.sceneThumb.appendChild(media);
		els.sceneEmpty.hidden = true;
		els.sceneMeta.textContent = `${SCENE_KINDS[c.kind].label} · ${c.width}×${c.height} · ${fmtBytes(c.bytes)}`;
		els.sceneCapture.textContent = c.kind === 'image' ? 'Recapture' : 'Record again';
	} else {
		els.sceneEmpty.hidden = false;
		els.sceneEmpty.textContent =
			state.sceneKind === 'image'
				? 'Frame your avatar on the stage, then capture. Generate also captures for you.'
				: 'Frame your avatar on the stage, then record a 4-second orbit. Generate also records for you.';
		els.sceneMeta.textContent = '';
		els.sceneCapture.textContent = state.sceneKind === 'image' ? 'Capture scene' : 'Record scene';
	}
	els.sceneCapture.disabled = state.capturing || Boolean(state.job);
}

async function takeCapture() {
	if (state.capturing) return state.capture;
	state.capturing = true;
	refreshScene();
	const kind = state.sceneKind;
	const resolution = els.resolution.value;
	try {
		let result;
		if (kind === 'image') {
			result = await captureStill({ viewer: els.avatar, world: els.world, resolution });
		} else {
			els.sceneMeta.textContent = 'Recording 0%';
			result = await recordControl({
				viewer: els.avatar,
				avatarUrl: new URL(state.avatarUrl, window.location.href).href,
				mode: kind,
				resolution,
				onProgress: (t) => {
					els.sceneMeta.textContent = `Recording ${Math.round(t * 100)}%`;
					if (state.job?.capturing) renderCaptureProgress(t);
				},
			});
		}
		if (state.capture?.previewUrl) URL.revokeObjectURL(state.capture.previewUrl);
		state.capture = { ...result, avatar: state.avatarUrl, resolution };
		return state.capture;
	} finally {
		state.capturing = false;
		refreshScene();
	}
}

// ── avatars ──────────────────────────────────────────────────────────────────
function selectAvatar(url, { quiet = false } = {}) {
	state.avatarUrl = url;
	els.avatar.setAttribute('src', url);
	for (const tile of els.avatars.querySelectorAll('.cz-av')) {
		tile.classList.toggle('is-active', tile.dataset.url === url);
		tile.setAttribute('aria-pressed', tile.dataset.url === url ? 'true' : 'false');
	}
	refreshScene();
	if (!quiet) toast('Avatar set');
}

function avatarTile({ name, url, image }) {
	const btn = document.createElement('button');
	btn.type = 'button';
	btn.className = 'cz-av';
	btn.dataset.url = url;
	btn.title = name;
	btn.setAttribute('aria-label', `Use avatar ${name}`);
	btn.setAttribute('aria-pressed', 'false');
	const placeholder = () => {
		const ph = document.createElement('span');
		ph.className = 'ph';
		ph.textContent = (name || '?').trim().charAt(0).toUpperCase();
		return ph;
	};
	if (image) {
		const img = document.createElement('img');
		img.src = image;
		img.alt = '';
		img.loading = 'lazy';
		img.addEventListener('error', () => img.replaceWith(placeholder()), { once: true });
		btn.appendChild(img);
	} else {
		btn.appendChild(placeholder());
	}
	btn.addEventListener('click', () => selectAvatar(url));
	return btn;
}

function renderAvatars(list) {
	els.avatars.replaceChildren(...list.map(avatarTile));
}

async function loadCommunityAvatars(base) {
	try {
		const res = await fetch('/api/forge-gallery?scope=community', { headers: { accept: 'application/json' } });
		if (!res.ok) return;
		const data = await res.json();
		const creations = Array.isArray(data?.creations) ? data.creations : [];
		const extra = creations
			.filter((c) => typeof c?.glb_url === 'string' && c.glb_url)
			.slice(0, 5)
			.map((c, i) => ({
				name: c.prompt ? c.prompt.split(/[\s,]/)[0] : `Forge ${i + 1}`,
				url: c.glb_url,
				image: c.preview_image_url || null,
			}));
		if (!extra.length) return;
		const seen = new Set(base.map((b) => b.url));
		const merged = [...base];
		for (const e of extra) if (!seen.has(e.url)) merged.push(e);
		renderAvatars(merged.slice(0, 11));
		selectAvatar(state.avatarUrl || DEFAULT_AVATAR, { quiet: true });
	} catch {
		/* the bundled set stays */
	}
}

// ── progress (the worker's own record) ──────────────────────────────────────
function phaseIndex(status) {
	if (status === 'capturing') return 0;
	if (status === 'queued') return 1;
	if (status === 'upsampling') return 2;
	if (status === 'generating') return 3;
	return 4;
}

function describeStatus(s) {
	const status = s?.status || 'queued';
	if (status === 'queued') {
		if (s.detail === 'model loading') return { label: 'Warming the GPU: loading Cosmos 3 onto the card', fill: 6 };
		if (s.queue_position > 0) return { label: `In the queue: position ${s.queue_position}`, fill: 4 };
		return { label: 'Starting the GPU', fill: 3 };
	}
	if (status === 'upsampling') return { label: 'Writing the shot from your prompt', fill: 10 };
	if (status === 'generating') {
		const p = Number.isFinite(s.progress) ? s.progress : 0;
		const steps = s.total_steps ? `step ${s.step || 0} of ${s.total_steps}` : 'rendering frames';
		const eta = s.eta_seconds > 0 ? `, about ${fmtSeconds(s.eta_seconds)} left` : '';
		return { label: `Rendering frames: ${steps}${eta}`, fill: 14 + Math.round(p * 76) };
	}
	if (status === 'decoding') return { label: 'Decoding frames', fill: 92 };
	if (status === 'encoding') return { label: 'Encoding the clip', fill: 96 };
	if (status === 'done') return { label: 'Done', fill: 100 };
	return { label: 'Working', fill: 50 };
}

function renderPhases(idx) {
	const showCapture = state.job?.mode && state.job.mode !== 'text';
	els.phases.replaceChildren(
		...PHASES.map((name, i) => {
			if (i === 0 && !showCapture) return null;
			const el = document.createElement(i === idx ? 'b' : 'span');
			el.textContent = name;
			if (i < idx) el.className = 'is-past';
			return el;
		}).filter(Boolean),
	);
}

function renderProgressBar(fill, label) {
	els.progLabel.textContent = label;
	els.progFill.style.width = `${fill}%`;
	els.progBar.setAttribute('aria-valuenow', String(fill));
}

function renderCaptureProgress(t) {
	renderProgressBar(Math.round(t * 3), state.sceneKind === 'image' ? 'Capturing your scene' : `Recording your scene: ${Math.round(t * 100)}%`);
	renderPhases(0);
}

function renderStatus(s) {
	state.lastStatus = s;
	const { label, fill } = describeStatus(s);
	renderProgressBar(fill, label);
	renderPhases(phaseIndex(s?.status));
}

function tickClock() {
	if (!state.job) return;
	els.progTime.textContent = fmtSeconds((Date.now() - state.job.startedAt) / 1000);
}

// ── generation lifecycle ────────────────────────────────────────────────────
function setBusy(busy) {
	els.generate.disabled = busy;
	els.generate.classList.toggle('is-busy', busy);
	els.stage.classList.toggle('is-loading', busy);
	els.cancel.hidden = !busy;
	els.regen.hidden = busy || !state.lastVideoUrl;
	els.secondary.hidden = !busy && !state.lastVideoUrl;
	els.modeText.disabled = busy;
	els.modeScene.disabled = busy || (Boolean(state.ladder) && !['image', 'depth', 'edge'].some((m) => state.ladder.modes.includes(m)));
	refreshScene();
	if (busy) {
		clearInterval(state.clock);
		state.clock = setInterval(tickClock, 1000);
		tickClock();
	} else {
		clearInterval(state.clock);
		state.clock = null;
	}
}

function stopPolling() {
	clearTimeout(state.pollTimer);
	state.pollTimer = null;
}

function readOptions() {
	const opts = {};
	const seedVal = els.seed.value.trim();
	if (seedVal && Number.isFinite(Number(seedVal))) opts.seed = Math.max(0, Math.min(2147483647, Math.trunc(Number(seedVal))));
	if (rungFor(currentMode())?.kind === 'worker') {
		opts.resolution = els.resolution.value;
		opts.num_frames = Number(els.frames.value);
	}
	return opts;
}

async function generate() {
	if (state.job) return;
	const prompt = els.prompt.value.replace(/\s+/g, ' ').trim();
	if (prompt.length < 3) {
		showNote('err', 'Describe a world first. Even a few words is enough.');
		els.prompt.focus();
		return;
	}
	const mode = currentMode();
	if (state.ladder && !state.ladder.modes.includes(mode)) {
		return failGeneration(mode === 'text' ? LANE_OFFLINE_COPY : `${SCENE_KINDS[mode].label} worlds are offline right now. Try Text mode.`, {
			offline: mode === 'text',
		});
	}
	clearNote();
	const options = readOptions();
	state.job = {
		id: null,
		startedAt: Date.now(),
		mode,
		prompt,
		avatar: state.avatarUrl,
		seed: options.seed ?? null,
		resolution: options.resolution || null,
		frames: options.num_frames || null,
		model: null,
	};
	els.stage.classList.remove('is-done', 'is-scene-result');
	els.result.hidden = true;
	els.overlay.hidden = true;
	setBusy(true);

	const payload = { mode, prompt, ...options };
	if (mode !== 'text') {
		state.job.capturing = true;
		renderCaptureProgress(0);
		try {
			const capture = captureFresh() ? state.capture : await takeCapture();
			if (!state.job) return;
			if (mode === 'image') payload.image = capture.dataUrl;
			else payload.control_video = capture.dataUrl;
		} catch (err) {
			return failGeneration(err?.message || 'The scene could not be captured. Try again.', { retry: true });
		} finally {
			if (state.job) state.job.capturing = false;
		}
	}
	renderStatus({ status: 'queued' });

	let res;
	let data;
	try {
		res = await fetch('/api/cosmos', {
			method: 'POST',
			headers: { 'content-type': 'application/json', accept: 'application/json' },
			body: JSON.stringify(payload),
		});
		data = await res.json().catch(() => null);
	} catch {
		return failGeneration('Could not reach the Cosmos service. Check your connection and try again.', { retry: true });
	}
	if (!state.job) return;

	if (res.status === 503 || data?.error === 'lane_unavailable') {
		setBadge('off', 'Cosmos offline');
		return failGeneration(data?.message || LANE_OFFLINE_COPY, { offline: true });
	}
	if (res.status === 413) return failGeneration(data?.message || 'The scene recording is too large. Try 480p.', { retry: false });
	if (!res.ok || !data) {
		const retry = data?.retry_after ? ` Try again in about ${fmtSeconds(Number(data.retry_after))}.` : '';
		return failGeneration((data?.message || 'Cosmos could not start this world.') + retry, { retry: res.status !== 400 });
	}
	if (data.status === 'done' && data.video_url) {
		state.job.model = data.model || null;
		return succeed(data.video_url, { model: data.model });
	}
	if (!data.job_id) return failGeneration('Cosmos accepted the request but returned no job to track.', { retry: true });

	state.job.id = data.job_id;
	state.job.model = data.model || null;
	saveJob();
	setBadge('live', rungLabel(data.model));
	renderStatus({ status: 'queued', queue_position: data.queue_position });
	schedulePoll(POLL_FIRST_MS);
}

function rungLabel(id) {
	return state.ladder?.rungs?.find((r) => r.id === id)?.label || 'NVIDIA Cosmos';
}

function schedulePoll(delay) {
	stopPolling();
	state.pollDelay = delay;
	state.pollTimer = setTimeout(poll, delay);
}

function nextDelay() {
	return Math.min(POLL_MAX_MS, Math.round(state.pollDelay * POLL_GROWTH));
}

async function poll() {
	const job = state.job;
	if (!job?.id) return;
	if (Date.now() - job.startedAt > POLL_TIMEOUT_MS) {
		return failGeneration('This world ran far past its usual time. It may still finish on the GPU; start a new one or try 480p.', { retry: true });
	}
	let res;
	let data;
	try {
		res = await fetch(`/api/cosmos?job=${encodeURIComponent(job.id)}`, { headers: { accept: 'application/json' } });
		data = await res.json().catch(() => null);
	} catch {
		state.pollFailures++;
		if (state.pollFailures >= POLL_NETWORK_FAILURES_MAX) {
			return failGeneration('Lost the connection while this world rendered. It keeps rendering; reload the page to pick it up again.', {
				keepJob: true,
			});
		}
		renderProgressBar(describeStatus(state.lastStatus).fill, 'Reconnecting…');
		return schedulePoll(nextDelay());
	}
	if (state.job !== job) return;
	state.pollFailures = 0;

	if (res.status === 429) return schedulePoll(POLL_MAX_MS);
	if (res.status === 503 || data?.error === 'lane_unavailable') {
		setBadge('off', 'Cosmos offline');
		return failGeneration(data?.message || LANE_OFFLINE_COPY, { offline: true });
	}
	if (!res.ok || !data) {
		return failGeneration(data?.message || 'Lost track of this world while it was rendering. Generate it again.', { retry: true });
	}

	renderStatus(data);
	if (data.status === 'done' && data.video_url) return succeed(data.video_url, { model: data.model, timings: data.timings });
	if (data.status === 'failed') return failGeneration(data.error || 'Cosmos could not finish this world. Try a different prompt.', { retry: true });
	// Speed up again once real work starts so step progress feels live.
	const delay = data.status === 'generating' ? Math.min(nextDelay(), 6000) : nextDelay();
	schedulePoll(delay);
}

function showTimings(model, timings) {
	els.resultModel.textContent = rungLabel(model);
	const parts = [];
	if (timings?.sample_s != null) parts.push(`render ${fmtSeconds(timings.sample_s)}`);
	if (timings?.upsample_s) parts.push(`shot ${fmtSeconds(timings.upsample_s)}`);
	if (timings?.control_s) parts.push(`control ${fmtSeconds(timings.control_s)}`);
	if (timings?.encode_s != null) parts.push(`encode ${fmtSeconds(timings.encode_s)}`);
	if (timings?.total_s != null) parts.push(`total ${fmtSeconds(timings.total_s)}`);
	els.resultTimes.textContent = parts.join(' · ');
	els.result.hidden = false;
}

function succeed(videoUrl, { model, timings } = {}) {
	stopPolling();
	const job = state.job;
	state.lastVideoUrl = videoUrl;
	state.lastResult = {
		prompt: job?.prompt || els.prompt.value.trim(),
		mode: job?.mode || 'text',
		model: model || job?.model || null,
		avatar: job?.avatar || state.avatarUrl,
		seed: job?.seed ?? null,
	};
	const v = els.world;
	let revealTimer = null;
	const reveal = () => {
		clearTimeout(revealTimer);
		v.classList.add('is-live');
		v.play().catch(() => {});
	};
	v.oncanplay = reveal;
	v.onerror = () => {
		clearTimeout(revealTimer);
		v.classList.remove('is-live');
		v.setAttribute('aria-hidden', 'true');
		els.stage.classList.remove('is-done');
		state.lastVideoUrl = null;
		failGeneration('The world rendered but its clip would not play. Generate it again.', { retry: true });
	};
	v.src = videoUrl;
	v.removeAttribute('aria-hidden');
	revealTimer = setTimeout(reveal, REVEAL_FALLBACK_MS);

	// A scene world already contains the avatar, so the live overlay steps back
	// (the toggle brings it in front again).
	const sceneResult = state.lastResult.mode !== 'text';
	els.stage.classList.toggle('is-scene-result', sceneResult);
	els.overlay.hidden = !sceneResult;
	els.overlay.setAttribute('aria-pressed', 'false');

	state.job = null;
	saveJob();
	setBusy(false);
	els.stage.classList.add('is-done');
	if (state.lastResult.model) showTimings(state.lastResult.model, timings);
	clearNote();
	toast('Your world is alive');
}

function failGeneration(message, { offline = false, retry = false, keepJob = false } = {}) {
	stopPolling();
	if (!keepJob) {
		state.job = null;
		saveJob();
	} else {
		state.job = null;
	}
	setBusy(false);
	showNote(offline ? 'info' : 'err', message, retry && !offline ? { label: 'Retry', onClick: () => generate() } : null);
}

function cancelJob() {
	// Cancel stops watching. The worker finishes a render it already started (a
	// GPU step cannot be interrupted mid-denoise), so the lane stays honest.
	stopPolling();
	state.job = null;
	saveJob();
	setBusy(false);
	showNote('info', 'Stopped watching this world. Tweak the prompt or the scene and try again.');
}

// ── result actions ──────────────────────────────────────────────────────────
function slug(text) {
	return (
		String(text || 'world')
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '')
			.slice(0, 40) || 'world'
	);
}

async function downloadClip() {
	if (!state.lastVideoUrl) {
		toast('Generate a world first');
		return;
	}
	const name = `cosmos-${state.lastResult?.mode || 'text'}-${slug(state.lastResult?.prompt)}.mp4`;
	try {
		const res = await fetch(state.lastVideoUrl);
		if (!res.ok) throw new Error(String(res.status));
		const blob = await res.blob();
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = name;
		document.body.appendChild(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(a.href), 4000);
		toast('Downloading MP4');
	} catch {
		window.open(state.lastVideoUrl, '_blank', 'noopener');
	}
}

async function shareLink() {
	if (!state.lastVideoUrl) {
		toast('Generate a world first');
		return;
	}
	const url = new URL(window.location.href);
	url.search = '';
	url.searchParams.set('prompt', state.lastResult?.prompt || '');
	url.searchParams.set('world', state.lastVideoUrl);
	if (state.lastResult?.mode && state.lastResult.mode !== 'text') url.searchParams.set('mode', state.lastResult.mode);
	if (state.lastResult?.avatar) url.searchParams.set('avatar', state.lastResult.avatar);
	if (state.lastResult?.seed != null) url.searchParams.set('seed', String(state.lastResult.seed));
	const link = url.toString();
	try {
		await navigator.clipboard.writeText(link);
		toast('Shareable link copied');
	} catch {
		window.prompt('Copy this link:', link);
	}
}

function toggleOverlay() {
	const showing = els.overlay.getAttribute('aria-pressed') === 'true';
	els.overlay.setAttribute('aria-pressed', String(!showing));
	els.stage.classList.toggle('is-scene-result', showing);
}

// ── resume ──────────────────────────────────────────────────────────────────
function resumeJob(saved) {
	state.job = saved;
	els.prompt.value = saved.prompt || '';
	updateCount();
	if (saved.mode && saved.mode !== 'text') {
		state.sceneKind = SCENE_KINDS[saved.mode] ? saved.mode : 'image';
		setFamily('scene');
		setSceneKind(state.sceneKind);
	}
	if (saved.avatar) selectAvatar(saved.avatar, { quiet: true });
	setBusy(true);
	renderStatus({ status: 'queued' });
	showNote('info', 'Picked up the world you started earlier. It kept rendering while you were away.');
	poll();
}

// ── init ────────────────────────────────────────────────────────────────────
function init() {
	state.support = sceneCaptureSupport();

	for (const idea of IDEAS) {
		const chip = document.createElement('button');
		chip.type = 'button';
		chip.className = 'cz-chip';
		chip.textContent = idea.split(',')[0];
		chip.title = idea;
		chip.addEventListener('click', () => {
			els.prompt.value = idea;
			updateCount();
			els.prompt.focus();
		});
		els.chips.appendChild(chip);
	}

	const params = new URLSearchParams(window.location.search);
	const deepAvatar = params.get('avatar') || params.get('model');
	let base = BUNDLED;
	if (deepAvatar && /^https?:\/\/|^\//.test(deepAvatar) && !BUNDLED.some((b) => b.url === deepAvatar)) {
		base = [{ name: 'Yours', url: deepAvatar }, ...BUNDLED];
	}
	renderAvatars(base);
	selectAvatar(deepAvatar && /^https?:\/\/|^\//.test(deepAvatar) ? deepAvatar : DEFAULT_AVATAR, { quiet: true });

	const deepPrompt = params.get('prompt');
	if (deepPrompt) els.prompt.value = deepPrompt.slice(0, 600);
	const deepSeed = params.get('seed');
	if (deepSeed && Number.isFinite(Number(deepSeed))) els.seed.value = String(Math.trunc(Number(deepSeed)));
	const deepMode = params.get('mode');
	if (deepMode && SCENE_KINDS[deepMode]) {
		state.sceneKind = deepMode;
		setFamily('scene');
	}
	setSceneKind(state.sceneKind);
	setFamily(state.family);

	const deepWorld = params.get('world');
	if (deepWorld && /^https:\/\/[^\s]+\.mp4(\?[^\s]*)?$/i.test(deepWorld)) {
		succeed(deepWorld, {});
		els.result.hidden = true;
	}

	els.modeText.addEventListener('click', () => setFamily('text'));
	els.modeScene.addEventListener('click', () => setFamily('scene'));
	for (const btn of els.sceneKinds.querySelectorAll('button')) btn.addEventListener('click', () => setSceneKind(btn.dataset.kind));
	els.sceneCapture.addEventListener('click', async () => {
		clearNote();
		try {
			await takeCapture();
			toast(state.sceneKind === 'image' ? 'Scene captured' : 'Scene recorded');
		} catch (err) {
			showNote('err', err?.message || 'The scene could not be captured. Try again.');
		}
	});
	els.resolution.addEventListener('change', () => {
		refreshScene();
		applyLimits();
	});
	els.frames.addEventListener('change', applyLimits);
	els.generate.addEventListener('click', generate);
	els.regen.addEventListener('click', generate);
	els.cancel.addEventListener('click', cancelJob);
	els.download.addEventListener('click', downloadClip);
	els.copy.addEventListener('click', shareLink);
	els.overlay.addEventListener('click', toggleOverlay);
	els.prompt.addEventListener('input', updateCount);
	els.prompt.addEventListener('keydown', (e) => {
		if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') generate();
	});
	document.addEventListener('keydown', (e) => {
		if (e.key === 'Escape' && state.job?.id) cancelJob();
	});
	els.avatar.addEventListener('error', () => {
		if (state.avatarUrl !== DEFAULT_AVATAR) {
			showNote('info', 'That avatar could not load, so the stage fell back to a default. Pick another below.');
			selectAvatar(DEFAULT_AVATAR, { quiet: true });
		}
	});

	loadCommunityAvatars(base);
	loadLadder().then(() => {
		const saved = loadSavedJob();
		if (saved && !deepWorld) resumeJob(saved);
	});
}

init();
