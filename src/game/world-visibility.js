// world-visibility: the "Who can see this world" dialog (Silver `worlds.private`).
//
// Opened from the Build HUD. It shows the world's current visibility, lets the
// owner flip it Public / Private, and manages the invite list for a private
// world. The server is the only authority: the owner check, the Silver hold and
// the invitee cap are all enforced there, and this dialog only renders what the
// server answers (a 402 hands off to the shared $THREE upsell, a 403 explains
// that only the owner can change it).
//
// A non-holder still sees the Private choice, locked, with the live tier
// requirement read from /api/three/access (never hardcoded) and a link to /three.

import { changeWorldAccess } from './world-persist.js';
import { getAccess, getTierPass, attachTierPass, onGate } from '../three-access.js';

const STYLE_ID = 'cc-wv-styles';

function el(tag, props = {}, kids = []) {
	const n = document.createElement(tag);
	for (const [k, v] of Object.entries(props)) {
		if (k === 'class') n.className = v;
		else if (k === 'text') n.textContent = v;
		else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
		else if (v != null && v !== false) n.setAttribute(k, v === true ? '' : v);
	}
	for (const kid of [].concat(kids)) if (kid != null) n.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
	return n;
}

let open = null;

/**
 * Open the visibility dialog for a world store.
 * @param {object} opts
 * @param {import('./world-persist.js').WorldBuildStore} opts.store
 * @param {(msg:string, kind?:string)=>void} [opts.toast]
 * @param {typeof fetch} [opts.fetchImpl]
 * @returns {{ close:()=>void, root:HTMLElement }}
 */
export function openWorldVisibility({ store, toast, fetchImpl } = {}) {
	if (open) open.close();
	const returnFocus = document.activeElement;

	let visibility = store.visibility === 'private' ? 'private' : 'public';
	let invitees = Array.isArray(store.invitees) ? store.invitees.slice() : [];
	let access = null; // single-feature access payload, null while resolving
	let busy = false;

	const status = el('p', { class: 'cc-wv-status', role: 'status', 'aria-live': 'polite' });
	const setStatus = (msg, kind = '') => {
		status.textContent = msg || '';
		status.dataset.kind = kind;
	};

	const publicBtn = el('button', { type: 'button', class: 'cc-wv-opt', role: 'radio', onclick: () => choose('public') }, [
		el('strong', { text: 'Public' }),
		el('span', { text: 'Anyone with the link can see this world.' }),
	]);
	const privateBtn = el('button', { type: 'button', class: 'cc-wv-opt', role: 'radio', onclick: () => choose('private') }, [
		el('strong', { class: 'cc-wv-opt-title' }),
		el('span', { class: 'cc-wv-opt-desc' }),
	]);
	const options = el('div', { class: 'cc-wv-options', role: 'radiogroup', 'aria-label': 'Who can see this world' }, [publicBtn, privateBtn]);

	const upsell = el('p', { class: 'cc-wv-upsell', hidden: true });
	const input = el('input', {
		class: 'cc-wv-input', type: 'text', placeholder: 'Username', autocomplete: 'off', spellcheck: 'false',
		maxlength: '64', 'aria-label': 'Username to invite',
	});
	const addBtn = el('button', { type: 'submit', class: 'cc-wv-btn', text: 'Invite' });
	const form = el('form', { class: 'cc-wv-invite', onsubmit: (e) => { e.preventDefault(); invite(); } }, [input, addBtn]);
	const list = el('ul', { class: 'cc-wv-list', 'aria-label': 'Invited accounts' });
	const invitePane = el('section', { class: 'cc-wv-pane', hidden: true }, [
		el('h3', { text: 'Invited' }),
		form,
		list,
	]);
	const skeleton = el('div', { class: 'cc-wv-skeleton', 'aria-hidden': 'true' }, [el('i'), el('i')]);

	const closeBtn = el('button', { type: 'button', class: 'cc-wv-close', 'aria-label': 'Close', text: '×', onclick: () => close() });
	const dialog = el('div', {
		class: 'cc-wv-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'cc-wv-title', tabindex: '-1',
	}, [
		closeBtn,
		el('h2', { id: 'cc-wv-title', text: 'Who can see this world' }),
		skeleton,
		options,
		upsell,
		invitePane,
		status,
	]);
	const root = el('div', { class: 'cc-wv-backdrop', onclick: (e) => { if (e.target === root) close(); } }, [dialog]);

	function render() {
		const held = access ? Boolean(access.eligible) : null;
		skeleton.hidden = access !== null;
		options.hidden = access === null;
		publicBtn.setAttribute('aria-checked', String(visibility === 'public'));
		privateBtn.setAttribute('aria-checked', String(visibility === 'private'));
		publicBtn.classList.toggle('cc-on', visibility === 'public');
		privateBtn.classList.toggle('cc-on', visibility === 'private');
		const locked = held === false && visibility !== 'private';
		privateBtn.classList.toggle('cc-locked', locked);
		privateBtn.querySelector('.cc-wv-opt-title').textContent = locked ? '🔒 Private' : 'Private';
		privateBtn.querySelector('.cc-wv-opt-desc').textContent = 'Only you and the people you invite can see this world.';
		publicBtn.disabled = busy;
		privateBtn.disabled = busy;

		if (locked) {
			const need = access?.required?.label || 'Silver';
			upsell.hidden = false;
			upsell.textContent = '';
			upsell.append(
				`Private worlds are a ${need} holder perk. `,
				el('a', { href: '/three', target: '_blank', rel: 'noopener', text: 'See how holding $THREE unlocks it' }),
				'.',
			);
		} else {
			upsell.hidden = true;
		}

		invitePane.hidden = visibility !== 'private';
		addBtn.disabled = busy;
		list.textContent = '';
		if (!invitees.length) {
			list.appendChild(el('li', { class: 'cc-wv-empty', text: 'Nobody invited yet. Type a username above to share this world.' }));
		}
		for (const person of invitees) {
			const name = person.username ? `@${person.username}` : person.id;
			list.appendChild(el('li', { class: 'cc-wv-person' }, [
				el('span', { text: name }),
				el('button', {
					type: 'button', class: 'cc-wv-btn cc-wv-remove', 'aria-label': `Remove ${name}`, text: 'Remove',
					disabled: busy, onclick: () => uninvite(person),
				}),
			]));
		}
	}

	// Mint the tier pass first (interactive only when the read says this identity
	// is eligible, so a non-holder is never asked to sign for something that could
	// not unlock anything), then call the server.
	async function call(action, payload) {
		busy = true;
		render();
		try {
			await getTierPass({ interactive: Boolean(access?.eligible) });
			const result = await changeWorldAccess(store.worldId, action, payload, { fetchImpl, headers: attachTierPass({}) });
			return result;
		} finally {
			busy = false;
		}
	}

	function explain({ status: code, body }) {
		if (code === 401) return 'Sign in to change who can see this world.';
		if (code === 403) return 'Only the world’s owner can change this.';
		if (code === 404 && body?.error === 'invitee_not_found') return 'No account has that username.';
		if (code === 404) return 'Build something in this world first, then you can choose who sees it.';
		if (code === 409 && body?.error === 'invitee_limit') return body.message;
		if (code === 429) return 'Too many changes. Try again in a few minutes.';
		if (code === 0) return 'Couldn’t reach the server. Check your connection and try again.';
		return body?.message || 'That didn’t save. Try again.';
	}

	function adopt(body) {
		if (body?.visibility) visibility = body.visibility === 'private' ? 'private' : 'public';
		if (Array.isArray(body?.invitees)) invitees = body.invitees;
		store.visibility = visibility;
		store.invitees = invitees;
	}

	async function choose(next) {
		if (busy || next === visibility) return;
		setStatus('Saving…');
		const result = await call('visibility', { visibility: next });
		if (result.status === 402 && result.body?.error === 'three_hold_required') {
			setStatus('');
			render();
			onGate(result.body);
			return;
		}
		if (!result.ok) { setStatus(explain(result), 'error'); render(); return; }
		adopt(result.body);
		setStatus(next === 'private' ? 'This world is now private.' : 'This world is now public.', 'ok');
		toast?.(next === 'private' ? 'World set to private.' : 'World set to public.', 'info');
		render();
	}

	async function invite() {
		const name = input.value.trim();
		if (!name || busy) { input.focus(); return; }
		setStatus('Inviting…');
		const result = await call('invite', { invitee: name });
		if (!result.ok) { setStatus(explain(result), 'error'); render(); input.focus(); return; }
		adopt(result.body);
		input.value = '';
		setStatus(`${name.replace(/^@/, '')} can now see this world.`, 'ok');
		render();
		input.focus();
	}

	async function uninvite(person) {
		if (busy) return;
		setStatus('Removing…');
		const result = await call('uninvite', { invitee: person.username || person.id });
		if (!result.ok) { setStatus(explain(result), 'error'); render(); return; }
		adopt(result.body);
		setStatus('Access removed.', 'ok');
		render();
	}

	function onKey(e) {
		if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
		if (e.key !== 'Tab') return;
		const focusables = [...dialog.querySelectorAll('button:not([disabled]), input, a[href]')].filter((n) => !n.closest('[hidden]'));
		if (!focusables.length) return;
		const first = focusables[0];
		const last = focusables[focusables.length - 1];
		if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
		else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
	}

	function close() {
		document.removeEventListener('keydown', onKey, true);
		root.remove();
		open = null;
		if (returnFocus && typeof returnFocus.focus === 'function') returnFocus.focus();
	}

	injectStyles();
	document.body.appendChild(root);
	document.addEventListener('keydown', onKey, true);
	render();
	dialog.focus();

	getAccess('worlds.private', { fresh: true }).then((payload) => {
		// A failed read degrades to "unlocked": the server stays the only authority
		// and answers a real 402 if the caller is not a holder.
		access = payload?.access ?? { eligible: true };
		render();
	});

	open = { close };
	return { close, root };
}

function injectStyles() {
	if (document.getElementById(STYLE_ID)) return;
	const style = document.createElement('style');
	style.id = STYLE_ID;
	style.textContent = `
.cc-wv-backdrop{position:fixed;inset:0;z-index:1200;display:grid;place-items:center;padding:16px;background:rgba(6,8,12,.62);backdrop-filter:blur(3px)}
.cc-wv-dialog{position:relative;width:min(440px,100%);max-height:calc(100dvh - 32px);overflow:auto;padding:20px;border-radius:14px;border:1px solid rgba(255,255,255,.14);background:#14171d;color:#e8e8ea;font:14px/1.45 system-ui,sans-serif;box-shadow:0 18px 60px rgba(0,0,0,.5);outline:none}
.cc-wv-dialog h2{margin:0 28px 12px 0;font-size:17px}
.cc-wv-dialog h3{margin:0 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:#9aa0aa}
.cc-wv-close{position:absolute;top:10px;right:10px;width:32px;height:32px;border-radius:8px;border:1px solid transparent;background:transparent;color:#c9cdd4;font-size:20px;line-height:1;cursor:pointer;transition:background .15s,border-color .15s}
.cc-wv-close:hover{background:rgba(255,255,255,.1)}
.cc-wv-close:active{background:rgba(255,255,255,.18)}
.cc-wv-close:focus-visible,.cc-wv-opt:focus-visible,.cc-wv-btn:focus-visible,.cc-wv-input:focus-visible,.cc-wv-upsell a:focus-visible{outline:2px solid #66ff8c;outline-offset:2px}
.cc-wv-options{display:grid;gap:8px}
.cc-wv-opt{display:grid;gap:2px;text-align:left;padding:12px 14px;border-radius:10px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.04);color:inherit;font:inherit;cursor:pointer;transition:background .15s,border-color .15s}
.cc-wv-opt span{color:#9aa0aa;font-size:12.5px}
.cc-wv-opt:hover:not(:disabled){background:rgba(255,255,255,.09);border-color:rgba(255,255,255,.3)}
.cc-wv-opt:active:not(:disabled){background:rgba(255,255,255,.14)}
.cc-wv-opt.cc-on{border-color:#66ff8c;background:rgba(102,255,140,.1)}
.cc-wv-opt.cc-locked{opacity:.82}
.cc-wv-opt:disabled{cursor:progress}
.cc-wv-upsell{margin:10px 0 0;padding:10px 12px;border-radius:10px;background:rgba(255,200,80,.1);border:1px solid rgba(255,200,80,.3);color:#ffe3a3;font-size:13px}
.cc-wv-upsell a{color:#ffd166}
.cc-wv-pane{margin-top:16px}
.cc-wv-invite{display:flex;gap:8px}
.cc-wv-input{flex:1;min-width:0;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:rgba(0,0,0,.3);color:inherit;font:inherit}
.cc-wv-btn{padding:7px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.08);color:inherit;font:inherit;font-weight:600;cursor:pointer;transition:background .15s,border-color .15s}
.cc-wv-btn:hover:not(:disabled){background:rgba(255,255,255,.16);border-color:rgba(255,255,255,.34)}
.cc-wv-btn:active:not(:disabled){background:rgba(255,255,255,.22)}
.cc-wv-btn:disabled{opacity:.55;cursor:progress}
.cc-wv-list{list-style:none;margin:10px 0 0;padding:0;display:grid;gap:6px}
.cc-wv-person{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 10px;border-radius:8px;background:rgba(255,255,255,.05)}
.cc-wv-remove{padding:4px 10px;font-size:12px}
.cc-wv-empty{padding:10px 12px;border-radius:8px;border:1px dashed rgba(255,255,255,.2);color:#9aa0aa;font-size:13px}
.cc-wv-status{min-height:1.4em;margin:12px 0 0;font-size:13px;color:#9aa0aa}
.cc-wv-status[data-kind="error"]{color:#ff9d9d}
.cc-wv-status[data-kind="ok"]{color:#8de6a6}
.cc-wv-skeleton{display:grid;gap:8px}
.cc-wv-skeleton i{display:block;height:58px;border-radius:10px;background:linear-gradient(90deg,rgba(255,255,255,.05),rgba(255,255,255,.12),rgba(255,255,255,.05));background-size:200% 100%;animation:cc-wv-shimmer 1.2s linear infinite}
@keyframes cc-wv-shimmer{to{background-position:-200% 0}}
@media (prefers-reduced-motion:reduce){.cc-wv-skeleton i{animation:none}}
`;
	document.head.appendChild(style);
}
