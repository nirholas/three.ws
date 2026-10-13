/**
 * Walk-Browse — the marketplace as a 3D gallery you stroll through.
 *
 * Activated only on /marketplace-walk (walk.js boots with ?gallery=marketplace).
 * Every marketplace listing — agents, avatars, skills — becomes a lit plinth in
 * a procedurally generated hall: artwork on a vertical billboard, title + price
 * floating above. Walk within two metres and the full listing slides in from the
 * right; press E (or tap) to open its detail page.
 *
 * The hall is endless. The walk engine pins the avatar inside a bounded ground
 * disc, so rather than march the avatar down an infinite corridor we run a
 * treadmill: the player's forward travel scrolls a belt of plinths past a fixed
 * anchor while the avatar stays centred. A pool of plinth meshes recycles from
 * back to front — when one slides behind you it leaps to the far end carrying the
 * next listing — so memory is constant no matter how far you browse. Listings
 * stream in page-by-page from the real marketplace APIs; once every page is in,
 * the hall loops the full catalogue so it never dead-ends.
 *
 * Everything rendered is real: agents from /api/marketplace/agents, avatars from
 * /api/explore, skills from /api/skills — same data, prices, and detail routes
 * the 2D grid uses, so a number never disagrees across surfaces.
 */

import {
	Group,
	Mesh,
	PlaneGeometry,
	CylinderGeometry,
	BoxGeometry,
	RingGeometry,
	MeshBasicMaterial,
	MeshStandardMaterial,
	CanvasTexture,
	TextureLoader,
	SRGBColorSpace,
	DoubleSide,
	MathUtils,
} from 'three';

import {
	PAGE_SIZE,
	FILTERS,
	normalizeFilterKey,
	normalizeAgent,
	normalizeAvatar,
	normalizeSkill,
	interleave,
	fmtCount,
} from './marketplace-gallery-data.js';

// ── Layout (metres) ─────────────────────────────────────────────────────────
const SPACING = 4; // a plinth every 4m down the hall
const START_Z = 4; // first plinth sits 4m ahead of the anchor
const SLOT_COUNT = 10; // recycled plinth pool — covers the full visible span
const SIDE_X = 3; // plinths stand 3m off the centre line, alternating sides
const ANCHOR_Z = 0; // world-z the avatar is pinned to (treadmill centre)
const LATERAL_LIMIT = 7.5; // how far the player may strafe off the centre line
const RECYCLE_BEHIND = 6; // once a plinth is this far behind, recycle it forward
const ENTER_RANGE = 2.0; // step within 2m → reveal the listing
const RELEASE_RANGE = 3.4; // step past this → dismiss (hysteresis stops flicker)
const REBASE_AT = 500; // fold belt offset back near 0 to preserve float precision

// Monochrome brightness tiers — matches the platform's monochrome design system
// (public/tokens.css). Type identity is carried by brightness (and the explicit
// TYPE_LABEL text drawn on every plinth + the panel badge), never a brand hue, so
// the hall reads as one cohesive material rather than three colour-coded zones.
const TYPE_ACCENT = { agent: '#fafafa', avatar: '#c8c8d0', skill: '#9a9aa3' };
const TYPE_LABEL = { agent: 'Agent', avatar: 'Avatar', skill: 'Skill' };

const STYLE_ID = 'marketplace-gallery-styles';

function ensureStyles() {
	if (document.getElementById(STYLE_ID)) return;
	const s = document.createElement('style');
	s.id = STYLE_ID;
	s.textContent = `
.mwg-top{position:fixed;top:calc(env(safe-area-inset-top,0) + 110px);left:50%;
	transform:translateX(-50%);z-index:6;display:flex;flex-direction:column;align-items:center;
	gap:8px;max-width:calc(100vw - 24px);}
.mwg-chips{display:flex;gap:6px;padding:5px;border-radius:999px;
	background:rgba(10,10,12,.72);border:1px solid rgba(255,255,255,.1);
	backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);box-shadow:0 8px 28px rgba(0,0,0,.4);}
.mwg-chip{appearance:none;border:0;background:transparent;color:#a1a1aa;font:inherit;font-size:13px;
	font-weight:600;padding:7px 15px;border-radius:999px;cursor:pointer;white-space:nowrap;
	transition:background .15s ease,color .15s ease;}
.mwg-chip:hover{color:#fafafa;background:rgba(255,255,255,.06);}
.mwg-chip[aria-pressed="true"]{color:#0a0a0a;background:#fafafa;}
.mwg-chip:focus-visible{outline:2px solid rgba(255,255,255,.6);outline-offset:2px;}

.mwg-search{display:flex;align-items:center;gap:8px;padding:0 12px;height:38px;border-radius:999px;
	background:rgba(10,10,12,.72);border:1px solid rgba(255,255,255,.1);width:min(340px,72vw);
	backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);box-shadow:0 8px 28px rgba(0,0,0,.4);
	transition:border-color .15s ease;}
.mwg-search:focus-within{border-color:rgba(255,255,255,.35);}
.mwg-search svg{flex:0 0 auto;color:#a1a1aa;}
.mwg-search input{flex:1;min-width:0;appearance:none;border:0;background:transparent;color:#fafafa;
	font:inherit;font-size:13px;outline:none;}
.mwg-search input::placeholder{color:#71717a;}
.mwg-search-clear{flex:0 0 auto;appearance:none;border:0;background:transparent;color:#a1a1aa;
	font:inherit;font-size:16px;line-height:1;cursor:pointer;padding:2px 4px;display:none;border-radius:50%;}
.mwg-search-clear:hover{color:#fafafa;}
.mwg-search[data-has-query] .mwg-search-clear{display:block;}
.mwg-search-clear:focus-visible{outline:2px solid rgba(255,255,255,.6);outline-offset:1px;}

.mwg-panel{position:fixed;top:50%;right:max(16px,env(safe-area-inset-right,0));
	transform:translate(calc(100% + 32px),-50%);z-index:7;width:min(340px,calc(100vw - 32px));
	max-height:min(78vh,640px);overflow:hidden auto;border-radius:18px;
	background:rgba(12,12,14,.86);border:1px solid rgba(255,255,255,.12);
	backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);
	box-shadow:0 24px 70px rgba(0,0,0,.55);color:#fafafa;
	transition:transform .32s cubic-bezier(.22,1,.36,1),opacity .26s ease;opacity:0;
	scrollbar-width:thin;}
.mwg-panel[data-show="1"]{transform:translate(0,-50%);opacity:1;}
.mwg-panel-media{position:relative;width:100%;aspect-ratio:16/10;background:#17171b;overflow:hidden;}
.mwg-panel-media img{width:100%;height:100%;object-fit:cover;display:block;}
.mwg-panel-fallback{width:100%;height:100%;display:flex;align-items:center;justify-content:center;
	font-size:64px;font-weight:800;color:rgba(255,255,255,.9);}
.mwg-panel-badge{position:absolute;top:12px;left:12px;font-size:11px;font-weight:700;
	letter-spacing:.04em;text-transform:uppercase;padding:5px 10px;border-radius:999px;
	color:#0a0a0a;}
.mwg-panel-body{padding:16px 18px 18px;}
.mwg-panel-title{margin:0 0 4px;font-size:18px;font-weight:700;line-height:1.25;}
.mwg-panel-author{margin:0 0 10px;font-size:12px;color:#a1a1aa;}
.mwg-panel-desc{margin:0 0 14px;font-size:13px;line-height:1.5;color:#c8c8d0;
	display:-webkit-box;-webkit-line-clamp:5;-webkit-box-orient:vertical;overflow:hidden;}
.mwg-panel-stats{display:flex;flex-wrap:wrap;align-items:center;gap:5px 14px;margin:0 0 12px;
	font-size:12.5px;color:#a1a1aa;}
.mwg-panel-stat{display:inline-flex;align-items:center;gap:5px;}
.mwg-panel-stat b{color:#fafafa;font-weight:700;font-variant-numeric:tabular-nums;}
.mwg-panel-stat .star{color:#fafafa;font-size:13px;line-height:1;}
.mwg-panel-tags{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 14px;}
.mwg-panel-tag{font-size:11px;color:#c8c8d0;background:rgba(255,255,255,.06);
	border:1px solid rgba(255,255,255,.08);border-radius:999px;padding:3px 9px;white-space:nowrap;}
.mwg-panel-meta{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:14px;}
.mwg-panel-price{font-size:17px;font-weight:700;}
.mwg-panel-cat{font-size:11px;font-weight:600;color:#a1a1aa;text-transform:capitalize;
	padding:4px 9px;border-radius:999px;background:rgba(255,255,255,.06);}
.mwg-panel-actions{display:flex;gap:8px;align-items:stretch;}
.mwg-panel-cta{flex:1;display:flex;align-items:center;justify-content:center;gap:8px;
	appearance:none;border:0;border-radius:12px;padding:12px 16px;font:inherit;font-size:14px;
	font-weight:700;color:#0a0a0a;background:#fafafa;text-decoration:none;cursor:pointer;
	transition:filter .15s ease,transform .1s ease;}
.mwg-panel-cta:hover{filter:brightness(1.08);}
.mwg-panel-cta:active{transform:scale(.98);}
.mwg-panel-cta:focus-visible{outline:2px solid #fff;outline-offset:2px;}
.mwg-panel-share{flex:0 0 auto;display:flex;align-items:center;justify-content:center;width:44px;
	appearance:none;border:1px solid rgba(255,255,255,.14);border-radius:12px;background:rgba(255,255,255,.04);
	color:#fafafa;cursor:pointer;transition:background .15s ease,border-color .15s ease;}
.mwg-panel-share:hover{background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.3);}
.mwg-panel-share:active{transform:scale(.96);}
.mwg-panel-share:focus-visible{outline:2px solid #fff;outline-offset:2px;}
.mwg-panel-share[data-copied="1"]{color:#0a0a0a;background:#fafafa;border-color:#fafafa;}
.mwg-panel-hint{margin:9px 0 0;text-align:center;font-size:11px;color:#71717a;}
.mwg-panel-hint kbd{font-family:ui-monospace,Menlo,monospace;font-size:10.5px;padding:1px 5px;
	border-radius:4px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.14);}

.mwg-prompt{position:fixed;left:50%;bottom:calc(86px + env(safe-area-inset-bottom,0));
	transform:translateX(-50%) translateY(8px);z-index:6;display:none;align-items:center;gap:9px;
	padding:9px 16px;border-radius:999px;background:rgba(10,10,12,.82);
	border:1px solid rgba(255,255,255,.14);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
	color:#fafafa;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 8px 26px rgba(0,0,0,.45);
	transition:opacity .2s ease,transform .2s ease;opacity:0;}
.mwg-prompt[data-show="1"]{display:inline-flex;opacity:1;transform:translateX(-50%) translateY(0);}
.mwg-prompt kbd{font-family:ui-monospace,Menlo,monospace;font-size:11px;padding:2px 7px;border-radius:5px;
	background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.2);}

.mwg-toast{position:fixed;left:50%;top:calc(env(safe-area-inset-top,0) + 168px);
	transform:translateX(-50%);z-index:6;display:none;align-items:center;gap:12px;
	padding:12px 18px;border-radius:14px;background:rgba(12,12,14,.9);
	border:1px solid rgba(255,255,255,.12);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
	color:#fafafa;font-size:13px;box-shadow:0 12px 40px rgba(0,0,0,.5);max-width:min(420px,calc(100vw - 32px));}
.mwg-toast[data-show="1"]{display:inline-flex;}
.mwg-toast a,.mwg-toast button{color:#fafafa;font-weight:700;text-decoration:underline;background:none;
	border:0;font:inherit;cursor:pointer;padding:0;white-space:nowrap;}

@media (hover:none),(max-width:640px){
	.mwg-top{top:calc(env(safe-area-inset-top,0) + 100px);}
	.mwg-search{width:min(340px,82vw);}
	.mwg-panel{top:auto;bottom:calc(150px + env(safe-area-inset-bottom,0));right:50%;
		transform:translate(50%,calc(100% + 40px));width:min(360px,calc(100vw - 24px));max-height:46vh;}
	.mwg-panel[data-show="1"]{transform:translate(50%,0);}
	.mwg-prompt{bottom:calc(150px + env(safe-area-inset-bottom,0));}
}
@media (prefers-reduced-motion:reduce){
	.mwg-panel,.mwg-prompt,.mwg-chip,.mwg-panel-cta,.mwg-search,.mwg-panel-share{transition:none;}
}
body.is-zen .mwg-top,body.is-zen .mwg-panel,body.is-zen .mwg-prompt,body.is-zen .mwg-toast{display:none !important;}
`;
	document.head.appendChild(s);
}

/**
 * @param {object} cfg
 * @param {import('three').Scene} cfg.scene
 * @param {() => {x:number,y:number,z:number}} cfg.getLocalPosition
 */
export function createMarketplaceGallery({ scene, getLocalPosition }) {
	ensureStyles();

	const texLoader = new TextureLoader();
	texLoader.setCrossOrigin('anonymous');

	// ── Static hall: a runner + side bases anchored under the avatar so the
	//    scrolling plinths always have a floor (the engine's ground disc is
	//    only 12m wide; the hall reaches far past it). ─────────────────────────
	const hall = new Group();
	hall.name = 'mwg-hall';
	const runner = new Mesh(
		new PlaneGeometry(7, 80),
		new MeshStandardMaterial({ color: 0xd9d5cc, roughness: 0.95, metalness: 0 }),
	);
	runner.rotation.x = -Math.PI / 2;
	runner.position.set(0, 0.02, ANCHOR_Z - 28);
	runner.receiveShadow = true;
	hall.add(runner);
	const centerLine = new Mesh(
		new PlaneGeometry(0.12, 80),
		new MeshBasicMaterial({ color: 0xb8b2a6 }),
	);
	centerLine.rotation.x = -Math.PI / 2;
	centerLine.position.set(0, 0.03, ANCHOR_Z - 28);
	hall.add(centerLine);
	for (const sx of [-3.5, 3.5]) {
		const base = new Mesh(
			new BoxGeometry(0.5, 0.5, 80),
			new MeshStandardMaterial({ color: 0xf2efe9, roughness: 0.9, metalness: 0 }),
		);
		base.position.set(sx, 0.25, ANCHOR_Z - 28);
		base.castShadow = true;
		base.receiveShadow = true;
		hall.add(base);
	}
	scene.add(hall);

	// ── Plinth pool (recycled) ─────────────────────────────────────────────────
	const belt = new Group();
	belt.name = 'mwg-belt';
	scene.add(belt);

	/** @type {Array<ReturnType<typeof buildSlot>>} */
	const slots = [];

	function makeFallbackTexture(name, accentHex) {
		const c = document.createElement('canvas');
		c.width = 512;
		c.height = 640;
		const ctx = c.getContext('2d');
		const g = ctx.createLinearGradient(0, 0, 0, 640);
		g.addColorStop(0, accentHex);
		g.addColorStop(1, '#0c0c0e');
		ctx.fillStyle = g;
		ctx.fillRect(0, 0, 512, 640);
		ctx.fillStyle = 'rgba(255,255,255,.92)';
		ctx.font = '800 240px Inter, system-ui, sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText((name || '?').trim().charAt(0).toUpperCase() || '?', 256, 320);
		const tex = new CanvasTexture(c);
		tex.colorSpace = SRGBColorSpace;
		return tex;
	}

	function drawLabel(canvas, listing, accentHex) {
		const ctx = canvas.getContext('2d');
		const W = canvas.width;
		const H = canvas.height;
		ctx.clearRect(0, 0, W, H);
		const r = 26;
		ctx.fillStyle = 'rgba(10,10,12,.92)';
		ctx.beginPath();
		ctx.moveTo(r, 0);
		ctx.arcTo(W, 0, W, H, r);
		ctx.arcTo(W, H, 0, H, r);
		ctx.arcTo(0, H, 0, 0, r);
		ctx.arcTo(0, 0, W, 0, r);
		ctx.fill();
		ctx.fillStyle = accentHex;
		ctx.fillRect(0, 0, 12, H);
		// name (truncate to fit one line)
		ctx.fillStyle = '#fafafa';
		ctx.font = '700 52px Inter, system-ui, sans-serif';
		ctx.textBaseline = 'middle';
		ctx.textAlign = 'left';
		let name = listing.name || '';
		while (ctx.measureText(name).width > W - 60 && name.length > 1) {
			name = name.slice(0, -2);
		}
		if (name !== (listing.name || '')) name = name.trimEnd() + '…';
		ctx.fillText(name, 36, H * 0.36);
		// price (left) + rating·type (right) — rating only when it carries votes,
		// so an unrated plinth simply reads its type.
		ctx.font = '700 44px Inter, system-ui, sans-serif';
		ctx.fillStyle = accentHex;
		ctx.fillText(listing.price, 36, H * 0.74);
		ctx.font = '600 32px Inter, system-ui, sans-serif';
		ctx.fillStyle = '#a1a1aa';
		ctx.textAlign = 'right';
		const typeText = TYPE_LABEL[listing.type] || '';
		const rightText = listing.rating ? `★ ${listing.rating.avg}  ·  ${typeText}` : typeText;
		ctx.fillText(rightText, W - 36, H * 0.74);
	}

	function coverFit(tex, imgW, imgH, planeAspect) {
		const imgAspect = imgW / imgH;
		tex.center.set(0.5, 0.5);
		if (imgAspect > planeAspect) {
			tex.repeat.set(planeAspect / imgAspect, 1);
		} else {
			tex.repeat.set(1, imgAspect / planeAspect);
		}
	}

	function buildSlot(index) {
		const side = index % 2 === 0 ? -1 : 1;
		const group = new Group();
		group.position.set(side * SIDE_X, 0, -(START_Z + index * SPACING));
		const faceYaw = side < 0 ? Math.PI / 2 : -Math.PI / 2;

		const pedestal = new Mesh(
			new CylinderGeometry(0.5, 0.66, 1.0, 28),
			new MeshStandardMaterial({ color: 0xeceae4, roughness: 0.85, metalness: 0.05 }),
		);
		pedestal.position.y = 0.5;
		pedestal.castShadow = true;
		pedestal.receiveShadow = true;
		group.add(pedestal);

		const frame = new Mesh(
			new BoxGeometry(1.78, 2.18, 0.08),
			new MeshStandardMaterial({ color: 0x18181b, roughness: 0.6, metalness: 0.1 }),
		);
		frame.position.set(0, 2.1, -0.04);
		frame.rotation.y = faceYaw;
		frame.castShadow = true;
		group.add(frame);

		const billboardMat = new MeshBasicMaterial({ side: DoubleSide, toneMapped: false });
		const billboard = new Mesh(new PlaneGeometry(1.6, 2.0), billboardMat);
		billboard.position.set(0, 2.1, 0);
		billboard.rotation.y = faceYaw;
		group.add(billboard);

		const labelCanvas = document.createElement('canvas');
		labelCanvas.width = 512;
		labelCanvas.height = 176;
		const labelTex = new CanvasTexture(labelCanvas);
		labelTex.colorSpace = SRGBColorSpace;
		const label = new Mesh(
			new PlaneGeometry(1.7, 0.58),
			new MeshBasicMaterial({
				map: labelTex,
				transparent: true,
				toneMapped: false,
				side: DoubleSide,
			}),
		);
		label.position.set(0, 3.5, 0);
		label.rotation.y = faceYaw;
		group.add(label);

		const ring = new Mesh(
			new RingGeometry(0.74, 0.92, 40),
			new MeshBasicMaterial({
				color: 0xffffff,
				transparent: true,
				opacity: 0.9,
				side: DoubleSide,
			}),
		);
		ring.rotation.x = -Math.PI / 2;
		ring.position.y = 0.05;
		ring.visible = false;
		group.add(ring);

		group.visible = false;
		belt.add(group);

		return {
			index,
			side,
			group,
			billboard,
			billboardMat,
			label,
			labelTex,
			labelCanvas,
			ring,
			listing: null,
			imgToken: 0,
		};
	}

	function assignListing(slot, listing) {
		slot.listing = listing;
		slot.group.visible = true;
		const accent = TYPE_ACCENT[listing.type] || '#fafafa';
		slot.ring.material.color.set(accent);
		drawLabel(slot.labelCanvas, listing, accent);
		slot.labelTex.needsUpdate = true;

		// Swap artwork. Dispose the previous map so a long browse never leaks GPU.
		const token = ++slot.imgToken;
		const setMap = (tex) => {
			if (token !== slot.imgToken) {
				tex.dispose();
				return;
			}
			const prev = slot.billboardMat.map;
			slot.billboardMat.map = tex;
			slot.billboardMat.needsUpdate = true;
			if (prev) prev.dispose();
		};
		if (listing.image) {
			texLoader.load(
				listing.image,
				(tex) => {
					tex.colorSpace = SRGBColorSpace;
					coverFit(tex, tex.image?.width || 1, tex.image?.height || 1, 1.6 / 2.0);
					setMap(tex);
				},
				undefined,
				() => setMap(makeFallbackTexture(listing.name, accent)),
			);
		} else {
			setMap(makeFallbackTexture(listing.name, accent));
		}
	}

	// ── Listing stream (real APIs, paged, then looped) ──────────────────────────
	const sources = {
		agent: { cursor: null, done: false, fetch: fetchAgents },
		avatar: { cursor: null, done: false, fetch: fetchAvatars },
		skill: { cursor: null, done: false, fetch: fetchSkills },
	};
	// Deep-link state: ?type=skill (or skills/agent/avatar) picks the opening
	// filter, ?q= seeds an in-hall search — so a shared link lands on exactly the
	// slice of the marketplace it points at.
	const bootParams = new URLSearchParams(location.search);
	let filter = normalizeFilterKey(bootParams.get('type') || bootParams.get('filter')) || 'all';
	let query = (bootParams.get('q') || '').trim().slice(0, 80);
	let buffer = []; // normalised listings waiting for a plinth
	let served = []; // everything seen this filter — replayed once pages run out
	let loading = false;
	let loadError = false;
	let loadedAny = false;

	async function fetchAgents(cursor) {
		const u = new URL('/api/marketplace/agents', location.origin);
		u.searchParams.set('limit', String(PAGE_SIZE));
		u.searchParams.set('sort', 'recommended');
		if (query) u.searchParams.set('q', query);
		if (cursor) u.searchParams.set('cursor', cursor);
		const r = await fetch(u);
		if (!r.ok) throw new Error(`agents ${r.status}`);
		const j = await r.json();
		const items = (j?.data?.items || []).map(normalizeAgent);
		return { items, next: j?.data?.next_cursor || null };
	}

	async function fetchAvatars(cursor) {
		const u = new URL('/api/explore', location.origin);
		u.searchParams.set('source', 'avatar');
		u.searchParams.set('quality', 'high');
		u.searchParams.set('limit', String(PAGE_SIZE));
		if (query) u.searchParams.set('q', query);
		if (cursor) u.searchParams.set('cursor', cursor);
		const r = await fetch(u);
		if (!r.ok) throw new Error(`avatars ${r.status}`);
		const j = await r.json();
		const items = (j?.items || []).map(normalizeAvatar);
		return { items, next: j?.nextCursor || null };
	}

	async function fetchSkills(cursor) {
		const u = new URL('/api/skills', location.origin);
		u.searchParams.set('limit', String(PAGE_SIZE));
		u.searchParams.set('sort', 'popular');
		if (query) u.searchParams.set('q', query);
		if (cursor) u.searchParams.set('cursor', cursor);
		const r = await fetch(u);
		if (!r.ok) throw new Error(`skills ${r.status}`);
		const j = await r.json();
		const items = (j?.skills || []).map(normalizeSkill);
		return { items, next: j?.next_cursor || null };
	}

	function activeSources() {
		return filter === 'all' ? ['agent', 'avatar', 'skill'] : [filter];
	}

	function allDone() {
		return activeSources().every((k) => sources[k].done);
	}

	async function loadPage() {
		if (loading || allDone()) return;
		loading = true;
		const want = activeSources().filter((k) => !sources[k].done);
		try {
			const results = await Promise.all(
				want.map((k) => sources[k].fetch(sources[k].cursor).then((res) => ({ k, res }))),
			);
			// Interleave across sources so "All" reads as a varied hall, not three blocks.
			const lanes = results.map(({ k, res }) => {
				sources[k].cursor = res.next;
				if (!res.next) sources[k].done = true;
				return res.items;
			});
			const merged = interleave(lanes);
			if (merged.length) {
				loadedAny = true;
				buffer.push(...merged);
				served.push(...merged);
			}
			loadError = false;
			hideToast();
		} catch {
			loadError = true;
			showToast(`Couldn't load listings`, 'Retry', () => {
				loadError = false;
				loadPage().then(fillEmptySlots);
			});
		} finally {
			loading = false;
		}
	}

	function nextListing() {
		if (buffer.length) return buffer.shift();
		// Pages exhausted but we have a catalogue → loop it so the hall never ends.
		if (allDone() && served.length) {
			buffer = served.slice();
			return buffer.shift();
		}
		return null;
	}

	function fillEmptySlots() {
		for (const slot of slots) {
			if (slot.listing) continue;
			const listing = nextListing();
			if (!listing) break;
			assignListing(slot, listing);
		}
		maybeShowEmpty();
	}

	// ── Treadmill + recycling ───────────────────────────────────────────────────
	let anchored = false;

	function recycleAndFill() {
		// A plinth that has slid behind the player leaps to the front of the hall.
		let minLocalZ = Infinity;
		for (const s of slots) minLocalZ = Math.min(minLocalZ, s.group.position.z);
		for (const slot of slots) {
			const worldZ = slot.group.position.z + belt.position.z;
			if (worldZ > ANCHOR_Z + RECYCLE_BEHIND) {
				slot.group.position.z = minLocalZ - SPACING;
				minLocalZ = slot.group.position.z;
				const listing = nextListing();
				if (listing) assignListing(slot, listing);
				else {
					slot.listing = null;
					slot.group.visible = false;
				}
			}
		}
	}

	let activeSlot = null;
	let navigating = false;

	function pickNearest(px, pz) {
		let best = null;
		let bestD = Infinity;
		for (const slot of slots) {
			if (!slot.listing || !slot.group.visible) continue;
			const dx = slot.group.position.x - px;
			const dz = slot.group.position.z + belt.position.z - pz;
			const d = Math.hypot(dx, dz);
			if (d < bestD) {
				bestD = d;
				best = slot;
			}
		}
		return { best, bestD };
	}

	let ringPulse = 0;

	function update(dt) {
		const pos = getLocalPosition?.();
		if (!pos) return;

		if (!anchored) {
			pos.z = ANCHOR_Z;
			anchored = true;
		}
		// Transfer the avatar's forward travel into the belt, then re-anchor it so
		// the engine's ground-disc clamp is never reached. Net effect: the player
		// walks forever while standing still in world space.
		const dz = pos.z - ANCHOR_Z;
		if (dz !== 0) {
			belt.position.z -= dz;
			pos.z = ANCHOR_Z;
		}
		// Keep the player on the carpet.
		if (pos.x < -LATERAL_LIMIT) pos.x = -LATERAL_LIMIT;
		else if (pos.x > LATERAL_LIMIT) pos.x = LATERAL_LIMIT;

		// Fold large offsets back toward zero to keep float precision crisp on a
		// very long stroll (shift belt + every plinth together — no visible jump).
		if (belt.position.z > REBASE_AT) {
			const k = belt.position.z;
			belt.position.z = 0;
			for (const s of slots) s.group.position.z += k;
		}

		// Stream the next page well before the hall runs dry (≈ a screen ahead).
		if (!loading && !loadError && !allDone() && buffer.length < SLOT_COUNT) {
			loadPage().then(fillEmptySlots);
		}

		fillEmptySlots();
		recycleAndFill();

		// Proximity — reveal the nearest listing within reach, with hysteresis.
		const { best, bestD } = pickNearest(pos.x, ANCHOR_Z);
		if (activeSlot) {
			const ax = activeSlot.group.position.x - pos.x;
			const az = activeSlot.group.position.z + belt.position.z - ANCHOR_Z;
			const ad = Math.hypot(ax, az);
			if (!activeSlot.listing || ad > RELEASE_RANGE) {
				setActive(best && bestD <= ENTER_RANGE ? best : null);
			} else if (best && best !== activeSlot && bestD <= ENTER_RANGE && bestD < ad - 0.6) {
				setActive(best);
			}
		} else if (best && bestD <= ENTER_RANGE) {
			setActive(best);
		}

		// Gentle ring pulse + lift on the active plinth.
		ringPulse += dt;
		for (const slot of slots) {
			const target = slot === activeSlot ? 1 : 0;
			const cur = slot.group.scale.x;
			const next = MathUtils.lerp(cur, 1 + target * 0.06, 0.18);
			slot.group.scale.setScalar(next);
			if (slot.ring.visible) {
				slot.ring.material.opacity = 0.55 + Math.sin(ringPulse * 3) * 0.35;
			}
		}
	}

	function setActive(slot) {
		if (slot === activeSlot) return;
		if (activeSlot) {
			activeSlot.ring.visible = false;
		}
		activeSlot = slot;
		if (slot) {
			slot.ring.visible = true;
			showPanel(slot.listing);
		} else {
			hidePanel();
		}
	}

	function navigateActive() {
		if (!activeSlot?.listing || navigating) return;
		navigating = true;
		location.href = activeSlot.listing.href;
	}

	// ── DOM: search + chips (top bar), panel, prompt, toast ──────────────────────
	const top = document.createElement('div');
	top.className = 'mwg-top';

	// Search field — jump straight to a named skill/agent/avatar instead of
	// walking the whole hall. Debounced; each source filters server-side on ?q.
	const search = document.createElement('div');
	search.className = 'mwg-search';
	search.innerHTML = `
		<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5l3 3"/></svg>
		<input type="search" enterkeyhint="search" autocomplete="off" autocapitalize="off"
			spellcheck="false" maxlength="80" aria-label="Search the marketplace"
			placeholder="Search agents, avatars, skills…" />
		<button type="button" class="mwg-search-clear" aria-label="Clear search" title="Clear">&times;</button>`;
	const searchInput = search.querySelector('input');
	const searchClear = search.querySelector('.mwg-search-clear');
	searchInput.value = query;
	if (query) search.setAttribute('data-has-query', '1');
	let searchTimer = 0;
	function flushSearch() {
		clearTimeout(searchTimer);
		applyQuery(searchInput.value);
	}
	searchInput.addEventListener('input', () => {
		search.toggleAttribute('data-has-query', !!searchInput.value.trim());
		clearTimeout(searchTimer);
		searchTimer = setTimeout(flushSearch, 300);
	});
	searchInput.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') {
			e.preventDefault();
			flushSearch();
		} else if (e.key === 'Escape' && searchInput.value) {
			e.preventDefault();
			searchInput.value = '';
			search.removeAttribute('data-has-query');
			flushSearch();
		}
	});
	searchClear.addEventListener('click', () => {
		searchInput.value = '';
		search.removeAttribute('data-has-query');
		flushSearch();
		searchInput.focus();
	});

	const chips = document.createElement('div');
	chips.className = 'mwg-chips';
	chips.setAttribute('role', 'tablist');
	chips.setAttribute('aria-label', 'Filter gallery listings');
	for (const f of FILTERS) {
		const b = document.createElement('button');
		b.className = 'mwg-chip';
		b.type = 'button';
		b.textContent = f.label;
		b.dataset.filter = f.key;
		b.setAttribute('role', 'tab');
		b.setAttribute('aria-pressed', String(f.key === filter));
		b.addEventListener('click', () => setFilter(f.key));
		chips.appendChild(b);
	}
	// Roving arrow-key navigation across the filter tablist (auto-activates).
	chips.addEventListener('keydown', (e) => {
		if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
		const btns = [...chips.children];
		const i = btns.indexOf(document.activeElement);
		if (i === -1) return;
		e.preventDefault();
		const ni = (i + (e.key === 'ArrowRight' ? 1 : -1) + btns.length) % btns.length;
		btns[ni].focus();
		setFilter(btns[ni].dataset.filter);
	});

	top.appendChild(search);
	top.appendChild(chips);
	document.body.appendChild(top);

	const panel = document.createElement('aside');
	panel.className = 'mwg-panel';
	panel.setAttribute('aria-live', 'polite');
	document.body.appendChild(panel);

	const prompt = document.createElement('button');
	prompt.className = 'mwg-prompt';
	prompt.type = 'button';
	prompt.innerHTML = `<kbd>E</kbd><span class="mwg-prompt-text">Open listing</span>`;
	prompt.addEventListener('click', navigateActive);
	document.body.appendChild(prompt);

	const toast = document.createElement('div');
	toast.className = 'mwg-toast';
	toast.setAttribute('role', 'status');
	document.body.appendChild(toast);

	function showToast(message, actionLabel, onAction) {
		toast.innerHTML = '';
		const span = document.createElement('span');
		span.textContent = message;
		toast.appendChild(span);
		if (actionLabel) {
			const btn = document.createElement('button');
			btn.type = 'button';
			btn.textContent = actionLabel;
			btn.addEventListener('click', onAction);
			toast.appendChild(btn);
		}
		toast.setAttribute('data-show', '1');
	}
	function hideToast() {
		toast.removeAttribute('data-show');
	}

	function maybeShowEmpty() {
		if (loadedAny || loading || !allDone()) return;
		const label = FILTERS.find((f) => f.key === filter)?.label || 'listings';
		if (query) {
			showToast(`No ${label.toLowerCase()} match “${query}”.`, 'Clear search', () => {
				searchInput.value = '';
				search.removeAttribute('data-has-query');
				flushSearch();
				searchInput.focus();
			});
			return;
		}
		showToast(`No ${label.toLowerCase()} listed yet.`, 'Browse the grid →', () => {
			location.href = '/marketplace';
		});
	}

	function panelFallbackHTML(listing, accent) {
		return `<div class="mwg-panel-fallback" style="background:linear-gradient(160deg,${accent},#0c0c0e)">${escapeHtml((listing.name || '?').charAt(0).toUpperCase())}</div>`;
	}

	function showPanel(listing) {
		const accent = TYPE_ACCENT[listing.type] || '#fafafa';
		const media = listing.image
			? `<img src="${escapeAttr(listing.image)}" alt="" loading="lazy" />`
			: panelFallbackHTML(listing, accent);

		// Trust signals — ratings + adoption counts pulled straight from the same
		// listing rows the grid uses, so a number never disagrees across surfaces.
		const stats = [];
		if (listing.rating) {
			const votes = fmtCount(listing.rating.count) || String(listing.rating.count);
			stats.push(
				`<span class="mwg-panel-stat"><span class="star">★</span><b>${listing.rating.avg}</b> <span>(${votes})</span></span>`,
			);
		}
		if (listing.uses) {
			const c = fmtCount(listing.uses.count);
			if (c)
				stats.push(
					`<span class="mwg-panel-stat"><b>${c}</b> ${escapeHtml(listing.uses.label)}</span>`,
				);
		}
		const statsRow = stats.length ? `<div class="mwg-panel-stats">${stats.join('')}</div>` : '';

		const tagsRow = listing.tags?.length
			? `<div class="mwg-panel-tags">${listing.tags
					.slice(0, 3)
					.map((t) => `<span class="mwg-panel-tag">${escapeHtml(t)}</span>`)
					.join('')}</div>`
			: '';

		const featuredBadge = listing.featured
			? `<span class="mwg-panel-badge" style="background:${accent};left:auto;right:12px">Featured</span>`
			: '';

		panel.innerHTML = `
			<div class="mwg-panel-media">
				${media}
				<span class="mwg-panel-badge" style="background:${accent}">${TYPE_LABEL[listing.type] || ''}</span>
				${featuredBadge}
			</div>
			<div class="mwg-panel-body">
				<h2 class="mwg-panel-title">${escapeHtml(listing.name)}</h2>
				${listing.author ? `<p class="mwg-panel-author">by ${escapeHtml(listing.author)}</p>` : ''}
				${statsRow}
				${listing.description ? `<p class="mwg-panel-desc">${escapeHtml(listing.description)}</p>` : ''}
				${tagsRow}
				<div class="mwg-panel-meta">
					<span class="mwg-panel-price" style="color:${accent}">${escapeHtml(listing.price)}</span>
					${listing.category ? `<span class="mwg-panel-cat">${escapeHtml(listing.category)}</span>` : ''}
				</div>
				<div class="mwg-panel-actions">
					<a class="mwg-panel-cta" href="${escapeAttr(listing.href)}">View listing →</a>
					<button class="mwg-panel-share" type="button" aria-label="Copy link to this listing" title="Copy link">
						<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 9.5l3-3"/><path d="M7.2 4.3l.9-.9a2.4 2.4 0 0 1 3.4 3.4l-.9.9"/><path d="M8.8 11.7l-.9.9a2.4 2.4 0 0 1-3.4-3.4l.9-.9"/></svg>
					</button>
				</div>
				<p class="mwg-panel-hint">Press <kbd>E</kbd> to open</p>
			</div>`;

		// An R2 asset can 403/502 behind a URL that still looked valid when the
		// listing loaded. A broken <img> would otherwise sit there as the
		// browser's own broken-image glyph; swap in the same designed fallback
		// the no-image case uses instead.
		const panelImg = panel.querySelector('.mwg-panel-media img');
		panelImg?.addEventListener(
			'error',
			() => {
				panelImg.outerHTML = panelFallbackHTML(listing, accent);
			},
			{ once: true },
		);

		// Plain left-click routes through the shared nav guard; modified clicks
		// (⌘/ctrl/middle → new tab) fall through to the native anchor.
		panel.querySelector('.mwg-panel-cta')?.addEventListener('click', (e) => {
			if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
			e.preventDefault();
			navigateActive();
		});
		panel
			.querySelector('.mwg-panel-share')
			?.addEventListener('click', (e) => shareListing(e.currentTarget, listing));
		panel.setAttribute('data-show', '1');
		prompt.querySelector('.mwg-prompt-text').textContent = listing.name;
		prompt.setAttribute('data-show', '1');
	}

	let shareResetTimer = 0;
	async function shareListing(btn, listing) {
		const url = new URL(listing.href, location.origin).href;
		try {
			if (navigator.clipboard?.writeText) {
				await navigator.clipboard.writeText(url);
			} else {
				const ta = document.createElement('textarea');
				ta.value = url;
				ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
				document.body.appendChild(ta);
				ta.select();
				document.execCommand('copy');
				ta.remove();
			}
			btn.setAttribute('data-copied', '1');
			btn.setAttribute('title', 'Link copied');
			clearTimeout(shareResetTimer);
			shareResetTimer = setTimeout(() => {
				btn.removeAttribute('data-copied');
				btn.setAttribute('title', 'Copy link');
			}, 1600);
		} catch {
			showToast('Copy failed — long-press the link to copy it.');
		}
	}

	function hidePanel() {
		panel.removeAttribute('data-show');
		prompt.removeAttribute('data-show');
	}

	// Tear the stream + hall back to a clean slate so a new filter or query
	// rebuilds the catalogue from the avatar's live position.
	function resetStream() {
		buffer = [];
		served = [];
		loadedAny = false;
		loadError = false;
		for (const k of Object.keys(sources)) {
			sources[k].cursor = null;
			sources[k].done = false;
		}
		setActive(null);
		for (let i = 0; i < slots.length; i++) {
			slots[i].listing = null;
			slots[i].group.visible = false;
			slots[i].group.position.z = -(START_Z + i * SPACING);
			slots[i].group.scale.setScalar(1);
		}
		belt.position.z = 0;
		hideToast();
	}

	// Reflect the current filter + query back into the address bar so the hall is
	// always shareable/bookmarkable at exactly what's on screen. Default state
	// (All, no query) keeps the URL clean.
	function syncUrl() {
		try {
			const u = new URL(location.href);
			if (filter && filter !== 'all') u.searchParams.set('type', filter);
			else u.searchParams.delete('type');
			u.searchParams.delete('filter');
			if (query) u.searchParams.set('q', query);
			else u.searchParams.delete('q');
			history.replaceState(null, '', u.pathname + u.search + u.hash);
		} catch {
			/* replaceState can throw in sandboxed frames — non-fatal */
		}
	}

	async function setFilter(next) {
		if (next === filter) return;
		filter = next;
		for (const b of chips.children)
			b.setAttribute('aria-pressed', String(b.dataset.filter === filter));
		syncUrl();
		resetStream();
		await loadPage();
		fillEmptySlots();
	}

	async function applyQuery(next) {
		const v = (next || '').trim().slice(0, 80);
		if (v === query) return;
		query = v;
		syncUrl();
		resetStream();
		await loadPage();
		fillEmptySlots();
	}

	// ── Key intercept — E opens the active listing (capture phase so it wins over
	//    the engine's snap-turn binding, but only while a listing is in reach). ──
	function onKeyDown(e) {
		if (!activeSlot) return;
		if (e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA') return;
		if (e.code === 'KeyE' || e.code === 'Enter') {
			e.preventDefault();
			e.stopImmediatePropagation();
			navigateActive();
		}
	}
	window.addEventListener('keydown', onKeyDown, true);

	// ── Boot ────────────────────────────────────────────────────────────────────
	syncUrl(); // canonicalise a deep-linked URL (?type=skills → ?type=skill, etc.)
	for (let i = 0; i < SLOT_COUNT; i++) slots.push(buildSlot(i));
	loadPage().then(fillEmptySlots);

	return {
		update,
		destroy() {
			window.removeEventListener('keydown', onKeyDown, true);
			clearTimeout(searchTimer);
			clearTimeout(shareResetTimer);
			top.remove();
			panel.remove();
			prompt.remove();
			toast.remove();
			scene.remove(belt);
			scene.remove(hall);
		},
	};
}

function escapeHtml(s) {
	return String(s ?? '').replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
	);
}
function escapeAttr(s) {
	return escapeHtml(s);
}
