// Widget Studio — three-column UI for creating + editing widgets.
// Native DOM, no framework. Uses /api/widgets and /api/avatars.
//
// Type registry is inlined here (rather than imported from /src/) because
// /public/* is served verbatim by Vercel — the build doesn't transform it.
// Keep this list in sync with src/widget-types.js as new types light up.

const WIDGET_TYPES = {
	turntable: {
		label: 'Turntable Showcase',
		desc: 'Hero banner — auto-rotate, no UI, just the avatar.',
		status: 'ready',
		icon: '◎',
	},
	'animation-gallery': {
		label: 'Animation Gallery',
		desc: 'Click through every clip on a rigged avatar.',
		status: 'pending',
		icon: '▶',
	},
	'talking-agent': {
		label: 'Talking Agent',
		desc: 'Embodied chat — your agent on your site.',
		status: 'pending',
		icon: '◐',
	},
	passport: {
		label: 'ERC-8004 Passport',
		desc: 'On-chain identity card for any agent.',
		status: 'ready',
		icon: '◊',
	},
	'hotspot-tour': {
		label: 'Hotspot Tour',
		desc: 'Annotated 3D scene with clickable POIs.',
		status: 'pending',
		icon: '⌖',
	},
};

const BRAND_DEFAULTS = Object.freeze({
	background: '#0a0a0a',
	accent: '#8b5cf6',
	caption: '',
	showControls: true,
	autoRotate: true,
	envPreset: 'neutral',
	cameraPosition: null,
});

const TYPE_DEFAULTS = {
	turntable: { rotationSpeed: 0.5 },
	'animation-gallery': { defaultClip: '', loopAll: false, showClipPicker: true },
	'talking-agent': { greeting: 'Hi! What would you like to know?', brain: 'none', proxyURL: '' },
	passport: {
		chain: 'base-sepolia',
		agentId: null,
		wallet: null,
		showReputation: true,
		showRecentFeedback: true,
		layout: 'portrait',
		rotationSpeed: 0.6,
	},
	'hotspot-tour': { hotspots: [] },
};

function defaultConfig(type) {
	return { ...BRAND_DEFAULTS, ...(TYPE_DEFAULTS[type] || {}) };
}

const $ = (sel, root = document) => root.querySelector(sel);

const layoutEl = $('#studio-layout');
const blockerEl = $('#auth-blocker');
const signinLink = $('#signin-link');
const formEl = $('#config-form');
const errEl = $('#form-error');
const previewIfr = $('#preview-iframe');
const previewSt = $('#preview-status');
const captureBtn = $('#capture-camera-btn');
const saveBtn = $('#save-draft-btn');
const generateBtn = $('#generate-btn');
const toastEl = $('#toast');

const state = {
	user: null,
	avatars: [],
	avatarId: null,
	type: 'turntable',
	editingId: null,
	config: defaultConfig('turntable'),
	name: '',
	is_public: true,
	preselectedModel: null,
};

const params = new URLSearchParams(location.search);
const editId = params.get('edit');
const tplId = params.get('template');
const pickType = params.get('type');
const preModel = params.get('model');

if (pickType && WIDGET_TYPES[pickType]) state.type = pickType;
if (preModel) state.preselectedModel = preModel;

(async function boot() {
	signinLink.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
	const me = await fetchMe();
	if (!me) {
		blockerEl.classList.add('visible');
		return;
	}
	state.user = me;
	layoutEl.hidden = false;

	renderTypeGrid();
	renderTypeFields();
	wireForm();
	wireButtons();

	await loadAvatars();

	if (editId) await loadForEdit(editId);
	else if (tplId) await cloneTemplate(tplId);
	else if (state.preselectedModel) selectByModelUrl(state.preselectedModel);

	updatePreview(true);
})();

// ── data ─────────────────────────────────────────────────────────────────────
async function fetchMe() {
	try {
		const res = await fetch('/api/auth/me', { credentials: 'include' });
		if (!res.ok) return null;
		const { user } = await res.json();
		return user || null;
	} catch {
		return null;
	}
}

async function loadAvatars() {
	const list = $('#avatar-list');
	try {
		const res = await fetch('/api/avatars?limit=100', { credentials: 'include' });
		if (!res.ok) throw new Error(`avatars: ${res.status}`);
		const { avatars = [] } = await res.json();
		state.avatars = avatars;
		list.removeAttribute('aria-busy');
		renderAvatarList();
	} catch (err) {
		list.removeAttribute('aria-busy');
		list.innerHTML = `<div class="empty">Couldn't load avatars: ${escapeHtml(err.message)}</div>`;
	}
}

async function loadForEdit(id) {
	try {
		const res = await fetch(`/api/widgets/${encodeURIComponent(id)}`, {
			credentials: 'include',
		});
		if (!res.ok) return;
		const { widget } = await res.json();
		state.editingId = widget.id;
		state.type = widget.type;
		state.avatarId = widget.avatar_id;
		state.name = widget.name || '';
		state.config = { ...defaultConfig(widget.type), ...(widget.config || {}) };
		state.is_public = widget.is_public;
		hydrateForm();
		renderTypeGrid();
		renderAvatarList();
		renderTypeFields();
	} catch (err) {
		console.warn('[studio] edit load failed', err);
	}
}

async function cloneTemplate(id) {
	try {
		const res = await fetch(`/api/widgets/${encodeURIComponent(id)}`);
		if (!res.ok) return;
		const { widget } = await res.json();
		state.type = widget.type;
		state.config = { ...defaultConfig(widget.type), ...(widget.config || {}) };
		state.name = `Copy of ${widget.name}`;
		// avatarId stays unset — user must pick their own
		hydrateForm();
		renderTypeGrid();
		renderTypeFields();
	} catch {
		/* ignore */
	}
}

// ── rendering ────────────────────────────────────────────────────────────────
function renderAvatarList() {
	const list = $('#avatar-list');
	if (!state.avatars.length) {
		list.innerHTML = `<div class="empty">No avatars yet. <a href="/dashboard#upload">Upload one →</a></div>`;
		return;
	}
	list.innerHTML = '';
	for (const a of state.avatars) {
		const card = document.createElement('button');
		card.type = 'button';
		card.className = 'avatar-card' + (a.id === state.avatarId ? ' selected' : '');
		card.dataset.id = a.id;
		card.setAttribute('aria-pressed', String(a.id === state.avatarId));
		const thumb = a.thumbnail_url
			? `<div class="thumb"><img src="${attr(a.thumbnail_url)}" alt="" loading="lazy"></div>`
			: `<div class="thumb">◎</div>`;
		card.innerHTML = `${thumb}<span class="name">${escapeHtml(a.name || a.slug || a.id)}</span>`;
		card.addEventListener('click', () => selectAvatar(a.id));
		list.appendChild(card);
	}
}

function renderTypeGrid() {
	const grid = $('#type-grid');
	grid.innerHTML = '';
	for (const [key, t] of Object.entries(WIDGET_TYPES)) {
		const card = document.createElement('button');
		card.type = 'button';
		card.className = 'type-card' + (key === state.type ? ' selected' : '');
		card.setAttribute('aria-pressed', String(key === state.type));
		card.innerHTML = `
			<span class="icon" aria-hidden="true">${t.icon}</span>
			<span class="label">${escapeHtml(t.label)}</span>
			<span class="desc">${escapeHtml(t.desc)}</span>
			${t.status === 'pending' ? '<span class="pending">Coming soon</span>' : ''}
		`;
		card.addEventListener('click', () => selectType(key));
		grid.appendChild(card);
	}
}

function renderTypeFields() {
	const wrap = $('#type-fields');
	wrap.innerHTML = '';
	const t = WIDGET_TYPES[state.type];
	if (t.status === 'pending') {
		const banner = document.createElement('div');
		banner.className = 'pending-banner';
		banner.textContent = `${t.label} runtime ships in a later prompt. You can still save the config; it'll light up when the runtime lands.`;
		wrap.appendChild(banner);
		return;
	}
	if (state.type === 'turntable') {
		wrap.appendChild(
			numberField('rotationSpeed', 'Rotation speed', state.config.rotationSpeed ?? 0.5, {
				min: 0,
				max: 10,
				step: 0.1,
			}),
		);
	}
}

function numberField(name, label, value, { min, max, step }) {
	const f = document.createElement('label');
	f.className = 'field';
	f.innerHTML = `<span>${escapeHtml(label)}</span>
		<input type="number" name="${attr(name)}" value="${attr(String(value))}" min="${min}" max="${max}" step="${step}">`;
	f.querySelector('input').addEventListener('input', (e) => {
		const v = parseFloat(e.target.value);
		if (!isNaN(v)) {
			state.config[name] = v;
			schedulePreview();
		}
	});
	return f;
}

// ── interaction ──────────────────────────────────────────────────────────────
function selectAvatar(id) {
	state.avatarId = id;
	renderAvatarList();
	updatePreview(true);
	captureBtn.disabled = false;
}

function selectByModelUrl(url) {
	const urlPath = (() => {
		try {
			return new URL(url, location.origin).pathname;
		} catch {
			return url;
		}
	})();
	const found = state.avatars.find((a) => {
		if (!a.model_url) return false;
		if (a.model_url === url) return true;
		try {
			return new URL(a.model_url).pathname === urlPath;
		} catch {
			return false;
		}
	});
	if (found) selectAvatar(found.id);
}

function selectType(key) {
	if (state.type === key) return;
	state.type = key;
	state.config = { ...defaultConfig(key), ...pickBrand(state.config) };
	renderTypeGrid();
	renderTypeFields();
	updatePreview(true);
}

function pickBrand(cfg) {
	const out = {};
	for (const k of Object.keys(BRAND_DEFAULTS)) {
		if (cfg[k] !== undefined) out[k] = cfg[k];
	}
	return out;
}

function wireForm() {
	hydrateForm();
	formEl.addEventListener('input', (e) => {
		const t = e.target;
		if (!t.name) return;
		const val = t.type === 'checkbox' ? t.checked : t.value;
		if (t.name === 'name') state.name = val;
		else if (t.name === 'is_public') state.is_public = val;
		else state.config[t.name] = val;
		schedulePreview();
	});
}

function hydrateForm() {
	for (const el of formEl.elements) {
		if (!el.name) continue;
		if (el.name === 'name') el.value = state.name || '';
		else if (el.name === 'is_public') el.checked = !!state.is_public;
		else if (el.type === 'checkbox') el.checked = !!state.config[el.name];
		else if (state.config[el.name] !== undefined) el.value = state.config[el.name];
	}
}

function wireButtons() {
	$('#signout-btn').addEventListener('click', async () => {
		await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
		try {
			localStorage.removeItem('3dagent:auth-hint');
		} catch {
			/* ignore */
		}
		location.href = '/';
	});

	captureBtn.addEventListener('click', () => {
		try {
			const w = previewIfr.contentWindow;
			const cam = w?.VIEWER?.viewer?.activeCamera;
			if (!cam) return toast('Preview not ready');
			state.config.cameraPosition = [cam.position.x, cam.position.y, cam.position.z];
			toast('Camera captured');
			updatePreview(true);
		} catch {
			toast('Could not read camera');
		}
	});

	saveBtn.addEventListener('click', () => save({ generate: false }));
	generateBtn.addEventListener('click', () => save({ generate: true }));

	$('#embed-modal-close').addEventListener('click', () => {
		$('#embed-modal').hidden = true;
	});

	for (const btn of document.querySelectorAll('[data-copy]')) {
		btn.addEventListener('click', () => copyFromSelector(btn.dataset.copy, btn));
	}
}

// ── preview ──────────────────────────────────────────────────────────────────
let previewTimer = null;
let previewSrcKey = '';

function schedulePreview() {
	clearTimeout(previewTimer);
	previewTimer = setTimeout(() => updatePreview(false), 200);
}

function updatePreview(forceReload) {
	if (!state.avatarId && !state.preselectedModel) {
		previewSt.textContent = 'Pick an avatar to preview';
		return;
	}
	const avatar = state.avatars.find((a) => a.id === state.avatarId);
	const modelUrl = avatar?.model_url || state.preselectedModel;
	if (!modelUrl) {
		previewSt.textContent = 'Avatar has no public URL — make it public/unlisted to preview';
		return;
	}
	previewSt.textContent = state.avatarId
		? 'Live preview'
		: 'Preview only — pick an avatar from your library to save';
	if (!state.avatarId) captureBtn.disabled = false;

	const camStr = Array.isArray(state.config.cameraPosition)
		? `&cameraPosition=${state.config.cameraPosition.map((n) => n.toFixed(3)).join(',')}`
		: '';
	const presetStr =
		state.config.envPreset && state.config.envPreset !== 'none'
			? `&preset=${encodeURIComponent(state.config.envPreset)}`
			: '';
	const src = `/?widget-preview=1#model=${encodeURIComponent(modelUrl)}&kiosk=true${camStr}${presetStr}`;
	const key = src;
	if (forceReload || key !== previewSrcKey) {
		previewSrcKey = key;
		previewIfr.src = src;
	}
	postConfigToPreview();
}

function postConfigToPreview() {
	if (!previewIfr.contentWindow) return;
	try {
		previewIfr.contentWindow.postMessage(
			{ type: 'widget:config', config: { ...state.config } },
			location.origin,
		);
	} catch {
		/* iframe may not be ready yet — full reload covers it */
	}
}

// ── save / generate ──────────────────────────────────────────────────────────
async function save({ generate }) {
	errEl.hidden = true;

	if (!state.name?.trim()) return showError('Name is required');
	if (!state.avatarId) return showError('Pick an avatar first');
	if (!WIDGET_TYPES[state.type]) return showError('Pick a widget type');

	const body = {
		type: state.type,
		name: state.name.trim(),
		avatar_id: state.avatarId,
		is_public: state.is_public,
		config: state.config,
	};

	const url = state.editingId
		? `/api/widgets/${encodeURIComponent(state.editingId)}`
		: '/api/widgets';
	const method = state.editingId ? 'PATCH' : 'POST';
	const sendBody = state.editingId
		? {
				name: body.name,
				avatar_id: body.avatar_id,
				is_public: body.is_public,
				config: body.config,
			}
		: body;

	saveBtn.disabled = true;
	generateBtn.disabled = true;
	try {
		const res = await fetch(url, {
			method,
			credentials: 'include',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(sendBody),
		});
		if (!res.ok) {
			const data = await res.json().catch(() => ({}));
			throw new Error(data.error_description || `save failed: ${res.status}`);
		}
		const { widget } = await res.json();
		state.editingId = widget.id;
		const newUrl = new URL(location.href);
		newUrl.searchParams.set('edit', widget.id);
		newUrl.searchParams.delete('template');
		newUrl.searchParams.delete('model');
		history.replaceState(null, '', newUrl);

		if (generate) openEmbedModal(widget);
		else toast('Saved');
	} catch (err) {
		showError(err.message);
	} finally {
		saveBtn.disabled = false;
		generateBtn.disabled = false;
	}
}

function openEmbedModal(widget) {
	const origin = location.origin;
	const shareUrl = `${origin}/w/${widget.id}`;
	const embedUrl = `${origin}/app#widget=${widget.id}&kiosk=true`;
	$('#embed-share-url').value = shareUrl;
	$('#embed-iframe-snippet').value =
		`<iframe src="${embedUrl}" width="600" height="600" style="border:0;border-radius:12px" allow="autoplay; xr-spatial-tracking" loading="lazy"></iframe>`;
	$('#embed-script-snippet').value =
		`<script async src="${origin}/embed.js" data-widget="${widget.id}"></` + 'script>';
	$('#embed-preview-iframe').src = embedUrl;
	$('#embed-modal').hidden = false;
}

function copyFromSelector(sel, btn) {
	const el = $(sel);
	if (!el) return;
	el.select?.();
	navigator.clipboard.writeText(el.value).then(
		() => {
			const o = btn.textContent;
			btn.textContent = 'Copied';
			setTimeout(() => (btn.textContent = o), 1200);
		},
		() => toast('Copy failed'),
	);
}

function showError(msg) {
	errEl.textContent = msg;
	errEl.hidden = false;
}

let toastTimer = null;
function toast(msg) {
	toastEl.textContent = msg;
	toastEl.hidden = false;
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => (toastEl.hidden = true), 1800);
}

function escapeHtml(s) {
	return String(s ?? '').replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
	);
}
function attr(s) {
	return escapeHtml(s);
}
