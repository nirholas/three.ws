/**
 * /avatars/:id/ar and /agents/:id/ar: the dedicated AR experience page
 *
 * Fetches the entity (an avatar directly, or an agent's bound body) and loads
 * it into a full-screen <agent-3d ar>. The element owns AR end to end: it
 * uses the avatar's pre-generated usdz_url (ios-src) when present, otherwise
 * generates one in-browser on demand, and reports progress via the
 * agent:ar-status / agent:ar-ready events wired in renderPage() below.
 */

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
	setStatus('Preparing AR preview…');
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

	// <agent-3d ar> owns USDZ generation (on-device, animated-first with a
	// static fallback) and AR-mode detection; it reports progress through
	// these events instead of us driving the pipeline by hand.
	viewer.addEventListener('agent:ar-status', (e) => setStatus(e.detail?.message));
	viewer.addEventListener('agent:ar-ready', () => {
		setArReady();
		setStatus('AR preview ready');
		setTimeout(() => setStatus(null), 2000);
	});
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
	const { retry = false, browseHref = '/gallery', browseLabel = 'Browse avatars' } = opts;
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
});
