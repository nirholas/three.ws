// Tenant-wide admin consent page (pages/enterprise-admin-consent.html, route
// /enterprise/admin-consent). Three states, all from the address bar:
//
//   (nothing)            what the three.ws sign-in app asks for, in plain language,
//                        and the link an Entra administrator opens to approve it.
//   ?tenant=&admin_consent=True   Microsoft's redirect after approval: success.
//   ?error=&error_description=    Microsoft's redirect after a refusal or failure.
//
// The page does nothing privileged: consent is recorded by Microsoft in the
// tenant, so reading the redirect only explains the result. API:
// api/enterprise/admin-consent-config.js. Docs: docs/microsoft-admin-deployment.md.

import './enterprise-admin-consent.css';
import { buildConsentUrl, normalizeTenant, parseConsentRedirect, permissionRows } from './enterprise-admin-consent-model.js';

const root = document.getElementById('ac-root');
const live = document.getElementById('ac-live');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const ERRORS = {
	declined: ['Consent was declined', 'The administrator chose not to approve three.ws, so nothing changed in your tenant. When you are ready, approve it from the start.'],
	admin_required: ['An administrator needs to approve this', 'The account that signed in cannot grant tenant-wide consent. Send the link to a Global Administrator, Privileged Role Administrator, Application Administrator or Cloud Application Administrator.'],
	failed: ['Microsoft could not complete the approval', 'Nothing changed in your tenant. Try again; if it keeps failing, send the message below to support@three.ws.'],
};

function render(html, announce) {
	root.innerHTML = html;
	root.setAttribute('aria-busy', 'false');
	if (announce) live.textContent = announce;
	const focus = root.querySelector('[data-autofocus]');
	if (focus) focus.focus();
}

async function loadConfig() {
	const res = await fetch('/api/enterprise/admin-consent-config', { headers: { accept: 'application/json' } });
	if (res.status === 503) return { unavailable: true };
	if (!res.ok) throw new Error(`config ${res.status}`);
	return res.json();
}

function showResult(result) {
	if (result.kind === 'success') {
		render(
			`<section class="ac-card is-good" aria-labelledby="ac-t">
				<h2 id="ac-t" tabindex="-1" data-autofocus>three.ws is approved for your organisation</h2>
				<p>Everyone in this tenant can now sign in to three.ws with their work account, without being asked for consent.</p>
				<dl class="ac-facts"><dt>Tenant id</dt><dd class="ac-code">${esc(result.tenantId)}</dd></dl>
				<ol class="ac-steps">
					<li>Optional: claim the tenant for your team so colleagues find it at sign-in (<a href="/docs/enterprise-sso">Enterprise sign-in and SCIM</a>).</li>
					<li>Deploy the Teams app, the web app and the Edge extensions to your users with the <a href="/docs/microsoft-admin-deployment">admin deployment guide</a>.</li>
					<li>To undo this, delete the three.ws enterprise application in the Entra admin center (Enterprise applications).</li>
				</ol>
			</section>`,
			'three.ws was approved for your organisation',
		);
		return;
	}
	const [title, body] = ERRORS[result.code];
	render(
		`<section class="ac-card is-error" role="alert" aria-labelledby="ac-t">
			<h2 id="ac-t" tabindex="-1" data-autofocus>${esc(title)}</h2>
			<p>${esc(body)}</p>
			${result.detail ? `<p class="ac-code">${esc(result.detail)}</p>` : ''}
			<div class="ac-actions"><a class="ac-btn ac-btn-primary" href="/enterprise/admin-consent">Start again</a></div>
		</section>`,
		title,
	);
}

function showLanding(config) {
	const rows = permissionRows(config.scopes)
		.map((p) => `<li><strong>${esc(p.title)}</strong><span>${esc(p.detail)}</span></li>`)
		.join('');
	render(
		`<section class="ac-card" aria-labelledby="ac-t">
			<h2 id="ac-t">What you are approving</h2>
			<p>These are the permissions the three.ws sign-in app requests. They are all delegated: they apply only while a person is signed in, and none reads mail, files, chats or your directory.</p>
			<ul class="ac-perms">${rows}</ul>
			<form id="ac-form" novalidate>
				<div class="ac-field">
					<label for="ac-tenant">Tenant (optional)</label>
					<input id="ac-tenant" name="tenant" autocomplete="off" spellcheck="false" placeholder="contoso.com or a tenant id" aria-describedby="ac-tenant-hint">
					<p class="ac-hint" id="ac-tenant-hint">Leave empty to sign in with any work or school account. Fill it in to send the administrator straight to your tenant.</p>
				</div>
				<div class="ac-actions">
					<a class="ac-btn ac-btn-primary" id="ac-go" href="#">Approve for my organisation</a>
					<button class="ac-btn" type="button" id="ac-copy">Copy link for an administrator</button>
				</div>
				<p class="ac-hint" id="ac-status" role="status"></p>
				<p class="ac-link ac-code" id="ac-url"></p>
			</form>
		</section>`,
	);
	const input = root.querySelector('#ac-tenant');
	const go = root.querySelector('#ac-go');
	const url = root.querySelector('#ac-url');
	const status = root.querySelector('#ac-status');

	const current = () => {
		const tenant = normalizeTenant(input.value);
		input.setAttribute('aria-invalid', tenant ? 'false' : 'true');
		if (!tenant) return null;
		return buildConsentUrl({ clientId: config.clientId, redirectUri: config.redirectUri, tenant });
	};
	const refresh = () => {
		const href = current();
		go.href = href || '#';
		go.setAttribute('aria-disabled', href ? 'false' : 'true');
		url.textContent = href || '';
		status.textContent = href ? '' : 'Enter a domain like contoso.com or a tenant id like 00000000-0000-0000-0000-000000000000.';
	};
	input.addEventListener('input', refresh);
	go.addEventListener('click', (e) => {
		if (go.getAttribute('aria-disabled') === 'true') e.preventDefault();
	});
	root.querySelector('#ac-copy').addEventListener('click', async () => {
		const href = current();
		if (!href) return refresh();
		try {
			await navigator.clipboard.writeText(href);
			status.textContent = 'Link copied. Send it to a Global Administrator or Application Administrator.';
		} catch {
			status.textContent = 'Your browser blocked copying. Select the link below and copy it.';
			const range = document.createRange();
			range.selectNodeContents(url);
			const sel = getSelection();
			sel.removeAllRanges();
			sel.addRange(range);
		}
	});
	refresh();
}

function showUnavailable() {
	render(
		`<section class="ac-card is-error" role="alert" aria-labelledby="ac-t">
			<h2 id="ac-t" tabindex="-1" data-autofocus>Microsoft sign-in is not switched on here</h2>
			<p>This deployment has no Microsoft app registered, so there is nothing to approve yet. Contact support@three.ws.</p>
		</section>`,
		'Microsoft sign-in is not available',
	);
}

function showNetworkError() {
	render(
		`<section class="ac-card is-error" role="alert" aria-labelledby="ac-t">
			<h2 id="ac-t" tabindex="-1" data-autofocus>Could not reach three.ws</h2>
			<p>Check your connection and try again.</p>
			<div class="ac-actions"><button class="ac-btn ac-btn-primary" type="button" id="ac-retry">Try again</button></div>
		</section>`,
		'Could not reach three.ws',
	);
	root.querySelector('#ac-retry').addEventListener('click', start);
}

async function start() {
	root.setAttribute('aria-busy', 'true');
	const result = parseConsentRedirect(location.search);
	if (result.kind !== 'none') return showResult(result);
	try {
		const config = await loadConfig();
		if (config.unavailable) return showUnavailable();
		showLanding(config);
	} catch {
		showNetworkError();
	}
}

start();
