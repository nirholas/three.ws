// Driver for the isolated TRELLIS NIM image→3D demo (/nim-forge).
//
// Fully standalone: it talks ONLY to /api/nim-forge, which proxies a self-hosted
// Microsoft TRELLIS NIM. The browser downscales the chosen photo before upload
// (keeps the request small + gives TRELLIS a clean single-object view), posts it,
// and renders the returned GLB in <model-viewer> from an in-memory blob URL — no
// R2, no production Forge code involved.

const API = '/api/nim-forge';
const MAX_EDGE = 1024; // downscale longest edge to this before upload
const JPEG_QUALITY = 0.9;

const $ = (id) => document.getElementById(id);
const els = {
	badge: $('status-badge'),
	statusText: $('status-text'),
	modeImage: $('mode-image'),
	modeText: $('mode-text'),
	paneImage: $('pane-image'),
	paneText: $('pane-text'),
	drop: $('drop'),
	file: $('file'),
	preview: $('preview'),
	clear: $('clear'),
	prompt: $('prompt'),
	tiers: $('tiers'),
	generate: $('generate'),
	stage: $('stage'),
	panelEmpty: $('panel-empty'),
	panelLoading: $('panel-loading'),
	panelError: $('panel-error'),
	errorMsg: $('error-msg'),
	elapsed: $('elapsed'),
	substep: $('substep'),
	viewer: $('viewer'),
	resultbar: $('resultbar'),
	resultMeta: $('result-meta'),
	download: $('download'),
};

const state = {
	mode: 'image',
	tier: 'standard',
	imageDataUri: null,
	busy: false,
	// null until the readiness check answers; false means the server said no
	// NIM is wired, so nothing this page sends could succeed.
	configured: null,
	blobUrl: null,
	timer: null,
};

// ── Readiness badge ─────────────────────────────────────────────────────────
async function checkReadiness() {
	try {
		const res = await fetch(API, { method: 'GET' });
		const data = await res.json();
		state.configured = Boolean(data.configured);
		if (data.configured) {
			els.badge.dataset.state = 'up';
			els.statusText.textContent = 'NIM online · /v1/infer';
		} else {
			els.badge.dataset.state = 'down';
			els.statusText.textContent = 'NIM not configured';
			showOffline();
		}
		updateGenerate();
	} catch {
		// Unknown, not absent: leave Generate usable so the server's own answer
		// (and its error message) reaches the user.
		els.badge.dataset.state = 'down';
		els.statusText.textContent = 'engine unreachable';
	}
}

// The stage panel for a deployment with no NIM wired. Built here rather than
// in the page markup so the page's translated copy never overwrites it.
function showOffline() {
	let panel = document.getElementById('panel-offline');
	if (!panel) {
		panel = document.createElement('div');
		panel.className = 'nf-panel';
		panel.id = 'panel-offline';
		panel.setAttribute('role', 'status');
		const body = document.createElement('div');
		const title = document.createElement('h2');
		title.textContent = 'No TRELLIS NIM is wired here';
		const text = document.createElement('p');
		text.append(
			'This demo talks only to a self-hosted Microsoft TRELLIS NIM, and this deployment has none. Set ',
			Object.assign(document.createElement('code'), { textContent: 'NIM_TRELLIS_URL' }),
			' to wire one, point the NIM console at your own container, or make the model on the hosted Forge.',
		);
		const actions = document.createElement('div');
		actions.className = 'nf-actions';
		actions.append(
			Object.assign(document.createElement('a'), { className: 'nf-download', href: '/forge', textContent: 'Open the hosted Forge' }),
			Object.assign(document.createElement('a'), { className: 'nf-download', href: '/forge-nim', textContent: 'Use your own NIM endpoint' }),
		);
		body.append(title, text, actions);
		panel.append(body);
		els.stage.prepend(panel);
	}
	showPanel('offline');
}

// ── Mode switch ─────────────────────────────────────────────────────────────
function setMode(mode) {
	state.mode = mode;
	const isImage = mode === 'image';
	els.modeImage.setAttribute('aria-pressed', String(isImage));
	els.modeText.setAttribute('aria-pressed', String(!isImage));
	els.paneImage.hidden = !isImage;
	els.paneText.hidden = isImage;
	updateGenerate();
}

// ── Tier switch ─────────────────────────────────────────────────────────────
function setTier(tier) {
	state.tier = tier;
	for (const b of els.tiers.querySelectorAll('button')) {
		b.setAttribute('aria-pressed', String(b.dataset.tier === tier));
	}
}

// ── Image handling: downscale to a clean data-uri ───────────────────────────
function fileToDownscaledDataUri(file) {
	return new Promise((resolve, reject) => {
		const img = new Image();
		const url = URL.createObjectURL(file);
		img.onload = () => {
			URL.revokeObjectURL(url);
			const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
			const w = Math.max(1, Math.round(img.width * scale));
			const h = Math.max(1, Math.round(img.height * scale));
			const canvas = document.createElement('canvas');
			canvas.width = w;
			canvas.height = h;
			const ctx = canvas.getContext('2d');
			// White matte so PNGs with transparency don't reconstruct against black.
			ctx.fillStyle = '#ffffff';
			ctx.fillRect(0, 0, w, h);
			ctx.drawImage(img, 0, 0, w, h);
			resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
		};
		img.onerror = () => {
			URL.revokeObjectURL(url);
			reject(new Error('Could not read that image.'));
		};
		img.src = url;
	});
}

async function acceptFile(file) {
	if (!file || !file.type.startsWith('image/')) {
		showError('Please choose a PNG, JPEG, or WebP image.');
		return;
	}
	try {
		const dataUri = await fileToDownscaledDataUri(file);
		state.imageDataUri = dataUri;
		els.preview.src = dataUri;
		els.preview.hidden = false;
		els.drop.classList.add('has-image');
		updateGenerate();
	} catch (err) {
		showError(err.message || 'Could not read that image.');
	}
}

function clearImage() {
	state.imageDataUri = null;
	els.preview.src = '';
	els.preview.hidden = true;
	els.drop.classList.remove('has-image');
	els.file.value = '';
	updateGenerate();
}

// ── Generate button enablement ──────────────────────────────────────────────
function updateGenerate() {
	if (state.busy) return;
	if (state.configured === false) {
		els.generate.disabled = true;
		els.generate.textContent = 'NIM not configured';
		return;
	}
	const ready = state.mode === 'image' ? Boolean(state.imageDataUri) : els.prompt.value.trim().length >= 3;
	els.generate.disabled = !ready;
	els.generate.textContent = ready
		? 'Generate'
		: state.mode === 'image'
			? 'Add a photo to start'
			: 'Describe an object to start';
}

// ── Stage panel switching ───────────────────────────────────────────────────
function showPanel(which) {
	document.getElementById('panel-offline')?.classList.toggle('is-active', which === 'offline');
	els.panelEmpty.classList.toggle('is-active', which === 'empty');
	els.panelLoading.classList.toggle('is-active', which === 'loading');
	els.panelError.classList.toggle('is-active', which === 'error');
	els.viewer.classList.toggle('is-active', which === 'result');
	els.resultbar.classList.toggle('is-active', which === 'result');
}

function showError(msg) {
	stopTimer();
	els.errorMsg.textContent = msg;
	showPanel('error');
	state.busy = false;
	updateGenerate();
}

function startTimer() {
	const t0 = performance.now();
	els.elapsed.textContent = '0.0s';
	state.timer = setInterval(() => {
		els.elapsed.textContent = `${((performance.now() - t0) / 1000).toFixed(1)}s`;
	}, 100);
}
function stopTimer() {
	if (state.timer) {
		clearInterval(state.timer);
		state.timer = null;
	}
}

// ── Generate ────────────────────────────────────────────────────────────────
async function generate() {
	if (state.busy || state.configured === false) return;
	const payload = { tier: state.tier };
	if (state.mode === 'image') {
		if (!state.imageDataUri) return;
		payload.image = state.imageDataUri;
	} else {
		const p = els.prompt.value.trim();
		if (p.length < 3) return;
		payload.prompt = p;
	}

	state.busy = true;
	els.generate.disabled = true;
	els.generate.textContent = 'Generating…';
	els.substep.textContent = state.mode === 'image' ? 'Reconstructing mesh on the NIM…' : 'Generating mesh on the NIM…';
	showPanel('loading');
	startTimer();

	let data;
	try {
		const res = await fetch(API, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(payload),
		});
		data = await res.json().catch(() => ({}));
		if (!res.ok) throw new Error(data.message || `Request failed (${res.status}).`);
	} catch (err) {
		showError(err.message || 'The NIM request failed.');
		return;
	}

	if (!data.glb_base64) {
		showError(data.message || 'The NIM returned no model.');
		return;
	}

	// Decode base64 → Blob → object URL for <model-viewer>.
	try {
		const bytes = Uint8Array.from(atob(data.glb_base64), (c) => c.charCodeAt(0));
		const blob = new Blob([bytes], { type: 'model/gltf-binary' });
		if (state.blobUrl) URL.revokeObjectURL(state.blobUrl);
		state.blobUrl = URL.createObjectURL(blob);
		els.viewer.setAttribute('src', state.blobUrl);
		els.download.href = state.blobUrl;
		const kb = (data.bytes / 1024).toFixed(0);
		const secs = (data.ms / 1000).toFixed(1);
		els.resultMeta.innerHTML = `<b>${kb} KB</b> GLB · ${secs}s · ${data.steps ?? '—'} steps · TRELLIS NIM`;
		showPanel('result');
	} catch {
		showError('Could not decode the returned model.');
		return;
	}

	stopTimer();
	state.busy = false;
	updateGenerate();
}

// ── Wire up ─────────────────────────────────────────────────────────────────
els.modeImage.addEventListener('click', () => setMode('image'));
els.modeText.addEventListener('click', () => setMode('text'));
els.tiers.addEventListener('click', (e) => {
	const btn = e.target.closest('button[data-tier]');
	if (btn) setTier(btn.dataset.tier);
});
els.file.addEventListener('change', (e) => {
	const f = e.target.files?.[0];
	if (f) acceptFile(f);
});
els.clear.addEventListener('click', (e) => {
	e.preventDefault();
	e.stopPropagation();
	clearImage();
});
els.prompt.addEventListener('input', updateGenerate);
els.generate.addEventListener('click', generate);

// Drag + drop onto the drop zone.
['dragenter', 'dragover'].forEach((ev) =>
	els.drop.addEventListener(ev, (e) => {
		e.preventDefault();
		els.drop.classList.add('is-over');
	}),
);
['dragleave', 'drop'].forEach((ev) =>
	els.drop.addEventListener(ev, (e) => {
		e.preventDefault();
		els.drop.classList.remove('is-over');
	}),
);
els.drop.addEventListener('drop', (e) => {
	const f = e.dataTransfer?.files?.[0];
	if (f) acceptFile(f);
});

// When the model finishes loading, drop the spinner if it was somehow still up.
els.viewer.addEventListener('load', () => {
	if (!state.busy) showPanel('result');
});
els.viewer.addEventListener('error', () => {
	if (!state.busy) showError('The viewer could not load the model.');
});

checkReadiness();
updateGenerate();
