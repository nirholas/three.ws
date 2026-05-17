/**
 * Avatar customizer — /avatars/:id/edit
 *
 * Live-preview outfit + accessory editor for an avatar's owner. Picks render
 * client-side via AccessoryManager so feedback is instant; on Save we PATCH
 * /api/avatars/:id with the resulting appearance JSON and the server bakes a
 * canonical GLB (see api/_lib/bake.js).
 *
 * Architecture mirrors avatar-page.js — same look-and-feel, owner-gated by the
 * presence of `avatar.owner_id` in the API response (the avatars endpoint
 * strips owner_id for non-owners via stripOwnerFor).
 */

import { TalkScene } from './voice/talk-scene.js';
import { AccessoryManager } from './agent-accessories.js';

// ── Routing ────────────────────────────────────────────────────────────

const segments = location.pathname.split('/').filter(Boolean);
// `/avatars/:id/edit` in prod, `?id=:id` in dev.
const fromPath =
	segments[0] === 'avatars' && segments[2] === 'edit' ? segments[1] : null;
const fromQuery = new URLSearchParams(location.search).get('id');
const avatarId = fromPath || fromQuery || '';

const $ = (id) => document.getElementById(id);
const esc = (s) =>
	String(s ?? '').replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
	);

// ── State ──────────────────────────────────────────────────────────────

let avatar = null;
let presets = []; // from /accessories/presets.json
let scene = null;
let accessoryManager = null;

// Appearance state — `current` reflects what the server has, `working` is what
// the UI is showing live. We're dirty when they differ.
let currentAppearance = null;
let workingAppearance = { outfit: null, accessories: [], morphs: {} };

// Tab definitions: which preset kind goes on which tab.
const TABS = [
	{ id: 'outfit', label: 'Outfits', kinds: ['outfit'], emoji: '👕', single: true },
	{ id: 'hat', label: 'Hats', kinds: ['hat'], emoji: '🎩', single: true },
	{ id: 'glasses', label: 'Glasses', kinds: ['glasses'], emoji: '🕶️', single: true },
	{ id: 'earrings', label: 'Earrings', kinds: ['earrings'], emoji: '💎', single: false },
];
const KIND_EMOJI = {
	outfit: '👕',
	hat: '🎩',
	glasses: '🕶️',
	earrings: '💎',
};
let activeTab = 'outfit';

// ── Init ───────────────────────────────────────────────────────────────

if (!avatarId) {
	$('ae-shell').innerHTML = `<div class="ae-error">No avatar specified.</div>`;
} else {
	init().catch((err) => {
		console.error('[avatar-edit] init', err);
		$('ae-shell').innerHTML = `<div class="ae-error">${esc(err.message || 'Failed to load')}</div>`;
	});
}

async function init() {
	avatar = await fetchAvatar(avatarId);
	if (!avatar.owner_id) {
		// owner_id is stripped from the API response for non-owners.
		$('ae-shell').innerHTML = `<div class="ae-error">You don't own this avatar.</div>`;
		return;
	}
	if (!avatar.model_url) {
		$('ae-shell').innerHTML = `<div class="ae-error">This avatar has no GLB to customize.</div>`;
		return;
	}

	$('ae-title').textContent = `Customize · ${avatar.name}`;
	$('ae-back').href = `/avatars/${encodeURIComponent(avatar.id)}`;

	currentAppearance = normalizeAppearance(avatar.appearance);
	workingAppearance = clone(currentAppearance);

	presets = await fetchPresets();

	// 3D preview — reuse TalkScene's renderer; we don't need the mouth target
	// here, just the loaded scene + auto-frame.
	scene = new TalkScene();
	try {
		// IMPORTANT: load the BASE GLB, not the baked one. The customizer
		// applies appearance on the client; loading the already-baked URL
		// would stack outfits.
		await scene.mount({ container: $('ae-stage'), glbUrl: avatar.base_model_url || avatar.model_url });
		$('ae-loading').remove();
	} catch (err) {
		$('ae-loading').textContent = `Could not load GLB: ${err.message}`;
		return;
	}

	accessoryManager = new AccessoryManager({
		content: scene.root,
		invalidate: () => {},
	});
	await accessoryManager.hydrateFromAppearance(currentAppearance);

	renderTabs();
	renderActivePanel();
	bindHeader();
}

// ── API ────────────────────────────────────────────────────────────────

async function fetchAvatar(id) {
	const r = await fetch(`/api/avatars/${encodeURIComponent(id)}`, { credentials: 'include' });
	if (!r.ok) {
		const j = await r.json().catch(() => ({}));
		throw new Error(j.error_description || `Avatar not found (${r.status})`);
	}
	return (await r.json()).avatar;
}

async function fetchPresets() {
	const r = await fetch('/accessories/presets.json');
	if (!r.ok) throw new Error(`Could not load presets (${r.status})`);
	return r.json();
}

async function saveAppearance() {
	setStatus('spin', 'Saving and baking…');
	const r = await fetch(`/api/avatars/${encodeURIComponent(avatar.id)}`, {
		method: 'PATCH',
		credentials: 'include',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ appearance: collapseAppearance(workingAppearance) }),
	});
	if (!r.ok) {
		const j = await r.json().catch(() => ({}));
		throw new Error(j.error_description || `Save failed (${r.status})`);
	}
	const updated = (await r.json()).avatar;
	avatar = updated;
	currentAppearance = normalizeAppearance(updated.appearance);
	workingAppearance = clone(currentAppearance);
	if (updated.bake_error) {
		setStatus('err', `Saved, but bake failed: ${updated.bake_error}`);
	} else if (updated.baked) {
		setStatus('ok', 'Saved · baked GLB ready');
	} else {
		setStatus('ok', 'Saved');
	}
	updateDirtyState();
}

// ── Rendering ──────────────────────────────────────────────────────────

function renderTabs() {
	const el = $('ae-tabs');
	el.innerHTML = TABS.map(
		(t) => `
			<button class="ae-tab${t.id === activeTab ? ' active' : ''}" data-tab="${t.id}" role="tab">
				${t.label}
			</button>
		`,
	).join('');
	el.querySelectorAll('.ae-tab').forEach((btn) => {
		btn.addEventListener('click', () => {
			activeTab = btn.dataset.tab;
			el.querySelectorAll('.ae-tab').forEach((b) => b.classList.toggle('active', b === btn));
			renderActivePanel();
		});
	});
}

function renderActivePanel() {
	const tab = TABS.find((t) => t.id === activeTab);
	const panel = $('ae-panel');
	const items = presets.filter((p) => tab.kinds.includes(p.kind));

	// Render a "None" tile first so users can clear the current pick.
	const tiles = [
		`<button class="ae-tile ae-tile-none${tileSelected(tab, null) ? ' selected' : ''}"
		         type="button" data-id="" data-kind="${tab.id}">
			<div class="ae-tile-preview" aria-hidden="true">∅</div>
			<div class="ae-tile-name">None</div>
			<div class="ae-tile-kind">remove</div>
		</button>`,
		...items.map(
			(p) => `
				<button class="ae-tile${tileSelected(tab, p.id) ? ' selected' : ''}"
				        type="button" data-id="${esc(p.id)}" data-kind="${tab.id}">
					<div class="ae-tile-preview" aria-hidden="true">${KIND_EMOJI[p.kind] || '◇'}</div>
					<div class="ae-tile-name">${esc(p.name)}</div>
					<div class="ae-tile-kind">${esc(p.kind)}</div>
				</button>
			`,
		),
	];

	panel.innerHTML = `<div class="ae-grid">${tiles.join('')}</div>`;
	panel.querySelectorAll('.ae-tile').forEach((btn) => {
		btn.addEventListener('click', () => onTileClick(tab, btn.dataset.id));
	});
}

function tileSelected(tab, presetId) {
	if (tab.kinds.includes('outfit')) {
		return presetId
			? workingAppearance.outfit === presetId
			: !workingAppearance.outfit;
	}
	// Accessory kinds (hat/glasses/earrings) live in the accessories array.
	const matching = workingAppearance.accessories.filter((id) => {
		const preset = presets.find((p) => p.id === id);
		return preset && tab.kinds.includes(preset.kind);
	});
	if (!presetId) return matching.length === 0;
	return matching.includes(presetId);
}

async function onTileClick(tab, presetId) {
	if (tab.kinds.includes('outfit')) {
		await applyOutfit(presetId || null);
	} else {
		await applyAccessory(tab, presetId || null);
	}
	renderActivePanel();
	updateDirtyState();
}

async function applyOutfit(presetId) {
	// Remove the previous outfit from the live preview first.
	if (workingAppearance.outfit) {
		accessoryManager.removePreset(workingAppearance.outfit);
	}
	workingAppearance.outfit = presetId;
	if (presetId) {
		const preset = presets.find((p) => p.id === presetId);
		if (preset) await accessoryManager.applyPreset(preset);
	}
}

async function applyAccessory(tab, presetId) {
	// For single-slot kinds (hat, glasses) remove whatever's currently in
	// that slot before applying. Earrings allow multiples (both ears).
	const wasInSlot = workingAppearance.accessories.filter((id) => {
		const p = presets.find((x) => x.id === id);
		return p && tab.kinds.includes(p.kind);
	});

	if (tab.single) {
		for (const id of wasInSlot) {
			accessoryManager.removePreset(id);
			workingAppearance.accessories = workingAppearance.accessories.filter((a) => a !== id);
		}
	}

	if (presetId) {
		// Toggle behaviour for non-single kinds — clicking an already-applied
		// preset removes it.
		if (!tab.single && wasInSlot.includes(presetId)) {
			accessoryManager.removePreset(presetId);
			workingAppearance.accessories = workingAppearance.accessories.filter((a) => a !== presetId);
		} else {
			const preset = presets.find((p) => p.id === presetId);
			if (preset) {
				await accessoryManager.applyPreset(preset);
				if (!workingAppearance.accessories.includes(presetId)) {
					workingAppearance.accessories.push(presetId);
				}
			}
		}
	}
}

// ── Header / status ────────────────────────────────────────────────────

function bindHeader() {
	$('ae-save').addEventListener('click', async () => {
		$('ae-save').disabled = true;
		$('ae-reset').disabled = true;
		try {
			await saveAppearance();
		} catch (err) {
			setStatus('err', err.message);
		} finally {
			updateDirtyState();
		}
	});
	$('ae-reset').addEventListener('click', async () => {
		// Roll the live preview back to the saved appearance.
		const wasIds = [
			workingAppearance.outfit,
			...workingAppearance.accessories,
		].filter(Boolean);
		for (const id of wasIds) accessoryManager.removePreset(id);
		workingAppearance = clone(currentAppearance);
		await accessoryManager.hydrateFromAppearance(workingAppearance);
		renderActivePanel();
		updateDirtyState();
		setStatus('', 'Reverted to last saved.');
	});
}

function updateDirtyState() {
	const dirty = !appearanceEquals(workingAppearance, currentAppearance);
	$('ae-save').disabled = !dirty;
	$('ae-reset').disabled = !dirty;
	if (!dirty) {
		setStatus('', 'No unsaved changes.');
	} else {
		setStatus('', 'Unsaved changes.');
	}
}

function setStatus(kind, text) {
	const el = $('ae-status');
	el.className = `ae-status${kind ? ' ' + kind : ''}`;
	el.innerHTML = kind === 'spin' ? `<span class="spin"></span>${esc(text)}` : esc(text);
}

// ── Helpers ────────────────────────────────────────────────────────────

function normalizeAppearance(a) {
	if (!a) return { outfit: null, accessories: [], morphs: {} };
	return {
		outfit: a.outfit || null,
		accessories: Array.isArray(a.accessories) ? [...a.accessories] : [],
		morphs: a.morphs && typeof a.morphs === 'object' ? { ...a.morphs } : {},
	};
}

// Drop empty fields before PATCHing so we send the smallest valid JSON and so
// "no customization" rows have appearance = null (matches isBakeable() check).
function collapseAppearance(a) {
	const out = {};
	if (a.outfit) out.outfit = a.outfit;
	if (a.accessories?.length) out.accessories = [...a.accessories];
	if (a.morphs && Object.keys(a.morphs).length) out.morphs = { ...a.morphs };
	return Object.keys(out).length ? out : null;
}

function clone(o) {
	return JSON.parse(JSON.stringify(o));
}

function appearanceEquals(a, b) {
	if ((a?.outfit || null) !== (b?.outfit || null)) return false;
	const sa = new Set(a?.accessories || []);
	const sb = new Set(b?.accessories || []);
	if (sa.size !== sb.size) return false;
	for (const v of sa) if (!sb.has(v)) return false;
	const ka = Object.keys(a?.morphs || {});
	const kb = Object.keys(b?.morphs || {});
	if (ka.length !== kb.length) return false;
	for (const k of ka) if ((a.morphs[k] || 0) !== (b?.morphs?.[k] || 0)) return false;
	return true;
}
