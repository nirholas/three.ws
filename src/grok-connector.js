// The Grok Bot custom MCP connector card: the one setup component behind
// /connect's Grok Bot tab and the setup section of /grok.
//
// Grok Bot has no install link. It adds a server through a "custom MCP"
// connector form (name, transport, URL, authentication), or from one sentence
// in chat, and it connects from xAI's cloud, so the URL must be public. This
// card shows exactly those fields for one hosted server and keeps them in step
// when the page picks another. Copy is English, keyed into the `connect`
// namespace of public/locales so i18n.js translates the card on either page.

import './grok-connector.css';

export const GROK_ENDPOINT = 'https://three.ws/api/mcp-grok';

// The config key a client stores a server under. Same rule as the three-ws CLI
// (packages/three-ws-cli/src/servers.js slugForPath), so a server added from
// /connect, /grok and `npx three-ws setup` never lands twice:
// /mcp -> three-ws, /api/mcp -> three-ws-main, /api/mcp-grok -> three-ws-grok.
export function slugForEndpoint(endpoint) {
	const pathname = new URL(endpoint).pathname;
	if (pathname === '/mcp') return 'three-ws';
	if (pathname === '/api/mcp') return 'three-ws-main';
	const rest = pathname.replace(/^\/(api\/)?/, '').split('-').filter((part) => part && part !== 'mcp').join('-');
	return rest ? `three-ws-${rest}` : 'three-ws';
}

// Which authentication the connector form takes for a directory entry
// (/.well-known/mcp.json). A server with a sign-in URL also serves anonymous
// callers, and signing in only adds the account's tools, so it connects with
// None. An x402-first server takes a three.ws API key. The rest sign in with OAuth.
export function grokAuthFor(server) {
	if (server.signIn) return 'none';
	const auth = String(server.auth || '').toLowerCase();
	if (auth === 'none' || auth.startsWith('none ')) return 'none';
	if (auth.startsWith('x402')) return 'key';
	return 'oauth';
}

/** The sentence that adds a server from Grok Bot's chat. */
export function grokSentence(server) {
	const auth = grokAuthFor(server);
	const how = auth === 'oauth' ? ' with OAuth authentication' : auth === 'key' ? ' with API key authentication' : '';
	return `Add a custom MCP server called ${slugForEndpoint(server.endpoint)} at ${server.endpoint}${how}`;
}

const TEMPLATE = `
	<p class="gc-lede" data-i18n-html="connect.grok_bot_adds_three_ws_as_a_custom">Grok Bot adds three.ws as a <strong>custom MCP</strong> connector. There is no pre-filled link, so enter these settings in its connector form, or send Grok Bot the sentence below and confirm what it shows.</p>
	<p class="gc-note" id="gc-suggest" hidden>
		<span data-i18n-html="connect.grok_server_is_built_for_grok_bot">The <strong>Grok</strong> server is built for Grok Bot: the free 3D studio with no sign-in, plus your own agents when you sign in, on one URL.</span>
		<button type="button" class="gc-link" id="gc-use" data-i18n="connect.use_the_grok_server">Use the Grok server</button>
	</p>
	<dl class="gc-settings">
		<div>
			<dt data-i18n="connect.name">Name</dt>
			<dd><code id="gc-name"></code></dd>
		</div>
		<div>
			<dt data-i18n="connect.transport">Transport</dt>
			<dd data-i18n="connect.streamable_http">Streamable HTTP</dd>
		</div>
		<div>
			<dt data-i18n="connect.url">URL</dt>
			<dd class="gc-settings-url">
				<code id="gc-url"></code>
				<button type="button" class="gc-btn" id="gc-copy" data-gc-copy="gc-url"><span data-i18n="connect.copy">Copy</span></button>
			</dd>
		</div>
		<div>
			<dt data-i18n="connect.authentication">Authentication</dt>
			<dd>
				<span data-grok-auth="none" hidden data-i18n-html="connect.grok_auth_none"><strong>None.</strong> These tools are free and need no account, so no sign-in card appears.</span>
				<span data-grok-auth="oauth" hidden data-i18n-html="connect.grok_auth_oauth"><strong>OAuth.</strong> Grok Bot opens three.ws sign-in once. Read the permissions before you approve.</span>
				<span data-grok-auth="key" hidden data-i18n-html="connect.grok_auth_key"><strong>API key.</strong> Make a key at <a href="/dashboard/api">Dashboard → API</a> and store it as a Bot secret. Signed-in calls skip the per-call payment.</span>
			</dd>
		</div>
	</dl>
	<div class="gc-account" id="gc-account" hidden>
		<p class="gc-note" data-i18n-html="connect.grok_account_on_the_same_server">To let Grok Bot also work with <strong>your</strong> agents, their memory and skills, connect this URL with <strong>OAuth</strong> instead. Or keep the URL above and give it a connector key from <a href="/dashboard/api">Dashboard → API</a> (choose <strong>For an AI agent</strong>), stored as a Bot secret. It never lists a tool that spends.</p>
		<div class="gc-url">
			<span class="gc-url-label" data-i18n="connect.oauth">OAuth</span>
			<code id="gc-signin-url"></code>
			<button type="button" class="gc-btn" data-gc-copy="gc-signin-url"><span data-i18n="connect.copy">Copy</span></button>
		</div>
	</div>
	<p class="gc-note" id="gc-keyalt" hidden data-i18n-html="connect.grok_key_alternative">Running it unattended, on a schedule? A connector key from <a href="/dashboard/api">Dashboard → API</a> (choose <strong>For an AI agent</strong>), stored as a Bot secret, works on this URL too and can never spend.</p>
	<div class="gc-say">
		<div class="gc-say-head"><span data-i18n="connect.or_send_this_to_grok_bot">Or send this to Grok Bot</span><button type="button" class="gc-btn" data-gc-copy="gc-say"><span data-i18n="connect.copy">Copy</span></button></div>
		<pre><code id="gc-say"></code></pre>
	</div>
	<ol class="gc-list">
		<li data-i18n-html="connect.grok_step_add_custom">In Grok Bot, open <strong>Connectors</strong> and add a <strong>custom MCP</strong> server with the settings above. Asking in chat works too: say "custom server", or Grok Bot may look for a marketplace plugin instead.</li>
		<li data-i18n="connect.grok_step_confirm">Grok Bot shows the name and URL. Check both, then confirm.</li>
		<li data-i18n-html="connect.grok_step_use">Ask for 3D in any task, or attach the server with <code>@</code> and its name. Grok Bot runs on its own cloud computer, so it can save the GLB to its files or run the request on a schedule.</li>
	</ol>
	<p class="gc-callout" role="note" data-i18n-html="connect.grok_localhost_never_works"><strong>Use the public URL.</strong> Grok Bot connects from xAI's cloud, not from your computer, so a <code>localhost</code> or private-network URL never works. The three.ws URLs above are public.</p>
	<p class="gc-src" id="gc-source" data-i18n-html="connect.grok_source">Grok Bot is in beta and its connector screen still changes: if these steps drift, <a href="https://github.com/nirholas/three.ws/issues" target="_blank" rel="noopener">tell us</a>. See what Grok Bot can do with it, live, at <a href="/grok">three.ws/grok</a>, read the full guide, with the xAI API and Grok connectors, at <a href="/docs/grok">three.ws for Grok</a>, and fix a connection that fails with the <a href="/docs/grok-bot#troubleshooting">connector reference</a>.</p>
`;

async function copyFrom(btn, source) {
	const label = btn.querySelector('span') || btn;
	const original = label.textContent;
	try {
		await navigator.clipboard.writeText(source.textContent);
		label.textContent = 'Copied';
		btn.dataset.copied = 'true';
	} catch {
		// No clipboard permission: select the text so one keystroke copies it.
		label.textContent = 'Press Ctrl+C';
		const range = document.createRange();
		range.selectNodeContents(source);
		const sel = getSelection();
		sel.removeAllRanges();
		sel.addRange(range);
	}
	clearTimeout(btn._gcTimer);
	btn._gcTimer = setTimeout(() => {
		label.textContent = original;
		delete btn.dataset.copied;
	}, 1600);
}

/**
 * Render the card into `root` and return a handle that points it at a server.
 *
 * @param {HTMLElement} root
 * @param {object} [opts]
 * @param {() => void} [opts.onUseGrok] Switch the page to the Grok server. The
 *   suggestion to do so only shows when this is given.
 * @param {boolean} [opts.source=true] Show the "steps drift? tell us" note and
 *   its links to /grok and /docs/grok.
 * @returns {{ update(server: {endpoint: string, auth?: string, signIn?: string|null}, opts?: {grokAvailable?: boolean}): void }}
 */
export function mountGrokConnector(root, { onUseGrok, source = true } = {}) {
	root.classList.add('gc');
	root.innerHTML = TEMPLATE;
	const el = (id) => root.querySelector(`#${id}`);
	el('gc-source').hidden = !source;

	root.addEventListener('click', (e) => {
		const btn = e.target.closest('[data-gc-copy]');
		if (btn) copyFrom(btn, el(btn.dataset.gcCopy));
	});
	if (onUseGrok) el('gc-use').addEventListener('click', () => onUseGrok());

	return {
		update(server, { grokAvailable = false } = {}) {
			const auth = grokAuthFor(server);
			el('gc-name').textContent = slugForEndpoint(server.endpoint);
			el('gc-url').textContent = server.endpoint;
			for (const span of root.querySelectorAll('[data-grok-auth]')) span.hidden = span.dataset.grokAuth !== auth;
			el('gc-keyalt').hidden = auth !== 'oauth';
			el('gc-account').hidden = !server.signIn;
			el('gc-signin-url').textContent = server.signIn || '';
			el('gc-say').textContent = grokSentence(server);
			el('gc-suggest').hidden = !onUseGrok || !grokAvailable || server.endpoint === GROK_ENDPOINT;
		},
	};
}
