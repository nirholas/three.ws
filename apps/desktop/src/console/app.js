// The console renderer's entry: boot, the sign-in gate, the router, and the
// pieces every view shares (agent store, toasts, markdown, badges).

import { marked } from '../../node_modules/marked/lib/marked.esm.js';
import DOMPurify from '../../node_modules/dompurify/dist/purify.es.mjs';
import { html, mount, avatar } from './lib/dom.js';
import { createAgentStore } from './lib/agents-store.js';
import { mountSignIn } from './views/signin.js';
import { mountAgents } from './views/agents.js';
import { mountChat } from './views/chat.js';
import { mountRuns } from './views/runs.js';
import { mountWallet } from './views/wallet.js';
import { mountNotifications } from './views/notifications.js';
import { mountEditors } from './views/editors.js';
import { mountSettings } from './views/settings.js';

const bridge = window.threews;
const VIEWS = {
	agents: mountAgents,
	chat: mountChat,
	runs: mountRuns,
	wallet: mountWallet,
	notifications: mountNotifications,
	editors: mountEditors,
	settings: mountSettings,
};
const ORDER = Object.keys(VIEWS);

const $ = (id) => document.getElementById(id);
const els = { boot: $('boot'), signin: $('signin'), app: $('app'), view: $('view'), nav: $('nav'), account: $('account'), unread: $('unread'), toasts: $('toasts'), updatePill: $('update-pill') };

if (navigator.userAgent.includes('Macintosh')) document.body.classList.add('mac');

marked.setOptions({ gfm: true, breaks: true });
function markdown(text) {
	return DOMPurify.sanitize(marked.parse(String(text || '')), { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'form', 'input', 'img'] });
}

function toast(message, kind = '') {
	const el = document.createElement('div');
	el.className = `toast ${kind}`;
	el.textContent = message;
	els.toasts.append(el);
	setTimeout(() => {
		el.classList.add('out');
		el.addEventListener('transitionend', () => el.remove(), { once: true });
	}, kind === 'bad' ? 6000 : 3500);
}

const agents = createAgentStore(bridge);
let session = null;
let current = { view: null, cleanup: null };

const ctx = {
	bridge,
	agents,
	markdown,
	toast,
	navigate,
	session: () => session,
	// Views that start a flow in another view (chat proposing a send) leave
	// their hand-off here; the receiving view consumes it once.
	handoff: null,
};

function parseHash() {
	const [view, query = ''] = location.hash.replace(/^#/, '').split('?');
	return { view: VIEWS[view] ? view : 'agents', params: Object.fromEntries(new URLSearchParams(query)) };
}

function navigate(view, params = {}) {
	const qs = new URLSearchParams(params).toString();
	const target = `#${view}${qs ? `?${qs}` : ''}`;
	if (location.hash === target) route();
	else location.hash = target;
}

function route() {
	if (!session?.signedIn) return;
	const { view, params } = parseHash();
	current.cleanup?.();
	for (const a of els.nav.querySelectorAll('.nav-item')) {
		if (a.dataset.view === view) a.setAttribute('aria-current', 'page');
		else a.removeAttribute('aria-current');
	}
	const root = document.createElement('div');
	els.view.replaceChildren(root);
	els.view.scrollTop = 0;
	current = { view, cleanup: VIEWS[view](root, ctx, params) || null };
}

function renderAccount() {
	const u = session?.user;
	const host = session?.apiBase ? new URL(session.apiBase).host : 'three.ws';
	mount(els.account, html`${avatar({ id: u?.id, name: u?.name, thumbnail: u?.avatarUrl }, 32)}<span class="who"><b>${u?.name || 'Your account'}</b><span>${u?.username ? `@${u.username}` : host}</span></span>`);
}

function setUnread(count) {
	els.unread.hidden = !count;
	els.unread.textContent = count > 99 ? '99+' : String(count);
}

function renderUpdate(state) {
	const ready = state?.status === 'ready';
	els.updatePill.hidden = !ready;
	if (ready) mount(els.updatePill, html`<b>Update ready</b><br />Restart to install ${state.available || ''}`);
}

function showSignedIn() {
	els.signin.hidden = true;
	els.app.hidden = false;
	renderAccount();
	route();
}

let signInCleanup = null;
function showSignedOut() {
	current.cleanup?.();
	current = { view: null, cleanup: null };
	agents.reset();
	els.app.hidden = true;
	els.signin.hidden = false;
	signInCleanup?.();
	signInCleanup = mountSignIn(els.signin, ctx);
}

function applySession(next) {
	const was = session?.signedIn;
	session = next;
	els.boot.hidden = true;
	if (session.signedIn) {
		signInCleanup?.();
		signInCleanup = null;
		if (!was || els.app.hidden) showSignedIn();
		else renderAccount();
	} else if (was !== false) {
		showSignedOut();
	}
}

// Cmd/Ctrl + 1..7 jumps between views, in sidebar order.
document.addEventListener('keydown', (event) => {
	if (!session?.signedIn) return;
	const mod = event.metaKey || event.ctrlKey;
	if (mod && /^[1-7]$/.test(event.key)) {
		event.preventDefault();
		navigate(ORDER[Number(event.key) - 1]);
	}
});

els.account.addEventListener('click', () => navigate('settings'));
els.updatePill.addEventListener('click', () => bridge.app.installUpdate().catch((err) => toast(err.message, 'bad')));
window.addEventListener('hashchange', route);

// Links rendered in agent replies or notifications open in the browser.
document.addEventListener('click', (event) => {
	const a = event.target.closest('a[href]');
	if (!a) return;
	const href = a.getAttribute('href');
	if (href.startsWith('#')) return;
	event.preventDefault();
	bridge.app.openExternal(href).then((ok) => {
		if (!ok) toast('That link was blocked because it is not a web address.', 'bad');
	});
});

bridge.session.onChange(applySession);
bridge.notifications.onUnread(setUnread);
bridge.app.onNavigate((view) => navigate(view));
bridge.app.onUpdate(renderUpdate);

bridge.session.status().then(applySession).catch((err) => {
	els.boot.hidden = true;
	toast(err.message, 'bad');
});
bridge.app.info().then((info) => renderUpdate(info.update)).catch(() => {});
