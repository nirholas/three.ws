// Animation preset gallery for the /pose studio.
//
// Renders a curated, searchable gallery of ready-to-apply motion clips. Click a
// card and the clip retargets onto the loaded rig and plays live in the
// viewport (the shared 3D stage is the preview surface — one figure, like
// Mixamo, rather than N video thumbnails). A transport bar then lets the user
// scrub speed, toggle loop, stop, and export an animated GLB with the motion
// baked in.
//
// This controller owns only its own AnimationMixer and DOM; it borrows the rig
// and render loop from the host (pose-studio) through the callbacks passed to
// the constructor, and signals the host when a preview takes over the figure so
// the keyframe timeline can yield.

import { AnimationClip, AnimationMixer, LoopOnce, LoopRepeat } from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

import { curate } from './animation-presets.js';
import { buildFingerspellingClip, normalizeWord } from './fingerspelling.js';
import {
	retargetClipToRig,
	scaleClipSpeed,
	parseClipJSON,
	trimClip,
	blendClipLoop,
	MIN_COVERAGE,
} from './animation-retarget.js';
import { Modal } from './shared/modal.js';
import { log } from './shared/log.js';
import { checkMotionPrompt } from './motion-prompt-check.js';
import {
	rootTravel,
	pinRootInPlace,
	IN_PLACE_TRAVEL_M,
	generatedClipProblem,
	normalizeClipTiming,
} from './generated-motion.js';
import { runRigJob } from './rig-job.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MANIFEST_URL = '/animations/manifest.json';
// A rig needs a real share of the canonical skeleton before presets read as
// performances rather than twitches. Mirrors AnimationManager's bar.
const MIN_RIG_BONES = 8;

// Text-to-animation job polling (POST /api/forge-motion, then poll until the
// clip is ready). The motion model runs 10 to 30 s on a warm GPU, but the
// worker scales to zero when idle and a cold start (GPU attach plus model load)
// takes minutes, so the cap leaves room for that and the wait text says so.
const GEN_POLL_INTERVAL_MS = 2500;
const GEN_MAX_POLL_MS = 4 * 60 * 1000;
// Seconds past which a wait reads as a cold start when the job gave no ETA.
const GEN_WARM_SECONDS = 30;
// A finished job whose clip the server could not convert is re-polled (the
// conversion runs on every poll) this many times before it counts as failed.
const GEN_CONVERT_RETRIES = 3;
// Generated motions start and end in different poses, so their loop seam gets
// a short crossfade by default. The Blend field shows it and can clear it.
const GEN_LOOP_BLEND_MS = 300;
// Horizontal root travel below which a clip has no travel worth a toggle.
const IN_PLACE_MIN_TRAVEL_M = 0.05;

/**
 * What the person reads while a motion generates: the honest elapsed time, and
 * once the wait passes the job's estimate, why it is taking longer.
 * @param {string} prompt
 * @param {number} seconds elapsed
 * @param {number|null} eta the job's estimate in seconds, when it gave one
 */
export function motionWaitText(prompt, seconds, eta) {
	const short = prompt.length > 40 ? `${prompt.slice(0, 39)}…` : prompt;
	const base = `Generating “${short}”: ${seconds}s`;
	const expected = Number(eta) > 0 ? Number(eta) : GEN_WARM_SECONDS;
	if (seconds <= expected) return `${base}.`;
	return `${base}. The motion GPU was asleep and is starting up; the first run after a quiet spell can take a few minutes.`;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const el = (tag, attrs = {}, children = []) => {
	const node = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		if (k === 'class') node.className = v;
		else if (k === 'text') node.textContent = v;
		else if (k === 'html') node.innerHTML = v;
		else if (k.startsWith('on') && typeof v === 'function')
			node.addEventListener(k.slice(2), v);
		else if (v !== false && v != null) node.setAttribute(k, v);
	}
	for (const child of Array.isArray(children) ? children : [children]) {
		if (child == null) continue;
		node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
	}
	return node;
};

export class AnimationLibrary {
	/**
	 * @param {{
	 *   host: HTMLElement,
	 *   getRig: () => object|null,
	 *   getAvatarId?: () => string|null,
	 *   onPreviewStart?: () => void,
	 *   onPreviewStop?: () => void,
	 *   setStatus?: (msg: string, kind?: string) => void,
	 *   loadRigged?: (glbUrl: string, name: string) => Promise<void>,
	 * }} opts
	 */
	constructor(opts) {
		this.host = opts.host;
		this.getRig = opts.getRig;
		this.getAvatarId = opts.getAvatarId || (() => null);
		this.onPreviewStart = opts.onPreviewStart || (() => {});
		this.onPreviewStop = opts.onPreviewStop || (() => {});
		this.setStatus = opts.setStatus || (() => {});
		// Loads a freshly rigged GLB in place of the unrigged model (host-owned).
		this.loadRigged = opts.loadRigged || null;

		/** @type {Array} curated manifest defs (with category) */
		this._defs = [];
		/** @type {Map<string, import('three').AnimationClip>} canonical clips by name */
		this._clipCache = new Map();
		/** @type {string} '' = all categories */
		this._filterCat = '';
		this._query = '';

		this._mixer = null;
		this._mixerRoot = null;
		this._action = null;
		this._activeName = null;
		this._activeDef = null;
		this._speed = 1;
		this._previewing = false;
		this._paused = false;
		this._scrubbing = false;
		this._state = 'loading';

		// Trim/blend/loop edits, applied to the active clip before preview,
		// export, and save. `_baseClip` is the untrimmed canonical clip the
		// active def resolved to; edits are recomputed from it, never baked in
		// place, so adjusting a slider always starts from the original motion.
		this._baseClip = null;
		this._trimStart = 0;
		this._trimEnd = null;
		this._blendMs = 0;
		this._loopOn = true;
		this._editDebounce = null;
		// "In place": hold the root's horizontal position so a travelling motion
		// (a generated walk covers metres) stays in view and loops without a snap.
		this._inPlace = false;
		this._travel = 0;

		// Resolves once mount() has finished loading the manifest (success or
		// failure) — openByName() awaits this so a ?anim=<preset> deep-link works
		// even before the gallery has rendered.
		this._readyResolve = null;
		this._ready = new Promise((resolve) => {
			this._readyResolve = resolve;
		});

		// Text-to-animation job state (token-based abort like the forge panels).
		this._genToken = 0;
		this._genTimer = null;
		this._lastPrompt = '';

		// Auto-rig offer for a model that loaded without a skeleton: the host
		// calls offerRig() with its URL, and the no-rig state turns into "Rig it
		// first" with a button that runs the rig job (src/rig-job.js).
		this._rigOffer = null;
		this._rigToken = 0;
		this._rigBusy = false;
		this._rigError = null;
		this._rigTimer = null;

		// Resolved DOM refs (built in _renderShell).
		this._refs = {};
	}

	// ── Lifecycle ───────────────────────────────────────────────────────────
	async mount() {
		this._renderShell();
		this._setState('loading');
		try {
			const res = await fetch(MANIFEST_URL, { cache: 'no-cache' });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const manifest = await res.json();
			if (!Array.isArray(manifest) || manifest.length === 0)
				throw new Error('empty manifest');
			this._curated = curate(manifest);
			this._defs = [
				this._curated.featured,
				this._curated.groups.flatMap((g) => g.items),
			].flat();
			this._buildCategoryChips();
			this._evaluateRig();
		} catch (err) {
			log.warn('[AnimationLibrary] manifest load failed:', err.message);
			this._setState('error-load');
		} finally {
			this._readyResolve?.();
		}
	}

	/**
	 * Open a preset by its manifest name and play it on the current rig. This is
	 * the ?anim= deep-link path for built-in library clips (keyed by name, e.g.
	 * "idle" or "av-boxer-dance") — the counterpart to PoseLibrary.openById() for
	 * saved community clips, which are keyed by API UUID. Waits for the manifest
	 * to finish loading first. Throws if no preset carries that name; when no
	 * compatible rig is loaded, preview() surfaces its own "load an avatar"
	 * guidance rather than throwing.
	 * @param {string} name  manifest clip name
	 */
	async openByName(name) {
		await this._ready;
		let def = this._defs.find((d) => d.name === name);
		if (!def) def = await this._lookupFullLibrary(name);
		if (!def) throw new Error(`No built-in animation named “${name}”`);
		return this.preview(def);
	}

	/**
	 * Resolve a full-library clip def by name. The /animations gallery
	 * deep-links R2-hosted clips (mx-* names) that aren't in the curated
	 * manifest; their defs carry an absolute CDN url that preview()/_loadClip()
	 * fetch like any other. Returns null when the library doesn't know the
	 * name either (including before the library has been uploaded).
	 *
	 * Asks the endpoint for the single name rather than downloading the whole
	 * manifest to find one entry in it: the catalog is thousands of clips and
	 * growing with every seeding batch, so the unfiltered response is over a
	 * megabyte of JSON to resolve about three kilobytes of it.
	 * @param {string} name
	 */
	async _lookupFullLibrary(name) {
		try {
			const res = await fetch(`/api/animations/library?name=${encodeURIComponent(name)}`);
			if (!res.ok) return null;
			const data = await res.json();
			return (data.clips || []).find((d) => d.name === name) || null;
		} catch {
			return null;
		}
	}

	/** Called by the host when the active rig changes (avatar load / mannequin). */
	onRigChanged() {
		this._genToken++; // a generation in flight was for the previous rig
		this._stopGenTimer();
		this._setGenBusy(false);
		const rig = this.getRig();
		if (rig && rig.kind !== 'mannequin' && !this._rigBusy) this._rigOffer = null;
		this.stopPreview({ silent: true });
		this._disposeMixer();
		if (this._defs.length) this._evaluateRig();
	}

	/** Tick the preview mixer. Host calls this from its render loop while previewing. */
	update(dt) {
		this._mixer?.update(dt);
		if (!this._scrubbing) this._syncProgress();
	}

	/** Push the active action's clock into the transport scrubber + time label. */
	_syncProgress() {
		const { transportScrub, transportTime } = this._refs;
		if (!transportScrub || !this._action) return;
		const clip = this._action.getClip?.();
		const dur = clip?.duration || 0;
		if (dur <= 0) return;
		// action.time wraps within [0, duration) for a looping action and clamps
		// for a one-shot, so it reads as clip-local position either way.
		const t = Math.max(0, Math.min(dur, this._action.time));
		transportScrub.value = String(Math.round((t / dur) * 1000));
		if (transportTime) transportTime.textContent = `${t.toFixed(1)} / ${dur.toFixed(1)}s`;
	}

	/** Seek the active clip to a 0..1 fraction and reflect it immediately. */
	_seek(frac) {
		if (!this._action) return;
		const dur = this._action.getClip?.().duration || 0;
		this._action.paused = false;
		this._action.time = Math.max(0, Math.min(0.999, frac)) * dur;
		this._mixer?.update(0);
		if (this._paused) this._action.paused = true;
	}

	/** Toggle play/pause on the live preview. */
	_togglePlay() {
		if (!this._action) return;
		this._paused = !this._paused;
		this._action.paused = this._paused;
		this._updatePlayIcon();
	}

	_updatePlayIcon() {
		const btn = this._refs.transportPlay;
		if (!btn) return;
		btn.textContent = this._paused ? '▶' : '⏸';
		btn.setAttribute('aria-label', this._paused ? 'Play' : 'Pause');
		btn.title = this._paused ? 'Play' : 'Pause';
	}

	isPreviewing() {
		return this._previewing;
	}

	dispose() {
		this._genToken++; // abort any in-flight generation poll
		this._stopGenTimer();
		this._rigToken++;
		this._stopRigTimer();
		this.stopPreview({ silent: true });
		this._disposeMixer();
		this._clipCache.clear();
		this.host.innerHTML = '';
	}

	// ── Rig capability ────────────────────────────────────────────────────────
	_rigBoneCount() {
		const rig = this.getRig();
		return rig?.getBones?.().length || 0;
	}

	// Presets target rigged GLB avatars. The primitive mannequin has no skinned
	// skeleton to export, so we steer the user to load a real avatar.
	_evaluateRig() {
		const rig = this.getRig();
		if (!rig || rig.kind === 'mannequin') return this._setState('no-rig');
		if (this._rigBoneCount() < MIN_RIG_BONES) return this._setState('incompatible');
		this._setState('ready');
		this._renderGallery();
	}

	// ── Shell + states ──────────────────────────────────────────────────────
	_renderShell() {
		this.host.innerHTML = '';

		// Generate-from-text: synthesize a brand-new motion from a prompt and play
		// it on the rig exactly like a preset. The capability the preset library
		// can't offer — motion that doesn't pre-exist.
		const genInput = el('input', {
			type: 'text',
			class: 'al-gen-input',
			placeholder: 'Describe a motion, like “waving confidently”',
			'aria-label': 'Generate an animation from a text description',
			autocomplete: 'off',
			maxlength: '200',
		});
		const genBtn = el(
			'button',
			{ class: 'al-gen-btn', type: 'button', title: 'Generate a motion from your description' },
			['✨ Generate'],
		);
		const submitGen = () => this.generateFromText(genInput.value);
		genBtn.addEventListener('click', submitGen);
		genInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				submitGen();
			}
		});
		// Shown only after a generation fails: reruns the same description.
		const genRetry = el(
			'button',
			{ class: 'al-gen-retry', type: 'button', hidden: true, title: 'Try the same description again' },
			['Try again'],
		);
		genRetry.addEventListener('click', () => this.generateFromText(this._lastPrompt));
		const gen = el('div', { class: 'al-gen' }, [genInput, genBtn, genRetry]);

		// Fingerspell: spell any word in ASL on the avatar's right hand. Built
		// locally and deterministically (src/fingerspelling.js) — no network,
		// instant, and the result exports like any other clip.
		const spellInput = el('input', {
			type: 'text',
			class: 'al-gen-input',
			placeholder: 'Fingerspell in ASL — try your name',
			'aria-label': 'Fingerspell a word in American Sign Language',
			autocomplete: 'off',
			maxlength: '40',
		});
		const spellBtn = el(
			'button',
			{ class: 'al-gen-btn', type: 'button', title: 'Spell the word letter by letter in American Sign Language' },
			['🤟 Spell'],
		);
		const submitSpell = () => this.spellWord(spellInput.value);
		spellBtn.addEventListener('click', submitSpell);
		spellInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				submitSpell();
			}
		});
		const spell = el('div', { class: 'al-gen al-spell' }, [spellInput, spellBtn]);

		const search = el('input', {
			type: 'search',
			class: 'al-search',
			placeholder: 'Search animations…',
			'aria-label': 'Search animations',
			autocomplete: 'off',
		});
		search.addEventListener('input', () => {
			this._query = search.value.trim().toLowerCase();
			if (this._state === 'ready') this._renderGallery();
		});

		const chips = el('div', {
			class: 'al-chips',
			role: 'tablist',
			'aria-label': 'Animation categories',
		});
		const grid = el('div', { class: 'al-grid' });
		const empty = el('div', { class: 'al-empty' });

		// Shell refs first; _renderTransport() merges its own sub-refs (label,
		// speed, export button) into this._refs, so it must run after this assign.
		this._refs = { gen, genInput, genBtn, genRetry, spell, spellInput, spellBtn, search, chips, grid, empty };
		const transport = this._renderTransport();
		this._refs.transport = transport;

		this.host.appendChild(gen);
		this.host.appendChild(spell);
		this.host.appendChild(search);
		// Now-playing transport sits directly under the search so it's visible the
		// moment a clip plays (hidden until then) — not buried below the card grid.
		this.host.appendChild(transport.root);
		this.host.appendChild(chips);
		this.host.appendChild(empty);
		this.host.appendChild(grid);
	}

	_setState(state) {
		this._state = state;
		const { gen, spell, search, chips, grid, empty, transport } = this._refs;
		const ready = state === 'ready';
		if (gen) gen.style.display = ready ? '' : 'none';
		if (spell) spell.style.display = ready ? '' : 'none';
		search.style.display = ready ? '' : 'none';
		chips.style.display = ready ? '' : 'none';
		grid.style.display = ready ? '' : 'none';
		transport.root.style.display = ready && this._activeName ? '' : 'none';
		empty.style.display = ready ? 'none' : '';

		if (ready) return;
		empty.innerHTML = '';
		const make = (icon, title, body, action) => {
			empty.appendChild(el('div', { class: 'al-empty-icon' }, [icon]));
			empty.appendChild(el('div', { class: 'al-empty-title' }, [title]));
			empty.appendChild(el('p', { class: 'al-empty-body' }, [body]));
			if (action) empty.appendChild(action);
		};
		if (state === 'loading') {
			empty.appendChild(
				el(
					'div',
					{ class: 'al-skeleton-grid' },
					Array.from({ length: 6 }, () => el('div', { class: 'al-skeleton' })),
				),
			);
		} else if (state === 'error-load') {
			const retry = el('button', { class: 'al-cta', type: 'button' }, ['Retry']);
			retry.addEventListener('click', () => this.mount());
			make(
				'⚠️',
				'Couldn’t load the animation library',
				'The clip manifest failed to load. Check your connection and try again.',
				retry,
			);
		} else if (state === 'no-rig') {
			const loadCta = (cls = 'al-cta') => {
				const b = el('button', { class: cls, type: 'button' }, ['Load a rigged avatar']);
				b.addEventListener('click', () => document.querySelector('#pose-load-avatar')?.click());
				return b;
			};
			if (this._rigOffer) return this._renderRigOffer(make, loadCta);
			make(
				'🦴',
				'Load a rigged avatar to animate',
				'Animation presets apply to a rigged model. Load one of your avatars (or a public avatar) and the full gallery unlocks here.',
				loadCta(),
			);
		} else if (state === 'incompatible') {
			make(
				'🚫',
				'This rig can’t be retargeted',
				`The loaded model exposes only ${this._rigBoneCount()} recognizable humanoid bones — too few to drive the preset library. Try a standard humanoid avatar.`,
				null,
			);
		}
	}

	// ── Auto-rig for an unrigged model ──────────────────────────────────────
	/**
	 * The host loaded a model with no skeleton. Remember it so the empty state
	 * can offer to rig it instead of only asking for a different avatar.
	 * @param {{ url: string, name?: string }} offer public http(s) URL of the mesh
	 */
	offerRig(offer) {
		this._rigToken++;
		this._stopRigTimer();
		this._rigBusy = false;
		this._rigError = null;
		this._rigOffer = offer?.url ? { url: offer.url, name: offer.name || 'this model' } : null;
		if (this._defs.length) this._evaluateRig();
	}

	_renderRigOffer(make, loadCta) {
		const { name } = this._rigOffer;
		const { empty } = this._refs;
		const actions = el('div', { class: 'al-empty-actions' });
		if (this._rigBusy) {
			const cancel = el('button', { class: 'al-cta al-cta-quiet', type: 'button' }, ['Cancel']);
			cancel.addEventListener('click', () => this._cancelRig());
			actions.appendChild(cancel);
			make('⏳', `Rigging “${name}”`, this._rigWaitText(0), actions);
			this._refs.rigWait = empty.querySelector('.al-empty-body');
			return;
		}
		if (this._rigError) {
			const err = this._rigError;
			if (err.kind !== 'unconfigured') {
				const retry = el('button', { class: 'al-cta', type: 'button' }, ['Try rigging again']);
				retry.addEventListener('click', () => this.rigOfferedModel());
				actions.appendChild(retry);
			}
			actions.appendChild(loadCta(err.kind === 'unconfigured' ? 'al-cta' : 'al-cta al-cta-quiet'));
			make('⚠️', err.title || 'Could not rig this model', err.message, actions);
			return;
		}
		const rigBtn = el('button', { class: 'al-cta al-rig-btn', type: 'button' }, ['Rig this model']);
		rigBtn.addEventListener('click', () => this.rigOfferedModel());
		actions.appendChild(rigBtn);
		actions.appendChild(loadCta('al-cta al-cta-quiet'));
		make(
			'🦴',
			'Rig it first',
			`“${name}” has no skeleton, so a motion has nothing to move. Rigging adds a humanoid skeleton and skin weights in about a minute, then every motion here plays on it.`,
			actions,
		);
	}

	_rigWaitText(seconds) {
		const base = `Adding a skeleton and skin weights: ${seconds}s.`;
		return seconds > 90
			? `${base} The rigging GPU was asleep and is starting up, which can take a few minutes.`
			: `${base} This usually takes about a minute.`;
	}

	/** Run the auto-rig job on the offered model, then hand the rigged GLB to the host. */
	async rigOfferedModel() {
		if (!this._rigOffer || this._rigBusy) return;
		const offer = this._rigOffer;
		const token = ++this._rigToken;
		this._rigBusy = true;
		this._rigError = null;
		this._setState('no-rig');
		const t0 = performance.now();
		this._rigTimer = setInterval(() => {
			if (token !== this._rigToken) return;
			const s = Math.floor((performance.now() - t0) / 1000);
			if (this._refs.rigWait) this._refs.rigWait.textContent = this._rigWaitText(s);
		}, 1000);
		this.setStatus(`Rigging “${offer.name}”…`, 'busy');
		try {
			const result = await runRigJob(offer.url, { isCurrent: () => token === this._rigToken });
			if (!result || token !== this._rigToken) return;
			this._stopRigTimer();
			if (!this.loadRigged) throw new Error('This page cannot load the rigged model.');
			await this.loadRigged(result.glbUrl, offer.name);
			if (token !== this._rigToken) return;
			this._rigOffer = null;
			this._rigBusy = false;
			this.setStatus(`Rigged “${offer.name}”. Pick a motion or describe one.`);
		} catch (err) {
			if (token !== this._rigToken) return;
			this._stopRigTimer();
			log.warn('[AnimationLibrary] auto-rig failed:', err?.message || err);
			this._rigBusy = false;
			this._rigError = err instanceof Error ? err : new Error(String(err));
			this._setState('no-rig');
			this.setStatus(this._rigError.message, 'error');
		}
	}

	_cancelRig() {
		this._rigToken++;
		this._stopRigTimer();
		this._rigBusy = false;
		this._setState('no-rig');
		this.setStatus('Rigging cancelled.');
	}

	_stopRigTimer() {
		if (this._rigTimer) {
			clearInterval(this._rigTimer);
			this._rigTimer = null;
		}
	}

	// ── Category chips ──────────────────────────────────────────────────────
	_buildCategoryChips() {
		const { chips } = this._refs;
		chips.innerHTML = '';
		const mk = (key, label) => {
			const b = el(
				'button',
				{
					class: 'al-chip',
					type: 'button',
					role: 'tab',
					'data-cat': key,
					'aria-selected': String(this._filterCat === key),
				},
				[label],
			);
			b.addEventListener('click', () => {
				this._filterCat = key;
				chips
					.querySelectorAll('.al-chip')
					.forEach((c) => c.setAttribute('aria-selected', String(c.dataset.cat === key)));
				this._renderGallery();
			});
			return b;
		};
		chips.appendChild(mk('', 'All'));
		for (const g of this._curated.groups) chips.appendChild(mk(g.key, `${g.icon} ${g.label}`));
	}

	// ── Gallery ─────────────────────────────────────────────────────────────
	_matches(def) {
		if (this._filterCat && def.category !== this._filterCat) return false;
		if (this._query) {
			const hay = `${def.label || ''} ${def.name}`.toLowerCase();
			if (!hay.includes(this._query)) return false;
		}
		return true;
	}

	_renderGallery() {
		const { grid } = this._refs;
		grid.innerHTML = '';

		// Featured row only when unfiltered and unsearched.
		if (!this._filterCat && !this._query && this._curated.featured.length) {
			grid.appendChild(el('div', { class: 'al-section-label' }, ['Featured']));
			const row = el('div', { class: 'al-cards' });
			for (const def of this._curated.featured) row.appendChild(this._card(def));
			grid.appendChild(row);
		}

		for (const group of this._curated.groups) {
			const items = group.items.filter((d) => this._matches(d));
			if (!items.length) continue;
			grid.appendChild(
				el('div', { class: 'al-section-label' }, [`${group.icon} ${group.label}`]),
			);
			const row = el('div', { class: 'al-cards' });
			for (const def of items) row.appendChild(this._card(def));
			grid.appendChild(row);
		}

		if (!grid.querySelector('.al-card')) {
			grid.appendChild(
				el('p', { class: 'al-no-match' }, [`No animations match “${this._query}”.`]),
			);
		}
	}

	_card(def) {
		const isActive = def.name === this._activeName;
		const card = el(
			'button',
			{
				class: `al-card${isActive ? ' is-active' : ''}`,
				type: 'button',
				'data-name': def.name,
				'aria-pressed': String(isActive),
				title: `${def.label || def.name}${def.loop === false ? '' : ' · loops'}`,
			},
			[
				el('span', { class: 'al-card-icon' }, [def.icon || '🎬']),
				el('span', { class: 'al-card-label' }, [def.label || def.name]),
				el('span', { class: 'al-card-badge' }, [def.loop === false ? 'once' : 'loop']),
				el('span', { class: 'al-card-eq', 'aria-hidden': 'true' }, [
					el('i'),
					el('i'),
					el('i'),
				]),
			],
		);
		card.addEventListener('click', () => this.preview(def));
		return card;
	}

	_markActiveCard() {
		this._refs.grid.querySelectorAll('.al-card').forEach((c) => {
			const on = c.dataset.name === this._activeName;
			c.classList.toggle('is-active', on);
			c.setAttribute('aria-pressed', String(on));
		});
	}

	// ── Preview ─────────────────────────────────────────────────────────────
	async _loadClip(def) {
		if (this._clipCache.has(def.name)) return this._clipCache.get(def.name);
		const res = await fetch(def.url, { cache: 'force-cache' });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const clip = parseClipJSON(await res.json(), def.name);
		this._clipCache.set(def.name, clip);
		return clip;
	}

	_ensureMixer(rig) {
		if (this._mixer && this._mixerRoot === rig.root) return this._mixer;
		this._disposeMixer();
		this._mixer = new AnimationMixer(rig.root);
		this._mixerRoot = rig.root;
		return this._mixer;
	}

	/** Load → retarget → play a preset on the current rig. */
	/** The library clip playing right now, or null (generated clips have no name). */
	get activeName() {
		return this._activeName;
	}

	async preview(def) {
		const rig = this.getRig();
		if (!rig || rig.kind === 'mannequin') {
			this.setStatus('Load a rigged avatar to apply animations.', 'error');
			return;
		}
		this.setStatus(`Loading ${def.label || def.name}…`);
		let clip;
		try {
			clip = await this._loadClip(def);
		} catch (err) {
			this._clipCache.delete(def.name);
			this.setStatus(`Couldn’t load “${def.label || def.name}”: ${err.message}`, 'error');
			return;
		}
		this._baseClip = clip;
		this._resetEdits(clip.duration, def.loop !== false);
		this._playClip(this._computeEditedClip(clip), { ...def, loop: this._loopOn });
	}

	/**
	 * Retarget an already-resolved canonical clip onto the current rig and play
	 * it. Shared by preset preview() and text-to-animation generateFromText() —
	 * one apply path, so a generated motion behaves exactly like a preset
	 * (transport, speed, loop, export all work identically). Returns true on play.
	 */
	_playClip(clip, def) {
		const rig = this.getRig();
		if (!rig || rig.kind === 'mannequin') {
			this.setStatus('Load a rigged avatar to apply animations.', 'error');
			return false;
		}

		const {
			clip: retargeted,
			matched,
			total,
			coverage,
			dropped,
		} = retargetClipToRig(clip, rig);
		if (!retargeted) {
			this.setStatus(
				`“${def.label || def.name}” can’t retarget to this rig — only ${matched}/${total} tracks mapped (need ${Math.round(MIN_COVERAGE * 100)}%).`,
				'error',
			);
			return false;
		}

		const mixer = this._ensureMixer(rig);
		mixer.stopAllAction();
		const action = mixer.clipAction(retargeted);
		action.setLoop(def.loop === false ? LoopOnce : LoopRepeat, Infinity);
		action.clampWhenFinished = def.loop === false;
		action.timeScale = this._speed;
		action.reset().play();
		this._paused = false;
		this._scrubbing = false;
		this._updatePlayIcon();

		this._action = action;
		this._activeName = def.name;
		this._activeDef = def;
		this._activeRetarget = { matched, total, coverage, dropped };

		if (!this._previewing) {
			this._previewing = true;
			this.onPreviewStart();
		}
		this._markActiveCard();
		this._updateTransport();
		this._refs.transport.root.style.display = '';

		const pct = Math.round(coverage * 100);
		const note = dropped.length
			? ` (${matched}/${total} bones · ${dropped.length} not on this rig)`
			: ` (${matched}/${total} bones matched)`;
		this._playStatus = `Playing “${def.label || def.name}”: ${pct}% retargeted${note}.`;
		this.setStatus(this._playStatus);
		return true;
	}

	// ── Generate from text ──────────────────────────────────────────────────
	/**
	 * Synthesize a brand-new motion from a prompt (workers/model-text2motion via
	 * /api/forge-motion), then retarget + play it through the same path as a
	 * preset. Token-based abort so a newer request supersedes an in-flight one.
	 */
	async generateFromText(prompt) {
		const checked = checkMotionPrompt(prompt);
		if (!checked.ok) {
			this.setStatus(checked.message, 'error');
			return;
		}
		prompt = checked.prompt;
		this._lastPrompt = prompt;
		this._showGenRetry(false);
		const rig = this.getRig();
		if (!rig || rig.kind === 'mannequin') {
			this.setStatus('Load a rigged avatar before generating a motion.', 'error');
			return;
		}

		const token = ++this._genToken;
		this._setGenBusy(true);
		const t0 = performance.now();
		let eta = null;
		const tick = () => {
			if (token !== this._genToken) return;
			this.setStatus(motionWaitText(prompt, Math.floor((performance.now() - t0) / 1000), eta), 'busy');
		};
		tick();
		this._genTimer = setInterval(tick, 1000);

		try {
			const job = await this._runMotionJob(prompt, token, (seconds) => {
				eta = seconds;
			});
			if (token !== this._genToken || !job) return; // superseded / aborted
			this._stopGenTimer();
			const timed = normalizeClipTiming(job.clip, job);
			const problem = generatedClipProblem(timed);
			if (problem) throw new Error(problem);
			const name = `gen_${Date.now().toString(36)}`;
			const clip = parseClipJSON(timed, name);
			this._clipCache.set(name, clip);
			const def = {
				name,
				label: prompt.length > 28 ? `${prompt.slice(0, 27)}…` : prompt,
				icon: '✨',
				loop: true,
				generated: true,
			};
			this._baseClip = clip;
			this._resetEdits(clip.duration, true);
			this._setBlend(Math.min(GEN_LOOP_BLEND_MS, Math.round(clip.duration * 250)));
			const played = this._playClip(this._computeEditedClip(clip), { ...def, loop: this._loopOn });
			if (played) {
				const travel = this._inPlace
					? `It travels ${this._travel.toFixed(1)} m, so it plays in place to stay in view. Turn off In place to see the travel.`
					: null;
				const extra = [job.note, travel].filter(Boolean).join(' ');
				if (extra) this.setStatus(`${this._playStatus} ${extra}`);
			}
		} catch (err) {
			if (token !== this._genToken) return;
			this._stopGenTimer();
			const msg =
				err?.kind === 'unconfigured'
					? 'Text-to-animation is not enabled on this deployment yet.'
					: err?.message || 'The motion could not be generated. Try again.';
			this.setStatus(msg, 'error');
			if (err?.retryable !== false && err?.kind !== 'unconfigured') this._showGenRetry(true);
		} finally {
			if (token === this._genToken) this._setGenBusy(false);
		}
	}

	/**
	 * Submit a motion job and poll until its clip is ready.
	 * @returns {Promise<{ clip: object, fps: number|null, frames: number|null, note: string|null } | null>}
	 *   null when a newer request superseded this one
	 */
	async _runMotionJob(prompt, token, onEta) {
		const fail = (message, extra = {}) => Object.assign(new Error(message), extra);
		let submit;
		try {
			submit = await fetch('/api/forge-motion', {
				method: 'POST',
				credentials: 'include',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ prompt }),
			});
		} catch {
			throw fail('Could not reach the motion generator. Check your connection and try again.');
		}
		const sub = await submit.json().catch(() => ({}));
		if (submit.status === 503 || sub.error === 'unconfigured') {
			throw fail(sub.message || 'unconfigured', { kind: 'unconfigured' });
		}
		if (submit.status === 400) {
			throw fail(sub.message || 'That description could not be used. Describe what the body does.', { retryable: false });
		}
		if (submit.status === 401 || submit.status === 403) {
			throw fail(sub.message || 'Sign in to generate a motion.', { retryable: false });
		}
		if (submit.status === 429) {
			const wait = Number(submit.headers.get('retry-after'));
			throw fail(
				wait > 0
					? `You have used this hour’s motion generations. Try again in ${Math.ceil(wait / 60)} min.`
					: 'You have used this hour’s motion generations. Try again later.',
			);
		}
		if (!submit.ok || !sub.job_id) {
			// The server hands the allowance back on any 5xx, so a failed start costs nothing.
			throw fail('The motion generator could not start this job. Nothing was used from your allowance; try again.');
		}
		if (typeof sub.eta_seconds === 'number') onEta?.(sub.eta_seconds);

		const deadline = performance.now() + GEN_MAX_POLL_MS;
		let convertRetries = GEN_CONVERT_RETRIES;
		while (token === this._genToken && performance.now() < deadline) {
			await sleep(GEN_POLL_INTERVAL_MS);
			if (token !== this._genToken) return null;
			let res;
			try {
				res = await fetch(`/api/forge-motion?job=${encodeURIComponent(sub.job_id)}`, { credentials: 'include' });
			} catch {
				continue; // a dropped connection mid-poll is not a failed job
			}
			const data = await res.json().catch(() => ({}));
			if (res.status === 400) throw fail(data.message || 'The motion job was lost. Try again.');
			const timing = { fps: data.fps ?? null, frames: data.frames ?? null, note: sub.note ?? null };
			// The server converts the clip into the library basis on every poll.
			// The raw worker clip (clip_url) is in a different rest pose and would
			// throw the head back on every rig, so a missing conversion is
			// re-polled rather than played raw.
			if (data.status === 'done' && data.clip) return { clip: data.clip, ...timing };
			if (data.status === 'done') {
				if (convertRetries-- > 0) continue;
				throw fail('The motion finished but could not be prepared for playback. Try again.');
			}
			if (data.status === 'failed') {
				log.warn('[AnimationLibrary] motion job failed:', data.error);
				throw fail('The motion generator failed on this one. Try again; different wording often helps.');
			}
		}
		if (token !== this._genToken) return null;
		throw fail('The motion generator did not answer within 4 minutes. Try again: the GPU may still be starting.');
	}

	// ── Fingerspell ─────────────────────────────────────────────────────────
	/**
	 * Spell a word in American Sign Language on the rig's right hand. The clip
	 * is built locally and deterministically (src/fingerspelling.js) and plays
	 * through the same retarget/transport path as a preset, so speed, scrub,
	 * and animated-GLB export all work on a spelled word. Returns true on play.
	 */
	spellWord(word) {
		const letters = normalizeWord(word);
		if (!letters) {
			this.setStatus('Type a word to fingerspell — letters and numbers.', 'error');
			return false;
		}
		// Reflect the (normalized) word in the input so deep links read back.
		if (this._refs.spellInput) this._refs.spellInput.value = letters;
		const rig = this.getRig();
		if (!rig || rig.kind === 'mannequin') {
			this.setStatus('Load a rigged avatar to fingerspell.', 'error');
			return false;
		}
		let clip;
		try {
			const json = buildFingerspellingClip(letters);
			clip = parseClipJSON(json, json.name);
			this._clipCache.set(json.name, clip);
		} catch (err) {
			this.setStatus(`Couldn’t build the spelling: ${err.message}`, 'error');
			return false;
		}
		const def = {
			name: clip.name,
			label: `Fingerspell “${letters}”`,
			icon: '🤟',
			loop: false,
			spelled: true,
		};
		this._baseClip = clip;
		this._resetEdits(clip.duration, false);
		return this._playClip(this._computeEditedClip(clip), { ...def, loop: this._loopOn });
	}

	_stopGenTimer() {
		if (this._genTimer) {
			clearInterval(this._genTimer);
			this._genTimer = null;
		}
	}

	_setGenBusy(busy) {
		const { gen, genInput, genBtn } = this._refs;
		if (genInput) genInput.disabled = busy;
		if (genBtn) {
			genBtn.disabled = busy;
			genBtn.textContent = busy ? '✨ Generating…' : '✨ Generate';
		}
		if (gen) gen.dataset.busy = busy ? 'true' : 'false';
		if (busy) this._showGenRetry(false);
	}

	_showGenRetry(show) {
		const { genRetry } = this._refs;
		if (genRetry) genRetry.hidden = !show || !this._lastPrompt;
	}

	stopPreview({ silent = false } = {}) {
		if (!this._previewing && !this._activeName) return;
		this._mixer?.stopAllAction();
		this._action = null;
		this._activeName = null;
		this._activeDef = null;
		this._previewing = false;
		this._markActiveCard?.();
		if (this._refs.transport) this._refs.transport.root.style.display = 'none';
		// Hand the figure back to the host in a clean rest pose.
		try {
			this.getRig()?.resetPose?.();
		} catch {
			/* rig may be gone */
		}
		this.onPreviewStop();
		if (!silent) this.setStatus('Preview stopped.');
	}

	_setSpeed(v) {
		this._speed = Math.min(2.5, Math.max(0.25, v));
		if (this._action) this._action.timeScale = this._speed;
		this._updateTransport();
	}

	// ── Trim / blend / loop edits ────────────────────────────────────────────
	/** Reset the trim/blend/loop controls for a newly-loaded clip. */
	_resetEdits(duration, loopDefault) {
		this._trimStart = 0;
		this._trimEnd = duration;
		this._blendMs = 0;
		this._loopOn = loopDefault !== false;
		// A clip that travels far opens pinned in place; one that only sways
		// gets no toggle at all.
		this._travel = this._baseClip ? rootTravel(this._baseClip) : 0;
		this._inPlace = this._travel > IN_PLACE_TRAVEL_M;
		this._syncInPlaceBtn();
		const { trimStartInput, trimEndInput, blendInput, loopBtn } = this._refs;
		if (trimStartInput) {
			trimStartInput.max = duration.toFixed(2);
			trimStartInput.value = '0';
		}
		if (trimEndInput) {
			trimEndInput.max = duration.toFixed(2);
			trimEndInput.value = duration.toFixed(2);
		}
		if (blendInput) blendInput.value = '0';
		if (loopBtn) {
			loopBtn.setAttribute('aria-pressed', String(this._loopOn));
			loopBtn.classList.toggle('is-on', this._loopOn);
		}
	}

	_setBlend(ms) {
		this._blendMs = Math.max(0, Math.min(2000, ms));
		if (this._refs.blendInput) this._refs.blendInput.value = String(this._blendMs);
	}

	_syncInPlaceBtn() {
		const { inPlaceBtn } = this._refs;
		if (!inPlaceBtn) return;
		inPlaceBtn.hidden = this._travel <= IN_PLACE_MIN_TRAVEL_M;
		inPlaceBtn.setAttribute('aria-pressed', String(this._inPlace));
		inPlaceBtn.classList.toggle('is-on', this._inPlace);
		inPlaceBtn.title = this._inPlace
			? `Playing in place. The motion travels ${this._travel.toFixed(1)} m; click to let it.`
			: 'Hold the figure in place so the motion stays in view and loops without a jump';
	}

	/** Apply in-place, the trim range and the loop-blend to `base`, never mutating it. */
	_computeEditedClip(source) {
		const base = this._inPlace ? pinRootInPlace(source) : source;
		const duration = base.duration;
		const start = Math.max(0, Math.min(this._trimStart, duration));
		const end = Math.max(start + 1 / 60, Math.min(this._trimEnd ?? duration, duration));
		const trimmed =
			start > 1e-3 || end < duration - 1e-3 ? trimClip(base, start, end) : base;
		const edited =
			this._loopOn && this._blendMs > 0 ? blendClipLoop(trimmed, this._blendMs / 1000) : trimmed;
		if (edited !== source) edited.name = source.name;
		return edited;
	}

	/** Re-derive and replay the edited clip after a trim/blend/loop control changes. */
	_onEditsChanged() {
		if (!this._baseClip || !this._activeDef) return;
		const wasPaused = this._paused;
		const edited = this._computeEditedClip(this._baseClip);
		const played = this._playClip(edited, { ...this._activeDef, loop: this._loopOn });
		if (played && wasPaused) {
			this._action.paused = true;
			this._paused = true;
			this._updatePlayIcon();
		}
	}

	_debounceEdits() {
		clearTimeout(this._editDebounce);
		this._editDebounce = setTimeout(() => this._onEditsChanged(), 180);
	}

	_onTrimInput() {
		const { trimStartInput, trimEndInput } = this._refs;
		const duration = this._baseClip?.duration || 0;
		let start = Math.max(0, parseFloat(trimStartInput.value) || 0);
		let end = parseFloat(trimEndInput.value);
		if (!Number.isFinite(end)) end = duration;
		if (end <= start) end = Math.min(duration, start + 0.1);
		start = Math.min(start, duration);
		this._trimStart = start;
		this._trimEnd = end;
		this._debounceEdits();
	}

	// ── Save to library ──────────────────────────────────────────────────────
	/**
	 * Save the active clip (with current trim/blend/loop edits applied) to the
	 * signed-in user's animation library. Saves the canonical, pre-retarget
	 * clip, the same basis AnimationManager plays everywhere, so it plays on
	 * any future rig, not just the one currently loaded.
	 */
	async _saveToLibrary(btn) {
		if (!this._baseClip || !this._activeDef) return;

		const defaultName = this._activeDef.label || this._activeDef.name || 'My animation';
		const nameInput = el('input', {
			type: 'text',
			class: 'al-save-name',
			value: defaultName,
			maxlength: '120',
			required: 'true',
			autocomplete: 'off',
			'aria-label': 'Animation name',
		});
		const visSelect = el('select', { class: 'al-save-vis', 'aria-label': 'Visibility' }, [
			el('option', { value: 'private' }, ['Private (only you)']),
			el('option', { value: 'unlisted' }, ['Unlisted (anyone with the link)']),
			el('option', { value: 'public' }, ['Public (listed in the library)']),
		]);
		const cancelBtn = el('button', { type: 'button', class: 'al-save-cancel' }, ['Cancel']);
		const submitBtn = el('button', { type: 'submit', class: 'al-save-submit' }, ['Save']);
		const form = el('form', { class: 'al-save-form' }, [
			el('label', { class: 'al-save-label' }, ['Name', nameInput]),
			el('label', { class: 'al-save-label' }, ['Visibility', visSelect]),
			el('div', { class: 'al-save-actions' }, [cancelBtn, submitBtn]),
		]);

		let resolved = false;
		const choice = await new Promise((resolve) => {
			const settle = (v) => {
				if (resolved) return;
				resolved = true;
				resolve(v);
			};
			const modal = new Modal({
				title: 'Save to your animation library',
				body: form,
				dismissible: true,
				onClose: () => settle(null),
			});
			cancelBtn.addEventListener('click', () => modal.close());
			form.addEventListener('submit', (e) => {
				e.preventDefault();
				settle({ name: nameInput.value.trim(), visibility: visSelect.value });
				modal.close();
			});
			modal.open(btn);
			nameInput.focus();
			nameInput.select();
		});
		if (!choice || !choice.name) return;

		const original = btn.textContent;
		btn.disabled = true;
		btn.textContent = 'Saving…';
		try {
			const clip = this._computeEditedClip(this._baseClip);
			const avatarId = this.getAvatarId();
			const res = await fetch('/api/animations/clips', {
				method: 'POST',
				credentials: 'include',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					name: choice.name,
					visibility: choice.visibility,
					kind: this._loopOn ? 'loop' : 'animation',
					loop: this._loopOn,
					avatar_id: avatarId && UUID_RE.test(avatarId) ? avatarId : undefined,
					clip: AnimationClip.toJSON(clip),
				}),
			});
			if (res.status === 401) {
				btn.disabled = false;
				btn.textContent = original;
				this.setStatus('Sign in to save animations to your library.', 'error');
				window.location.assign(
					`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`,
				);
				return;
			}
			const data = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
			btn.textContent = 'Saved ✓';
			this.setStatus(`Saved “${choice.name}” to your animation library.`);
		} catch (err) {
			log.warn('[AnimationLibrary] save failed:', err);
			btn.textContent = 'Failed';
			this.setStatus(`Save failed: ${err.message}`, 'error');
		} finally {
			setTimeout(() => {
				btn.disabled = false;
				btn.textContent = original;
			}, 2400);
		}
	}

	// ── Transport bar (now-playing + speed + loop + stop + export) ────────────
	_renderTransport() {
		const label = el('span', { class: 'al-now-label' });
		const speedVal = el('span', { class: 'al-speed-val' }, ['1.0×']);
		const speed = el('input', {
			type: 'range',
			min: '0.25',
			max: '2.5',
			step: '0.05',
			value: '1',
			class: 'al-speed',
			'aria-label': 'Playback speed',
		});
		speed.addEventListener('input', () => {
			this._setSpeed(parseFloat(speed.value));
		});
		const stop = el('button', { class: 'al-tbtn', type: 'button', title: 'Stop preview' }, [
			'⏹ Stop',
		]);
		stop.addEventListener('click', () => this.stopPreview());

		// Play/pause + scrubbable progress — the clip's own timeline, so users can
		// scrub to any frame, pause on a pose, and see how long the motion runs.
		const play = el('button', { class: 'al-play', type: 'button', title: 'Pause', 'aria-label': 'Pause' }, ['⏸']);
		play.addEventListener('click', () => this._togglePlay());
		const scrub = el('input', {
			type: 'range',
			min: '0',
			max: '1000',
			step: '1',
			value: '0',
			class: 'al-scrub',
			'aria-label': 'Scrub animation timeline',
		});
		const onScrub = () => {
			this._scrubbing = true;
			this._seek(parseInt(scrub.value, 10) / 1000);
		};
		scrub.addEventListener('input', onScrub);
		scrub.addEventListener('change', () => {
			this._scrubbing = false;
		});
		scrub.addEventListener('pointerup', () => {
			this._scrubbing = false;
		});
		const timeLabel = el('span', { class: 'al-time' }, ['0.0 / 0.0s']);

		const exportBtn = el(
			'button',
			{
				class: 'al-export',
				type: 'button',
				title: 'Download a GLB with this animation baked in',
			},
			['Export animated GLB'],
		);
		exportBtn.addEventListener('click', () => this._exportGLB(exportBtn));

		const saveBtn = el(
			'button',
			{
				class: 'al-save',
				type: 'button',
				title: 'Save this clip to your animation library',
			},
			['💾 Save to library'],
		);
		saveBtn.addEventListener('click', () => this._saveToLibrary(saveBtn));

		// Trim / blend / loop: cut the clip to a range and crossfade the loop seam,
		// the same editing affordances a Theatre.js-style timeline offers, applied
		// to the resolved clip (preset, generated, or spelled) before preview,
		// export, and save all see it.
		const trimStartInput = el('input', {
			type: 'number',
			class: 'al-trim-input',
			min: '0',
			step: '0.1',
			value: '0',
			'aria-label': 'Trim start, in seconds',
			title: 'Trim start (s)',
		});
		const trimEndInput = el('input', {
			type: 'number',
			class: 'al-trim-input',
			min: '0',
			step: '0.1',
			value: '0',
			'aria-label': 'Trim end, in seconds',
			title: 'Trim end (s)',
		});
		trimStartInput.addEventListener('input', () => this._onTrimInput());
		trimEndInput.addEventListener('input', () => this._onTrimInput());

		const blendInput = el('input', {
			type: 'number',
			class: 'al-blend-input',
			min: '0',
			max: '2000',
			step: '50',
			value: '0',
			'aria-label': 'Loop blend, in milliseconds',
			title: 'Crossfade the loop seam (ms)',
		});
		blendInput.addEventListener('input', () => {
			this._blendMs = Math.max(0, Math.min(2000, parseFloat(blendInput.value) || 0));
			this._debounceEdits();
		});

		const loopBtn = el(
			'button',
			{
				class: 'al-loop is-on',
				type: 'button',
				'aria-pressed': 'true',
				title: 'Toggle looping',
			},
			['🔁 Loop'],
		);
		loopBtn.addEventListener('click', () => {
			this._loopOn = !this._loopOn;
			loopBtn.setAttribute('aria-pressed', String(this._loopOn));
			loopBtn.classList.toggle('is-on', this._loopOn);
			this._onEditsChanged();
		});

		// In place: shown only for a motion whose root travels, so a walk can be
		// kept in view (and exported as an in-place cycle) or allowed to roam.
		const inPlaceBtn = el(
			'button',
			{ class: 'al-loop al-inplace', type: 'button', 'aria-pressed': 'false', hidden: true },
			['📍 In place'],
		);
		inPlaceBtn.addEventListener('click', () => {
			this._inPlace = !this._inPlace;
			this._syncInPlaceBtn();
			this._onEditsChanged();
		});

		const editRow = el('div', { class: 'al-edit-row' }, [
			el('label', { class: 'al-edit-field' }, ['Trim', trimStartInput, 'to', trimEndInput, 's']),
			el('label', { class: 'al-edit-field' }, ['Blend', blendInput, 'ms']),
			loopBtn,
			inPlaceBtn,
		]);

		const root = el('div', { class: 'al-transport', style: 'display:none' }, [
			el('div', { class: 'al-now' }, [el('span', { class: 'al-now-dot' }), label]),
			el('div', { class: 'al-scrub-row' }, [play, scrub, timeLabel]),
			el('div', { class: 'al-speed-row' }, [el('label', {}, ['Speed']), speed, speedVal]),
			editRow,
			el('div', { class: 'al-transport-actions' }, [stop, saveBtn, exportBtn]),
		]);

		this._refs = {
			...this._refs,
			transportLabel: label,
			transportSpeedVal: speedVal,
			transportSpeed: speed,
			transportPlay: play,
			transportScrub: scrub,
			transportTime: timeLabel,
			exportBtn,
			saveBtn,
			trimStartInput,
			trimEndInput,
			blendInput,
			loopBtn,
			inPlaceBtn,
		};
		return { root };
	}

	_updateTransport() {
		const { transportLabel, transportSpeedVal, transportSpeed } = this._refs;
		if (transportLabel && this._activeDef) {
			transportLabel.textContent = this._activeDef.label || this._activeDef.name;
		}
		if (transportSpeedVal) transportSpeedVal.textContent = `${this._speed.toFixed(2)}×`;
		if (transportSpeed) transportSpeed.value = String(this._speed);
	}

	async _exportGLB(btn) {
		const rig = this.getRig();
		if (!rig || !this._activeDef || !this._baseClip) return;
		const original = btn.textContent;
		const done = (txt, cls) => {
			btn.classList.remove('is-busy', 'is-ok', 'is-err');
			if (cls) btn.classList.add(cls);
			btn.textContent = txt;
			setTimeout(() => {
				btn.classList.remove('is-ok', 'is-err');
				btn.textContent = original;
			}, 2400);
		};
		btn.classList.add('is-busy');
		btn.textContent = 'Baking…';
		try {
			const base = this._computeEditedClip(this._baseClip);
			const { clip } = retargetClipToRig(base, rig);
			if (!clip) throw new Error('retarget failed');
			const exportClip = scaleClipSpeed(clip, this._speed);
			exportClip.name = this._activeDef.name;

			// Park the figure on the clip's first frame so the exported rest pose
			// is the animation's start, not wherever the live preview paused.
			if (this._action) {
				this._action.time = 0;
				this._mixer.update(0);
			}

			const exporter = new GLTFExporter();
			const buffer = await exporter.parseAsync(rig.root, {
				binary: true,
				animations: [exportClip],
				embedImages: true,
			});
			const safeRig =
				(rig.root?.name || 'avatar').replace(/[^a-z0-9._-]+/gi, '-').slice(0, 40) ||
				'avatar';
			this._download(buffer, `${safeRig}-${this._activeDef.name}.glb`);
			done('Saved ✓', 'is-ok');
			this.setStatus(
				`Exported animated GLB: ${this._activeDef.label || this._activeDef.name}.`,
			);
		} catch (err) {
			log.warn('[AnimationLibrary] export failed:', err);
			done('Failed', 'is-err');
			this.setStatus(`Export failed: ${err.message}`, 'error');
		}
	}

	_download(buffer, filename) {
		const blob =
			buffer instanceof Blob ? buffer : new Blob([buffer], { type: 'model/gltf-binary' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(url), 1500);
	}

	_disposeMixer() {
		if (this._mixer) {
			this._mixer.stopAllAction();
			try {
				this._mixer.uncacheRoot(this._mixerRoot);
			} catch {
				/* root already gone */
			}
		}
		this._mixer = null;
		this._mixerRoot = null;
		this._action = null;
	}
}
