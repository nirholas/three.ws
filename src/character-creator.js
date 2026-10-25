// Character creator (W03) — pick or generate a full-body 3D avatar, dress it in
// the cosmetics wardrobe, and carry the result into the live coin worlds (/play).
//
// One pipeline, three avatar sources:
//   1. Ready Player Me  — the full-body avatar creator in an iframe; exports a GLB.
//   2. Selfie → 3D      — the existing reconstruction modal (openSelfieModal).
//   3. Import           — bring your own GLB/VRM (file or URL).
// All three normalize to a loadable GLB the shared avatar rig drives, so the live
// preview here renders with the EXACT same path the worlds use (buildAvatar +
// AnimationManager + applyLoadout) — what you see on the turntable is what peers see.
//
// The wardrobe is the cosmetics catalog: free cosmetics equip instantly and preview
// live; premium ones are locked until owned. Clicking a locked chip runs the real
// x402 USDC purchase rail (cosmetics-purchase.js → /api/x402/cosmetic-purchase) and
// equips it once the server confirms ownership; anything the account already owns
// loads pre-unlocked from /api/cosmetics/catalog. On save we persist the avatar +
// equipped loadout via the shared hand-off (play-handoff) and jump into /play.

import { isReadyPlayerMeOrigin } from './rpm-origin.js';
import {
	Scene, PerspectiveCamera, WebGLRenderer, Group,
	HemisphereLight, DirectionalLight, Color, PMREMGenerator,
	Mesh, CircleGeometry, MeshStandardMaterial, ACESFilmicToneMapping, SRGBColorSpace,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { newAnim, buildAvatar, loadManifest, resolveAvatarUrl, AVATAR_DEFAULT } from './game/avatar-rig.js';
import { applyLoadout } from './game/cosmetics-loadout.js';
import {
	COSMETICS, SLOTS, SLOT_LABELS, getCosmetic, isFreeCosmetic, DEFAULT_LOADOUT,
} from '../multiplayer/src/cosmetics-catalog.js';
import { setPlayAvatar, setPlayName, setPlayCosmetics, playAs, getPlayAvatar } from './game/play-handoff.js';
import { purchaseCosmetic, fetchOwnedCosmetics, resolveShopAccount } from './game/cosmetics-purchase.js';
import { log } from './shared/log.js';
import { rippleOnce } from './ui-juice.js';

const $ = (id) => document.getElementById(id);

// Ready Player Me subdomain. Overridable via <meta name="rpm-subdomain">; the
// public `demo` subdomain works without a registered app and exports a GLB at
// models.readyplayer.me (allow-listed server-side for broadcast).
function rpmSubdomain() {
	const m = document.querySelector('meta[name="rpm-subdomain"]')?.getAttribute('content')?.trim();
	return m || 'demo';
}

class CharacterCreator {
	constructor() {
		this.equipped = { ...DEFAULT_LOADOUT };
		this.avatar = { kind: 'default', value: AVATAR_DEFAULT, label: 'Starter avatar' };
		this.height = 1.7;
		this.cosmeticHandle = null;
		this.anim = null;
		this._buildToken = 0;
		this._dragging = false;
		this._autoRotate = true;
		this._yaw = 0.4;
		// Premium cosmetics the signed-in/guest account already owns (from the R22
		// ledger). Owned premium chips equip like free ones; the rest open the
		// real USDC purchase rail on click.
		this.ownedPremium = new Set();
		this.priceUsdcById = new Map();
		this._buying = false;
	}

	async init() {
		this._initScene();
		this._renderWardrobe();
		this._wireSources();
		this._wireActions();
		// Pull owned premium cosmetics in the background; re-render the wardrobe once
		// they arrive so anything this account bought reads as unlocked, not locked.
		this._loadOwnedCosmetics();
		// Prefill the name from a previous session so returning players keep theirs.
		try {
			const n = localStorage.getItem('cc-name');
			if (n) $('cc-name-input').value = n;
		} catch { /* storage disabled */ }
		await loadManifest().catch(() => {});      // so the preview idles, not T-poses
		// If the player already has an avatar selected, start from it instead of the
		// bare default — the creator becomes an edit surface, not just a fresh start.
		const existing = getPlayAvatar();
		if (existing && existing !== 'guest:pending') {
			this.avatar = { kind: existing.startsWith('/') || /^https?:/.test(existing) ? 'url' : 'id', value: existing, label: 'Your avatar' };
		}
		await this._loadAvatar();
		this._tick();
	}

	// ── 3D scene ──────────────────────────────────────────────────────────────
	_initScene() {
		const canvas = $('cc-canvas');
		const wrap = $('cc-stage');
		const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
		renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
		renderer.toneMapping = ACESFilmicToneMapping;
		renderer.toneMappingExposure = 0.95;
		renderer.outputColorSpace = SRGBColorSpace;
		this.renderer = renderer;

		const scene = new Scene();
		scene.background = null;
		this.scene = scene;

		// Neutral studio IBL so PBR avatars (RPM/selfie) read correctly without a
		// hand-placed rig of lights.
		const pmrem = new PMREMGenerator(renderer);
		scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

		const cam = new PerspectiveCamera(32, 1, 0.1, 100);
		cam.position.set(0, 1.35, 3.4);
		cam.lookAt(0, 0.95, 0);
		this.camera = cam;

		scene.add(new HemisphereLight(0xffffff, 0x444450, 0.7));
		const key = new DirectionalLight(0xffffff, 1.6);
		key.position.set(2.5, 4, 3);
		scene.add(key);
		const rim = new DirectionalLight(0x88aaff, 0.5);
		rim.position.set(-3, 2, -2);
		scene.add(rim);

		// A subtle turntable disc so the avatar stands on something, not in a void.
		const disc = new Mesh(
			new CircleGeometry(1.1, 48),
			new MeshStandardMaterial({ color: new Color(0x111114), roughness: 0.9, metalness: 0 }),
		);
		disc.rotation.x = -Math.PI / 2;
		disc.position.y = 0.001;
		scene.add(disc);

		this.turntable = new Group();
		scene.add(this.turntable);
		this.rig = new Group();
		this.turntable.add(this.rig);

		this._resize();
		this._ro = new ResizeObserver(() => this._resize());
		this._ro.observe(wrap);

		// Drag to spin; release resumes the slow auto-rotate.
		const onDown = (e) => { this._dragging = true; this._autoRotate = false; this._lastX = (e.touches?.[0]?.clientX ?? e.clientX); };
		const onMove = (e) => {
			if (!this._dragging) return;
			const x = (e.touches?.[0]?.clientX ?? e.clientX);
			this._yaw += (x - this._lastX) * 0.01;
			this._lastX = x;
		};
		const onUp = () => { this._dragging = false; };
		canvas.addEventListener('pointerdown', onDown);
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
		canvas.addEventListener('touchstart', onDown, { passive: true });
		window.addEventListener('touchmove', onMove, { passive: true });
		window.addEventListener('touchend', onUp);
	}

	_resize() {
		const wrap = $('cc-stage');
		const w = wrap.clientWidth || 1;
		const h = wrap.clientHeight || 1;
		this.renderer.setSize(w, h, false);
		this.camera.aspect = w / h;
		this.camera.updateProjectionMatrix();
	}

	_tick() {
		const loop = () => {
			this._raf = requestAnimationFrame(loop);
			const dt = 1 / 60;
			if (this._autoRotate && !this._dragging) this._yaw += dt * 0.35;
			this.turntable.rotation.y = this._yaw;
			this.anim?.update(dt);
			this.cosmeticHandle?.tick(dt);
			this.renderer.render(this.scene, this.camera);
		};
		loop();
	}

	// ── Avatar loading ────────────────────────────────────────────────────────
	async _loadAvatar() {
		const token = ++this._buildToken;
		this._setStageState('loading');
		this.rig.clear();
		this.anim = newAnim();
		try {
			const url = await resolveAvatarUrl(this.avatar.value);
			const { height, fallback } = await buildAvatar(this.rig, url, this.anim);
			if (token !== this._buildToken) return; // a newer pick superseded this one
			this.height = height;
			this._applyCosmetics();
			this._setStageState(fallback ? 'fallback' : 'ready');
			$('cc-avatar-label').textContent = this.avatar.label || 'Avatar';
		} catch (err) {
			if (token !== this._buildToken) return;
			log.warn('[creator] avatar load failed', err?.message);
			this._setStageState('error');
		}
	}

	_applyCosmetics() {
		if (this.cosmeticHandle) { try { this.cosmeticHandle.dispose(); } catch {} this.cosmeticHandle = null; }
		this.cosmeticHandle = applyLoadout(this.rig, this.height, this.equipped);
	}

	_setStageState(state) {
		const stage = $('cc-stage');
		stage.dataset.state = state;
		const veil = $('cc-stage-veil');
		const msg = {
			loading: 'Loading avatar…',
			error: 'Couldn’t load that avatar. Pick another source below.',
			fallback: 'Using a stand-in — that model couldn’t load. Try another.',
			ready: '',
		}[state] || '';
		veil.textContent = msg;
		veil.hidden = !msg || state === 'loading' ? false : true;
		veil.classList.toggle('cc-veil--spin', state === 'loading');
		veil.classList.toggle('cc-veil--error', state === 'error' || state === 'fallback');
		// Real success beat — a single accent ripple the first time an avatar
		// actually finishes loading onto the stage (not on every idle re-render).
		if (state === 'ready' && this._lastStageState && this._lastStageState !== 'ready') {
			rippleOnce(stage);
		}
		this._lastStageState = state;
	}

	// ── Wardrobe ────────────────────────────────────────────────────────────────
	_renderWardrobe() {
		const root = $('cc-wardrobe');
		root.innerHTML = '';
		for (const slot of SLOTS) {
			const section = document.createElement('div');
			section.className = 'cc-slot';
			const h = document.createElement('h3');
			h.className = 'cc-slot__title';
			h.textContent = SLOT_LABELS[slot] || slot;
			section.appendChild(h);

			const grid = document.createElement('div');
			grid.className = 'cc-slot__grid';
			for (const c of COSMETICS.filter((x) => x.slot === slot)) {
				grid.appendChild(this._cosmeticChip(c));
			}
			section.appendChild(grid);
			root.appendChild(section);
		}
	}

	_cosmeticChip(c) {
		const unlocked = isFreeCosmetic(c.id) || this.ownedPremium.has(c.id);
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.className = 'cc-chip';
		btn.dataset.id = c.id;
		btn.dataset.slot = c.slot;
		btn.setAttribute('aria-pressed', String(this.equipped[c.slot] === c.id));
		if (!unlocked) btn.classList.add('cc-chip--locked');

		// Visual: a thumbnail for props, a colour swatch for dyes/auras, a glyph for "none".
		const media = document.createElement('span');
		media.className = 'cc-chip__media';
		if (c.thumb) {
			const img = document.createElement('img');
			img.src = c.thumb; img.alt = ''; img.loading = 'lazy';
			media.appendChild(img);
		} else if (c.swatch) {
			media.style.background = c.swatch;
			media.classList.add('cc-chip__media--swatch');
		} else {
			media.classList.add('cc-chip__media--none');
			media.textContent = '∅';
		}
		btn.appendChild(media);

		const name = document.createElement('span');
		name.className = 'cc-chip__name';
		name.textContent = c.name;
		btn.appendChild(name);

		if (!unlocked) {
			const lock = document.createElement('span');
			lock.className = 'cc-chip__lock';
			lock.textContent = `🔒 ${c.price} $THREE`;
			btn.appendChild(lock);
			btn.title = `Buy ${c.name} to equip it`;
		}

		btn.addEventListener('click', () => this._onChipClick(c, unlocked));
		return btn;
	}

	_onChipClick(c, unlocked) {
		if (!unlocked) {
			// Premium and not owned: run the real USDC purchase rail. The chip equips
			// only after the server confirms ownership — no optimistic unlock.
			this._buyCosmetic(c);
			return;
		}
		this.equipped[c.slot] = c.id;
		this._applyCosmetics();
		// Reflect selection: only one chip pressed per slot.
		for (const el of document.querySelectorAll(`.cc-chip[data-slot="${c.slot}"]`)) {
			el.setAttribute('aria-pressed', String(el.dataset.id === c.id));
		}
	}

	// Load the real catalog for this account: which premium cosmetics it already
	// owns (so they equip like free chips) and each item's USDC checkout price (so
	// the purchase modal shows the true amount). Falls back to the owned-ids ledger
	// if the catalog endpoint is unavailable. Best-effort — a failure just leaves
	// premium chips locked, still buyable.
	async _loadOwnedCosmetics() {
		const acct = resolveShopAccount();
		try {
			const r = await fetch(`/api/cosmetics/catalog?account=${encodeURIComponent(acct)}`, {
				headers: { accept: 'application/json' },
			});
			if (r.ok) {
				const body = await r.json();
				const items = Array.isArray(body?.items) ? body.items : [];
				const owned = new Set();
				for (const it of items) {
					if (it?.id && Number.isFinite(Number(it.priceUsdc))) this.priceUsdcById.set(it.id, Number(it.priceUsdc));
					if (it?.id && it.owned) owned.add(it.id);
				}
				this.ownedPremium = owned;
				this._renderWardrobe();
				return;
			}
		} catch { /* fall through to the owned-ids ledger */ }
		try {
			const owned = await fetchOwnedCosmetics(acct);
			if (Array.isArray(owned) && owned.length) {
				this.ownedPremium = new Set(owned);
				this._renderWardrobe();
			}
		} catch { /* keep premium chips locked */ }
	}

	// Buy a premium cosmetic over the x402 USDC rail. On a settled purchase the
	// item joins the owned set, the wardrobe re-renders unlocked, and it equips.
	async _buyCosmetic(c) {
		if (this._buying) return;
		this._buying = true;
		this._toast(`Opening wallet to unlock ${c.name}…`);
		try {
			await purchaseCosmetic(
				{ id: c.id, name: c.name, priceUsdc: this.priceUsdcById.get(c.id) },
				{ account: resolveShopAccount() },
			);
			this.ownedPremium.add(c.id);
			this.equipped[c.slot] = c.id;
			this._renderWardrobe();
			this._applyCosmetics();
			for (const el of document.querySelectorAll(`.cc-chip[data-slot="${c.slot}"]`)) {
				el.setAttribute('aria-pressed', String(el.dataset.id === c.id));
			}
			this._toast(`Unlocked ${c.name} — equipped.`);
		} catch (err) {
			if (err?.code === 'cancelled') {
				this._toast('Purchase cancelled.');
			} else {
				this._toast(`Couldn’t unlock ${c.name} — ${err?.message || 'try again'}.`);
			}
		} finally {
			this._buying = false;
		}
	}

	// ── Avatar source actions ───────────────────────────────────────────────────
	_wireSources() {
		$('cc-src-rpm')?.addEventListener('click', () => this._openReadyPlayerMe());
		$('cc-src-selfie')?.addEventListener('click', () => this._openSelfie());
		$('cc-src-import')?.addEventListener('click', () => $('cc-import-file').click());
		$('cc-import-file')?.addEventListener('change', (e) => this._onImportFile(e));
		$('cc-import-url-btn')?.addEventListener('click', () => this._onImportUrl());
	}

	_openReadyPlayerMe() {
		const modal = $('cc-rpm-modal');
		const frame = $('cc-rpm-frame');
		frame.src = `https://${rpmSubdomain()}.readyplayer.me/avatar?frameApi&clearCache`;
		modal.hidden = false;
		modal.classList.add('open');
		// RPM posts a JSON string event; the GLB URL arrives on v1.avatar.exported.
		if (!this._rpmListener) {
			this._rpmListener = (ev) => {
				if (ev.source !== frame.contentWindow || !isReadyPlayerMeOrigin(ev.origin)) return;
				let data = ev.data;
				try { if (typeof data === 'string') data = JSON.parse(data); } catch { return; }
				if (data?.source !== 'readyplayerme') return;
				// Subscribe to events once the frame is ready.
				if (data.eventName === 'v1.frame.ready') {
					frame.contentWindow?.postMessage(
						JSON.stringify({ target: 'readyplayerme', type: 'subscribe', eventName: 'v1.**' }), '*');
				}
				if (data.eventName === 'v1.avatar.exported' && data.data?.url) {
					this._closeRpm();
					this.avatar = { kind: 'url', value: data.data.url, label: 'Ready Player Me' };
					this._loadAvatar();
					this._toast('Avatar imported from Ready Player Me.');
				}
			};
			window.addEventListener('message', this._rpmListener);
		}
		$('cc-rpm-close')?.addEventListener('click', () => this._closeRpm(), { once: true });
	}

	_closeRpm() {
		const modal = $('cc-rpm-modal');
		const frame = $('cc-rpm-frame');
		if (this._rpmListener) {
			window.removeEventListener('message', this._rpmListener);
			this._rpmListener = null;
		}
		modal.classList.remove('open');
		modal.hidden = true;
		frame.src = 'about:blank';
	}

	async _openSelfie() {
		try {
			const { openSelfieModal } = await import('./selfie-modal.js');
			const res = await openSelfieModal({ avatarType: 'v1' });
			if (res?.avatarId) {
				this.avatar = { kind: 'id', value: res.avatarId, label: 'Selfie avatar' };
				await this._loadAvatar();
				this._toast('Avatar built from your selfie.');
			}
		} catch (err) {
			log.warn('[creator] selfie modal failed', err?.message);
			this._toast('Selfie avatars aren’t available right now — try another source.');
		}
	}

	_onImportFile(e) {
		const file = e.target.files?.[0];
		e.target.value = '';
		if (!file) return;
		if (!/\.(glb|vrm)$/i.test(file.name)) { this._toast('Import a .glb or .vrm file.'); return; }
		// Stage the blob locally (guest avatar) so the preview loads instantly and
		// /play uploads it in the background on entry — the existing import path.
		this.avatar = { kind: 'blob', value: file, label: file.name };
		const obj = URL.createObjectURL(file);
		this._importBlobUrl = obj;
		this._loadAvatarFromObjectUrl(obj);
	}

	async _loadAvatarFromObjectUrl(objUrl) {
		const token = ++this._buildToken;
		this._setStageState('loading');
		this.rig.clear();
		this.anim = newAnim();
		try {
			const { height, fallback } = await buildAvatar(this.rig, objUrl, this.anim);
			if (token !== this._buildToken) return;
			this.height = height;
			this._applyCosmetics();
			this._setStageState(fallback ? 'fallback' : 'ready');
			$('cc-avatar-label').textContent = this.avatar.label || 'Imported avatar';
		} catch (err) {
			if (token !== this._buildToken) return;
			this._setStageState('error');
		}
	}

	_onImportUrl() {
		const input = $('cc-import-url');
		const url = (input.value || '').trim();
		if (!url) return;
		if (!/^https?:\/\/.+\.(glb|vrm)(\?.*)?$/i.test(url)) {
			this._toast('Paste a direct link to a .glb or .vrm file.');
			return;
		}
		this.avatar = { kind: 'url', value: url, label: 'Imported URL' };
		input.value = '';
		this._loadAvatar();
	}

	// ── Save & enter ────────────────────────────────────────────────────────────
	_wireActions() {
		$('cc-save')?.addEventListener('click', () => this._save('/play'));
		$('cc-save-only')?.addEventListener('click', () => this._save(null));
	}

	async _save(dest) {
		const name = ($('cc-name-input').value || '').trim();
		if (name) setPlayName(name);
		// Persist the equipped loadout (server re-validates ownership on join).
		setPlayCosmetics(this.equipped);

		const btn = dest ? $('cc-save') : $('cc-save-only');
		const restore = btn?.textContent;
		if (btn) { btn.disabled = true; btn.textContent = dest ? 'Entering…' : 'Saving…'; }

		try {
			if (this.avatar.kind === 'blob') {
				// Hand the freshly-imported GLB to /play via the guest-staging path.
				await playAs({ blob: this.avatar.value, name, dest: dest || null, source: 'character-creator' });
				if (!dest) this._toast('Saved. Your avatar is ready.');
			} else if (this.avatar.kind === 'default') {
				setPlayAvatar('');
				if (dest) location.href = dest; else this._toast('Saved.');
			} else {
				// url or id
				await playAs({ [this.avatar.kind === 'id' ? 'id' : 'url']: this.avatar.value, name, dest: dest || null, source: 'character-creator' });
				if (!dest) this._toast('Saved. Your avatar is ready.');
			}
		} catch (err) {
			log.error('[creator] save failed', err?.message);
			this._toast('Couldn’t save — please try again.');
		} finally {
			if (btn && !dest) { btn.disabled = false; btn.textContent = restore; }
		}
	}

	_toast(text) {
		const el = $('cc-toast');
		el.textContent = text;
		el.classList.add('show');
		clearTimeout(this._toastTimer);
		this._toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
	}
}

const creator = new CharacterCreator();
creator.init().catch((err) => log.error('[creator] init failed', err));
