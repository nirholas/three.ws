// The signed-out screen. One button: it opens three.ws in the browser, the
// person approves "three.ws Desktop" on the consent screen, and the browser
// hands the code back to this app on a loopback port. No password ever
// touches the app.

import { html, mount, onAction } from '../lib/dom.js';

const DEFAULT_SERVER = 'https://three.ws';

export function mountSignIn(root, ctx) {
	const { bridge } = ctx;
	let phase = 'idle';
	let error = null;
	let server = DEFAULT_SERVER;

	function render() {
		const waiting = phase === 'waiting';
		mount(root, html`<div class="signin-card">
			<div class="brand-mark" aria-hidden="true"></div>
			<h1 id="signin-title">Your agents, on your desktop</h1>
			<p>Sign in with your three.ws account to chat with your agents, follow their runs, approve what they want to spend, and connect your editor.</p>
			${waiting
				? html`<button type="button" class="btn" data-action="cancel">Cancel sign-in</button>
					<div class="signin-wait"><span class="spin" aria-hidden="true"></span>Finish signing in in your browser.</div>`
				: html`<button type="button" class="btn btn-primary" data-action="signin" autofocus>Sign in with three.ws</button>`}
			${error ? html`<div class="signin-error" role="alert">${error}</div>` : ''}
			<ul class="signin-list">
				<li><span class="ico ico-check" aria-hidden="true"></span>You approve the app by name on three.ws, and can revoke it any time.</li>
				<li><span class="ico ico-check" aria-hidden="true"></span>Nothing moves money without a preview and your confirmation.</li>
				<li><span class="ico ico-check" aria-hidden="true"></span>Your session is stored in the system keychain.</li>
			</ul>
			<details class="signin-server">
				<summary>Server</summary>
				<input class="input" id="server" type="url" value="${server}" aria-label="Server address" spellcheck="false" ${waiting ? 'disabled' : ''} />
			</details>
		</div>`);
		root.querySelector('#server')?.addEventListener('input', (e) => {
			server = e.target.value.trim() || DEFAULT_SERVER;
		});
	}

	async function signIn() {
		phase = 'waiting';
		error = null;
		render();
		try {
			await bridge.session.signIn({ apiBase: server });
			phase = 'done';
		} catch (err) {
			phase = 'idle';
			error = err.code === 'cancelled' ? null : err.message;
			render();
		}
	}

	const off = onAction(root, {
		signin: signIn,
		cancel: () => bridge.session.cancelSignIn(),
	});

	bridge.session.status().then((s) => {
		if (s?.apiBase) server = s.apiBase;
		render();
	}).catch(() => render());
	render();
	return off;
}
