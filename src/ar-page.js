/**
 * /avatars/:id/ar and /agents/:id/ar: the dedicated AR experience page
 *
 * Fetches the entity (an avatar directly, or an agent's bound body), loads it
 * into a full-screen model-viewer with AR enabled.
 * If the avatar has a pre-generated usdz_url, sets it as ios-src immediately.
 * Otherwise converts the GLB to USDZ in-browser and sets a temporary object URL
 * so Quick Look works in the current session.
 */

import { glbBlobToUsdzBlob } from './usdz-pipeline.js';
import { glbBlobToAnimatedUsdzBlob, DEFAULT_AR_ANIMATION } from './usdz-animated.js';
import { log } from './shared/log.js';
import { mountViewSwitcher } from './view-switcher.js';

const segments = location.pathname.split('/').filter(Boolean);
// /avatars/:id/ar → ['avatars', 'uuid', 'ar']; /agents/:id/ar → ['agents', ...]
const isAgentRoute = segments[0] === 'agents' && segments[2] === 'ar';
const fromPath =
	(segments[0] === 'avatars' || isAgentRoute) && segments[2] === 'ar' ? segments[1] : null;
const params = new URLSearchParams(location.search);
const fromQuery = params.get('id');
const mode = isAgentRoute || params.get('kind') === 'agent' ? 'agent' : 'avatar';
const entityId = fromPath || fromQuery || '';
// The body's id. Equal to entityId for an avatar, resolved from the agent's
// avatar_id otherwise. Every /api/avatars call keys off this.
let avatarId = mode === 'avatar' ? entityId : '';

const $ = (id) => document.getElementById(id);

let usdzObjectUrl = null;

async function init() {
	if (!entityId) {
		showError(
			`This link does not name a${mode === 'agent' ? 'n agent' : 'n avatar'} to show, so there is nothing to place in your room.`,
			mode === 'agent'
				? { browseHref: '/agents', browseLabel: 'Browse agents' }
				: {},
		);
		return;
	}

	if (mode === 'agent') {
		const agent = await fetchAgent(entityId);
		if (!agent) return;
		if (!agent.avatar_id) {
			showError(
				`${agent.name || 'This agent'} has no 3D body yet, so there is nothing to place in your room. Give it one in the studio, then come back.`,
				{ browseHref: '/create', browseLabel: 'Create a body' },
			);
			return;
		}
		avatarId = agent.avatar_id;
	}

	const avatar = await fetchAvatar(avatarId);
	if (!avatar) return;

	const glbUrl = avatar.model_url || avatar.url;
	if (!glbUrl) {
		showError(
			'This avatar has no 3D model attached yet, so there is nothing to place in your room.',
		);
		return;
	}

	renderPage(avatar, glbUrl);

	if (avatar.usdz_url) {
		applyUsdzSrc(avatar.usdz_url);
		setArReady();
	} else {
		// Auto-generate USDZ so AR works in this session
		generateUsdz(glbUrl);
	}
}

async function fetchAvatar(id) {
	try {
		const r = await fetch(`/api/avatars/${encodeURIComponent(id)}`);
		if (!r.ok) throw new Error(`${r.status}`);
		return (await r.json()).avatar;
	} catch (err) {
		showError(`We could not load this avatar (${err.message}).`, { retry: true });
		return null;
	}
}

async function fetchAgent(id) {
	try {
		const r = await fetch(`/api/agents/${encodeURIComponent(id)}`, { credentials: 'include' });
		if (!r.ok) throw new Error(`${r.status}`);
		return (await r.json()).agent;
	} catch (err) {
		showError(`We could not load this agent (${err.message}).`, {
			retry: true,
			browseHref: '/agents',
			browseLabel: 'Browse agents',
		});
		return null;
	}
}

function renderPage(avatar, glbUrl) {
	$('ar-avatar-name').textContent = avatar.name || 'Avatar';
	document.title = `${avatar.name || 'Avatar'} in AR · three.ws`;

	if (avatar.thumbnail_url) {
		document.querySelector('meta[name="og:image"]')?.setAttribute('content', avatar.thumbnail_url);
	}

	const viewer = $('ar-viewer');
	viewer.setAttribute('src', glbUrl);
	viewer.setAttribute('alt', avatar.name || 'three.ws avatar');

	if (avatar.usdz_url) {
		viewer.setAttribute('ios-src', avatar.usdz_url);
	}

	const id = avatar.id || avatarId;
	// Back goes to whichever studio page the visitor came from (the agent's or
	// the body's), so the AR detour never strands them on the wrong entity.
	$('ar-back-link').href =
		mode === 'agent'
			? `/agents/${encodeURIComponent(entityId)}`
			: `/avatars/${encodeURIComponent(id)}`;
	// Living-agent handoff: /irl loads this avatar as the agent's body in the
	// user's real space (camera passthrough, animation, conversation). Static
	// placement is one option; alive is the point.
	const liveLink = $('ar-live-link');
	if (liveLink) {
		liveLink.href = `/irl?avatar=${encodeURIComponent(id)}`;
		liveLink.hidden = false;
	}
	mountViewSwitcher($('view-switch-slot'), {
		kind: mode,
		id: mode === 'agent' ? entityId : id,
		active: 'ar',
		hasBody: true,
	});

	$('ar-share-btn').addEventListener('click', () => shareAvatar(avatar));
}

function applyUsdzSrc(src) {
	$('ar-viewer').setAttribute('ios-src', src);
}

function setArReady() {
	$('ar-status').hidden = true;
	$('ar-launch-btn').disabled = false;
	$('ar-launch-btn').removeAttribute('aria-busy');
}

function setStatus(msg) {
	const el = $('ar-status');
	const txt = $('ar-status-text');
	if (!msg) { el.hidden = true; return; }
	txt.textContent = msg;
	el.hidden = false;
}

// Prefer a living, animated avatar in AR; fall back to the proven static bake
// if the avatar can't be animated (no rig, clip won't retarget, fetch fails).
// Either way the user gets a correct avatar — animation is upside, never a gate.
async function buildArUsdz(glbBlob) {
	try {
		setStatus('Bringing your avatar to life…');
		const animResp = await fetch(DEFAULT_AR_ANIMATION);
		if (!animResp.ok) throw new Error(`animation fetch ${animResp.status}`);
		const animationGlbBlob = await animResp.blob();
		return await glbBlobToAnimatedUsdzBlob(glbBlob, { animationGlbBlob });
	} catch (err) {
		log.warn('[ar-page] animated USDZ unavailable, using static:', err?.message);
		setStatus('Generating AR preview…');
		return glbBlobToUsdzBlob(glbBlob);
	}
}

async function generateUsdz(glbUrl) {
	const btn = $('ar-launch-btn');
	setStatus('Preparing AR preview…');
	btn.disabled = true;
	btn.setAttribute('aria-busy', 'true');

	try {
		setStatus('Downloading model…');
		const r = await fetch(glbUrl);
		if (!r.ok) throw new Error(`GLB fetch ${r.status}`);
		const glbBlob = await r.blob();

		const usdzBlob = await buildArUsdz(glbBlob);

		if (usdzObjectUrl) URL.revokeObjectURL(usdzObjectUrl);
		usdzObjectUrl = URL.createObjectURL(usdzBlob);
		applyUsdzSrc(usdzObjectUrl);

		setArReady();
		setStatus('AR preview ready');
		setTimeout(() => setStatus(null), 2000);
	} catch (err) {
		$('ar-status').classList.add('is-error');
		setStatus(`Couldn't generate AR preview: ${err.message}`);
		btn.disabled = false;
		btn.removeAttribute('aria-busy');
	}
}

/**
 * Replace the whole shell with a designed error state.
 *
 * This is the only thing a visitor sees when a link is stale, an agent has no
 * body yet, or a fetch fails, and until now it was one unstyled line of text
 * against a black page with nowhere to go. Every message therefore ships with
 * a way out: a browse link that is always correct, plus a retry when the
 * failure could be transient (a network hiccup, a cold API) rather than a
 * statement about this particular avatar.
 *
 * @param {string} msg     What went wrong, in plain language.
 * @param {{ retry?: boolean, browseHref?: string, browseLabel?: string }} [opts]
 */
function showError(msg, opts = {}) {
	const shell = $('ar-shell');
	if (!shell) return;
	const { retry = false, browseHref = '/avatars', browseLabel = 'Browse avatars' } = opts;
	const panel = document.createElement('div');
	panel.className = 'ar-error';
	panel.setAttribute('role', 'alert');

	const title = document.createElement('h2');
	title.className = 'ar-error__title';
	title.textContent = 'This avatar cannot open in AR';
	const body = document.createElement('p');
	body.className = 'ar-error__body';
	body.textContent = msg;
	const actions = document.createElement('div');
	actions.className = 'ar-error__actions';

	if (retry) {
		const again = document.createElement('button');
		again.type = 'button';
		again.className = 'ar-error__btn ar-error__btn--primary';
		again.textContent = 'Try again';
		again.addEventListener('click', () => location.reload());
		actions.append(again);
	}
	const browse = document.createElement('a');
	browse.className = retry ? 'ar-error__btn' : 'ar-error__btn ar-error__btn--primary';
	browse.href = browseHref;
	browse.textContent = browseLabel;
	actions.append(browse);

	panel.append(title, body, actions);
	shell.replaceChildren(panel);
	// Move focus to the alert so a screen reader and a keyboard user both land
	// on the recovery path instead of at the top of a page that no longer exists.
	panel.tabIndex = -1;
	panel.focus();
}

async function shareAvatar(avatar) {
	const url = location.href;
	const title = `${avatar.name || 'Avatar'} in AR · three.ws`;
	if (navigator.share) {
		try {
			await navigator.share({ title, url });
			return;
		} catch {
			// fall through to clipboard
		}
	}
	try {
		await navigator.clipboard.writeText(url);
		const btn = $('ar-share-btn');
		const orig = btn.textContent;
		btn.textContent = 'Copied!';
		setTimeout(() => { btn.textContent = orig; }, 1800);
	} catch {
		// nothing to do
	}
}

// Tell the user how to actually get into AR when this device can't. Desktop
// browsers and embedded webviews report canActivateAR === false; calling
// activateAR() there just logs model-viewer's "No AR Mode can be activated"
// warning and does nothing visible. A copy-link CTA gets them onto a phone,
// where WebXR / Scene Viewer / Quick Look take over.
async function offerArOnPhone() {
	const statusEl = $('ar-status');
	statusEl.classList.remove('is-error');
	try {
		await navigator.clipboard.writeText(location.href);
		setStatus('AR needs a phone — link copied. Open it on your iPhone or Android.');
	} catch {
		setStatus('AR needs a phone — open this page on your iPhone or Android device.');
	}
	setTimeout(() => setStatus(null), 6000);
}

// Wire the "Place in your space" button to model-viewer's activateAR()
document.addEventListener('DOMContentLoaded', () => {
	$('ar-launch-btn').addEventListener('click', () => {
		const viewer = $('ar-viewer');
		// canActivateAR is true only when the device exposes a usable AR mode.
		if (viewer?.canActivateAR) {
			viewer.activateAR();
		} else {
			offerArOnPhone();
		}
	});

	init().catch((err) => {
		log.error('[ar-page] init error', err);
		showError('Something went wrong loading this avatar.', { retry: true });
	});

	window.addEventListener('beforeunload', () => {
		if (usdzObjectUrl) URL.revokeObjectURL(usdzObjectUrl);
	});
});
