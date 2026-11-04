// Microsoft Marketplace landing page (pages/microsoft-activate.html, route
// /microsoft/activate). Microsoft sends the buyer here from "Configure account"
// with ?token=<purchase token>. The page:
//
//   ?token=...         resolves the purchase (POST /api/microsoft-marketplace/resolve),
//                      shows what was bought, and offers "Continue with Microsoft",
//                      which signs the buyer in with Entra ID, links the purchase
//                      to their three.ws account and activates it.
//   ?subscription=id   the activation result, read from the buyer's own
//                      subscriptions (GET /api/microsoft-marketplace/subscriptions).
//   ?resume=1          back from signing in to an existing three.ws account;
//                      continue the link for the purchase pinned to this browser.
//   ?error=code        a failed step, explained with the way to recover.
//   (nothing)          what this page is and how to buy.
//
// The purchase token is removed from the address bar once read, so it is not
// left in history or shared by copying the URL.
// API: api/microsoft-marketplace/[action].js. Doc: docs/microsoft-marketplace-saas.md.

import './microsoft-activate.css';

const API = '/api/microsoft-marketplace';
const SIGN_IN = `${API}/sso/start`;
const LISTING_URL = 'https://marketplace.microsoft.com/';

const root = document.getElementById('ma-root');
const live = document.getElementById('ma-live');

const MS_LOGO = '<svg viewBox="0 0 21 21" aria-hidden="true"><rect x="1" y="1" width="9" height="9" fill="#f25022"/><rect x="11" y="1" width="9" height="9" fill="#7fba00"/><rect x="1" y="11" width="9" height="9" fill="#00a4ef"/><rect x="11" y="11" width="9" height="9" fill="#ffb900"/></svg>';

const STATUS = {
	PendingFulfillmentStart: ['Waiting for activation', 'is-warn'],
	Subscribed: ['Active', 'is-good'],
	Suspended: ['Suspended', 'is-bad'],
	Unsubscribed: ['Cancelled', 'is-bad'],
};

const PLAN_LABEL = { pro: 'Pro', team: 'Team', enterprise: 'Enterprise', free: 'Free' };

// Every code the API can put in ?error=, with what happened and what to do.
const ERRORS = {
	invalid_token: ['This purchase link is not valid', 'The token in the link was rejected by Microsoft. It may have been cut off when copied. Open the subscription in the Azure portal or Microsoft 365 admin center and choose "Configure account" again.', 'portal'],
	purchase_expired: ['This activation session expired', 'For your security a purchase stays pinned to this browser for one hour. Open the subscription in the Azure portal or Microsoft 365 admin center and choose "Configure account" again.', 'portal'],
	sso_expired: ['The Microsoft sign-in took too long', 'Sign-in has to finish within ten minutes of starting. Start it again below.', 'retry'],
	sso_cancelled: ['Microsoft sign-in was cancelled', 'Nothing was changed. Continue with Microsoft when you are ready.', 'retry'],
	admin_consent_required: ['Your organisation needs to approve three.ws', 'Your Microsoft Entra administrator must consent to the three.ws sign-in app before members can use it. Send them this page; once they approve, continue with Microsoft again.', 'retry'],
	sso_failed: ['Microsoft sign-in did not complete', 'Microsoft returned an error during sign-in. Try again; if it keeps failing, contact support with the time it happened.', 'retry'],
	sso_exchange_failed: ['Microsoft sign-in did not complete', 'Microsoft did not issue a sign-in token. Try again in a moment.', 'retry'],
	sso_invalid_token: ['Microsoft sign-in could not be verified', 'The sign-in response did not pass verification, so nothing was linked. Start again below.', 'retry'],
	sso_unavailable: ['Microsoft sign-in is not switched on yet', 'This deployment cannot sign in with Microsoft right now. Your purchase is safe and stays pending until it is activated. Contact support and we will activate it for you.', 'support'],
	not_configured: ['Microsoft purchases are not switched on yet', 'This deployment is not connected to Microsoft Marketplace. Your purchase stays pending and you are not charged until it is activated. Contact support.', 'support'],
	tenant_mismatch: ['That Microsoft account is from a different organisation', 'Sign in with a work account from the organisation the subscription was bought for (the beneficiary tenant). If you have several accounts, choose the right one at the Microsoft prompt.', 'retry'],
	already_linked: ['This purchase belongs to another three.ws account', 'A subscription can be linked to one account only. Sign in with the account it was first linked to, or contact support to move it.', 'support'],
	identity_in_use: ['That Microsoft account is linked to another three.ws account', 'Sign out, then continue with Microsoft again to use the account it is already linked to.', 'retry'],
	unknown_plan: ['This plan is not available yet', 'The plan you bought is not set up on three.ws, so it was not activated and you have not been charged. Contact support.', 'support'],
	activation_failed: ['Microsoft did not confirm the activation', 'Your account is linked but Microsoft did not accept the activation request. Try again; you are not charged until activation succeeds.', 'retry'],
	no_email: ['Your Microsoft account has no email address', 'three.ws needs an email to create your account. Ask your administrator to set one on your Entra user, or sign in to an existing three.ws account first.', 'login'],
	account_deleted: ['That three.ws account was deleted', 'The account linked to this Microsoft sign-in is pending deletion. Contact support to restore it.', 'support'],
	rate_limited: ['Too many attempts', 'Wait a minute and try again.', 'retry'],
	subscription_not_found: ['Microsoft does not know this subscription', 'The subscription could not be found. It may have been cancelled before activation. Check it in the Azure portal or Microsoft 365 admin center.', 'portal'],
	publisher_forbidden: ['three.ws could not reach this subscription', 'Microsoft refused our request for this purchase. Contact support and include the time you saw this.', 'support'],
	publisher_auth_failed: ['three.ws could not reach Microsoft', 'Our connection to Microsoft Marketplace failed. Try again in a few minutes.', 'retry'],
	marketplace_error: ['Microsoft Marketplace is not answering', 'Microsoft returned an error. Try again in a few minutes.', 'retry'],
	network: ['Could not reach three.ws', 'Check your connection and try again.', 'reload'],
};

function esc(s) {
	return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function date(v) {
	if (!v) return 'Not set';
	const d = new Date(v);
	return Number.isNaN(d.getTime()) ? 'Not set' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function render(html, announce) {
	root.innerHTML = html;
	root.setAttribute('aria-busy', 'false');
	if (announce) live.textContent = announce;
	const focus = root.querySelector('[data-autofocus]');
	if (focus) focus.focus();
}

function skeleton() {
	root.setAttribute('aria-busy', 'true');
	root.innerHTML = '<div class="ma-skel is-title" aria-hidden="true"></div><div class="ma-skel is-card" aria-hidden="true"></div>';
}

function signInButton(label = 'Continue with Microsoft') {
	return `<a class="ma-btn ma-btn-primary" href="${SIGN_IN}" data-autofocus>${MS_LOGO}<span>${esc(label)}</span></a>`;
}

function header(eyebrow, title, lede) {
	return `<p class="ma-eyebrow">${esc(eyebrow)}</p><h1 class="ma-h1">${esc(title)}</h1>${lede ? `<p class="ma-lede">${esc(lede)}</p>` : ''}`;
}

function statusBadge(status) {
	const [label, cls] = STATUS[status] || [status || 'Unknown', ''];
	return `<span class="ma-badge ${cls}">${esc(label)}</span>`;
}

function facts(sub) {
	const plan = sub.plan ? PLAN_LABEL[sub.plan] || sub.plan : `${sub.plan_id} (not available)`;
	return `<dl class="ma-facts">
		<dt>Subscription</dt><dd>${esc(sub.name || sub.id)}</dd>
		<dt>Plan</dt><dd>${esc(plan)}${sub.quantity ? ` · ${esc(sub.quantity)} seats` : ''}</dd>
		<dt>Status</dt><dd>${statusBadge(sub.status)}${sub.is_test ? ' <span class="ma-badge">Test purchase</span>' : ''}</dd>
		<dt>For</dt><dd>${esc(sub.beneficiary_email || 'Your organisation')}</dd>
		<dt>Renews</dt><dd>${sub.term_end ? `${esc(date(sub.term_end))}${sub.auto_renew ? '' : ' (auto-renew off)'}` : 'After activation'}</dd>
	</dl>`;
}

// ── States ──────────────────────────────────────────────────────────────────

function renderIntro() {
	render(`${header('Microsoft Marketplace', 'Activate a three.ws subscription', 'Bought three.ws on Microsoft Marketplace? This is where the purchase is linked to your three.ws account.')}
		<section class="ma-card">
			<h2>How activation works</h2>
			<ol class="ma-steps">
				<li>Buy a three.ws plan on Microsoft Marketplace.</li>
				<li>Choose <strong>Configure account</strong> on the purchase. Microsoft brings you back here with the purchase attached.</li>
				<li>Continue with your Microsoft work account. three.ws links the subscription and your plan is active straight away.</li>
			</ol>
			<p class="ma-hint">You are billed by Microsoft only after activation. Usage above the plan's included amounts is reported to Microsoft hourly and appears on your Azure invoice.</p>
			<div class="ma-actions">
				<a class="ma-btn ma-btn-primary" href="${LISTING_URL}" rel="noopener" target="_blank" data-autofocus>Find three.ws on Microsoft Marketplace</a>
				<a class="ma-btn" href="/pricing">Compare plans</a>
				<a class="ma-btn" href="/login?next=%2Fmicrosoft%2Factivate">Sign in</a>
			</div>
		</section>`);
}

async function renderResolve(token) {
	skeleton();
	live.textContent = 'Checking your purchase with Microsoft';
	let res;
	let body;
	try {
		res = await fetch(`${API}/resolve`, {
			method: 'POST',
			credentials: 'include',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ token }),
		});
		body = await res.json().catch(() => ({}));
	} catch {
		return renderError('network', () => renderResolve(token));
	}
	if (!res.ok) return renderError(body?.error || 'marketplace_error', () => renderResolve(token), body?.error_description || body?.message);

	const sub = body.subscription;
	const who = body.signed_in
		? `<p>You are signed in to three.ws as <strong>${esc(body.signed_in.display_name || body.signed_in.email)}</strong>. The subscription will be linked to this account.</p>`
		: '<p>Sign in with the Microsoft work account from the organisation this was bought for. A three.ws account is created for you if you do not have one.</p>';

	if (body.owned_by_you && sub.status === 'Subscribed') {
		return render(`${header('Microsoft Marketplace', 'Your subscription is active')}
			<section class="ma-card is-good">${facts(sub)}
				<p>This purchase is already linked to your account and the plan is active.</p>
				<div class="ma-actions"><a class="ma-btn ma-btn-primary" href="/dashboard" data-autofocus>Open dashboard</a><a class="ma-btn" href="/billing">Billing</a></div>
			</section>`, 'Your subscription is already active');
	}
	if (body.owned_by_other) {
		return render(`${header('Microsoft Marketplace', 'This purchase is linked to another account')}
			<section class="ma-card is-error">${facts(sub)}
				<p>${body.signed_in ? 'It belongs to a different three.ws account than the one signed in here.' : 'Sign in with Microsoft to reach the account it is linked to.'}</p>
				<div class="ma-actions">${signInButton('Sign in with Microsoft')}<a class="ma-btn" href="/support">Contact support</a></div>
			</section>`);
	}
	if (sub.status === 'Unsubscribed') {
		return render(`${header('Microsoft Marketplace', 'This subscription was cancelled')}
			<section class="ma-card is-error">${facts(sub)}
				<p>Microsoft reports the subscription as cancelled, so there is nothing to activate. Buy a new plan on Microsoft Marketplace to continue.</p>
				<div class="ma-actions"><a class="ma-btn ma-btn-primary" href="${LISTING_URL}" rel="noopener" target="_blank" data-autofocus>Open Microsoft Marketplace</a></div>
			</section>`);
	}
	if (!body.plan_known) return renderError('unknown_plan');
	if (!body.sso_ready) return renderError('sso_unavailable');

	render(`${header('Microsoft Marketplace', 'Activate your three.ws subscription', 'Microsoft confirmed this purchase. One step left.')}
		<section class="ma-card">${facts(sub)}${who}
			<div class="ma-actions">${signInButton()}</div>
			<p class="ma-hint">Microsoft starts billing once activation completes. The purchase stays pinned to this browser for one hour.</p>
		</section>`, 'Purchase found. Continue with Microsoft to activate it.');
}

async function renderDone(subscriptionId) {
	skeleton();
	let res;
	let body;
	try {
		res = await fetch(`${API}/subscriptions`, { credentials: 'include' });
		body = await res.json().catch(() => ({}));
	} catch {
		return renderError('network', () => renderDone(subscriptionId));
	}
	if (res.status === 401) {
		return render(`${header('Microsoft Marketplace', 'Sign in to see your subscription')}
			<section class="ma-card"><p>Your session ended before the page loaded. Sign in again to see the subscription.</p>
				<div class="ma-actions">${signInButton('Sign in with Microsoft')}<a class="ma-btn" href="/login?next=%2Fmicrosoft%2Factivate">Other sign-in options</a></div>
			</section>`);
	}
	if (!res.ok) return renderError(body?.error || 'marketplace_error', () => renderDone(subscriptionId));
	const sub = (body.subscriptions || []).find((s) => s.id === subscriptionId);
	if (!sub) {
		return render(`${header('Microsoft Marketplace', 'Subscription not found on this account')}
			<section class="ma-card is-error"><p>The signed-in account has no Microsoft subscription with that id. If you have several three.ws accounts, sign in with the one you linked.</p>
				<div class="ma-actions"><a class="ma-btn ma-btn-primary" href="/dashboard" data-autofocus>Open dashboard</a><a class="ma-btn" href="/support">Contact support</a></div>
			</section>`);
	}
	if (sub.entitled) {
		const plan = PLAN_LABEL[body.plan] || body.plan;
		return render(`${header('Microsoft Marketplace', `You are on ${plan}`, 'Your Microsoft purchase is linked and active.')}
			<section class="ma-card is-good">${facts(sub)}
				<p>Plan changes, seat changes and cancellation are managed in the Azure portal or Microsoft 365 admin center; three.ws picks them up automatically.</p>
				<div class="ma-actions"><a class="ma-btn ma-btn-primary" href="/dashboard" data-autofocus>Open dashboard</a><a class="ma-btn" href="/create">Create an agent</a><a class="ma-btn" href="/billing">Billing</a></div>
			</section>`, `Activation complete. You are on ${plan}.`);
	}
	return render(`${header('Microsoft Marketplace', 'Linked, waiting on Microsoft')}
		<section class="ma-card">${facts(sub)}
			<p>The subscription is linked to your account. Microsoft has not reported it active yet; this usually takes under a minute.</p>
			<div class="ma-actions"><button class="ma-btn ma-btn-primary" type="button" data-refresh data-autofocus>Check again</button><a class="ma-btn" href="/dashboard">Open dashboard</a></div>
		</section>`);
}

function renderResume() {
	render(`${header('Microsoft Marketplace', 'Finish linking your purchase', 'You are signed in to your three.ws account. Continue with Microsoft once more to link the purchase to it.')}
		<section class="ma-card">
			<p>Use the Microsoft work account from the organisation the subscription was bought for.</p>
			<div class="ma-actions">${signInButton()}</div>
			<p class="ma-hint">If more than an hour has passed since you opened the purchase, start again from "Configure account" in the Azure portal or Microsoft 365 admin center.</p>
		</section>`);
}

function renderError(code, retry, detail) {
	const [title, help, recover] = ERRORS[code] || ['Something went wrong', 'The activation did not finish. Try again, or contact support with the code below.', 'support'];
	const actions = {
		retry: signInButton('Try again with Microsoft'),
		reload: retry ? '<button class="ma-btn ma-btn-primary" type="button" data-retry data-autofocus>Try again</button>' : '<a class="ma-btn ma-btn-primary" href="/microsoft/activate" data-autofocus>Try again</a>',
		portal: '<a class="ma-btn ma-btn-primary" href="https://portal.azure.com/#view/Microsoft_Azure_Marketplace/MarketplaceOffersBlade/selectedMenuItemId/saasResources" rel="noopener" target="_blank" data-autofocus>Open Azure portal</a><a class="ma-btn" href="https://admin.microsoft.com/#/subscriptions" rel="noopener" target="_blank">Microsoft 365 admin center</a>',
		login: '<a class="ma-btn ma-btn-primary" href="/login?next=%2Fmicrosoft%2Factivate%3Fresume%3D1" data-autofocus>Sign in to three.ws</a>',
		support: '<a class="ma-btn ma-btn-primary" href="/support" data-autofocus>Contact support</a>',
	}[recover];
	const retryBtn = retry && recover !== 'reload' ? '<button class="ma-btn" type="button" data-retry>Retry</button>' : '';
	render(`${header('Microsoft Marketplace', title)}
		<section class="ma-card is-error" role="alert">
			<p>${esc(help)}</p>
			${detail ? `<p class="ma-hint">Microsoft said: ${esc(detail)}</p>` : ''}
			<div class="ma-actions">${actions}${retryBtn}<a class="ma-btn" href="/pricing">Pricing</a></div>
			<p class="ma-hint">Error code <span class="ma-code">${esc(code)}</span></p>
		</section>`, title);
	if (retry) root.querySelectorAll('[data-retry]').forEach((b) => b.addEventListener('click', () => retry()));
}

// ── Boot ────────────────────────────────────────────────────────────────────

function boot() {
	const params = new URLSearchParams(location.search);
	const token = params.get('token');
	const subscription = params.get('subscription');
	const error = params.get('error');

	if (token) {
		// Keep the token in memory only; the address bar should not hold it.
		history.replaceState(null, '', location.pathname);
		return renderResolve(token);
	}
	if (error) return renderError(error);
	if (subscription) {
		root.addEventListener('click', (e) => {
			if (e.target.closest('[data-refresh]')) renderDone(subscription);
		});
		return renderDone(subscription);
	}
	if (params.get('resume') === '1') return renderResume();
	return renderIntro();
}

boot();
