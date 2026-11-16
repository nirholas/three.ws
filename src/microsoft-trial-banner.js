// Free trial banner for Microsoft Marketplace buyers.
//
// Loaded lazily by src/notifications.js (the nav entry every page shares) only
// when the auth hint says the visitor is signed in. It reads the signed-in
// user's Microsoft subscriptions and, when one is in a free trial, shows a slim
// notice under the site header: days left, what the trial converts to, and a
// link to manage the subscription in Microsoft.
//
// Never blocking: it sits in normal document flow below the sticky header,
// takes no focus, and has a dismiss button that hides it for the rest of the
// browser session (sessionStorage). The subscriptions response is cached in
// sessionStorage for ten minutes so moving between pages does not refetch it.

import './microsoft-trial-banner.css';
import { apiFetch } from './api.js';

const CACHE_KEY = 'ms-trial-banner:subs';
const DISMISS_KEY = 'ms-trial-banner:dismissed';
const CACHE_TTL_MS = 10 * 60 * 1000;
const PLAN_LABEL = { pro: 'Pro', team: 'Team', enterprise: 'Enterprise' };
// Pages that already explain the trial in full.
const SKIP_PATHS = ['/microsoft/activate'];

function readSession(key) {
	try { return sessionStorage.getItem(key); } catch { return null; }
}

function writeSession(key, value) {
	try { sessionStorage.setItem(key, value); } catch { /* storage disabled: banner still works, just refetches */ }
}

async function loadSubscriptions() {
	const cached = readSession(CACHE_KEY);
	if (cached) {
		try {
			const { at, subscriptions } = JSON.parse(cached);
			if (Date.now() - at < CACHE_TTL_MS && Array.isArray(subscriptions)) return subscriptions;
		} catch { /* corrupt cache: refetch */ }
	}
	const res = await apiFetch('/api/microsoft-marketplace/subscriptions', { credentials: 'include', allowAnonymous: true });
	if (!res.ok) return [];
	const body = await res.json();
	const subscriptions = Array.isArray(body?.subscriptions) ? body.subscriptions : [];
	writeSession(CACHE_KEY, JSON.stringify({ at: Date.now(), subscriptions }));
	return subscriptions;
}

/** The active trial that ends soonest, or null. Exported for tests. */
export function pickTrial(subscriptions) {
	const live = (subscriptions || []).filter((s) => s?.is_free_trial && s.status === 'Subscribed' && s.trial_ends_at);
	live.sort((a, b) => new Date(a.trial_ends_at) - new Date(b.trial_ends_at));
	return live[0] || null;
}

function formatDate(iso) {
	return new Date(iso).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** Banner copy for one trial subscription. Exported for tests. */
export function trialCopy(sub) {
	const days = Number(sub.trial_days_left);
	const when = days <= 0 ? 'ends today' : days === 1 ? 'ends tomorrow' : `has ${days} days left`;
	const plan = PLAN_LABEL[sub.plan] || sub.plan || sub.plan_id;
	const headline = `Your Microsoft free trial ${when}.`;
	if (sub.auto_renew === false) {
		return { headline, detail: `It ends ${formatDate(sub.trial_ends_at)}. Auto-renew is off, so it will not convert to a paid plan.` };
	}
	const target = sub.plan_price_label ? `the ${plan} plan at ${sub.plan_price_label}` : `the paid ${plan} plan`;
	return { headline, detail: `After ${formatDate(sub.trial_ends_at)} it converts to ${target}, billed by Microsoft.` };
}

function render(sub) {
	const { headline, detail } = trialCopy(sub);
	const el = document.createElement('section');
	el.className = 'ms-trial-banner';
	el.setAttribute('role', 'region');
	el.setAttribute('aria-label', 'Free trial');
	el.innerHTML = `
		<div class="ms-trial-banner__inner">
			<span class="ms-trial-banner__badge" aria-hidden="true">Free trial</span>
			<p class="ms-trial-banner__text"><strong></strong> <span></span></p>
			<div class="ms-trial-banner__actions">
				<a class="ms-trial-banner__link" target="_blank" rel="noopener noreferrer">Manage in Microsoft<span class="ms-trial-banner__sr"> (opens in a new tab)</span></a>
				<a class="ms-trial-banner__details" href="/microsoft/activate?subscription=${encodeURIComponent(sub.id)}">Details</a>
				<button type="button" class="ms-trial-banner__close" aria-label="Dismiss free trial notice for this session">
					<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
				</button>
			</div>
		</div>`;
	el.querySelector('strong').textContent = headline;
	el.querySelector('.ms-trial-banner__text span').textContent = detail;
	el.querySelector('.ms-trial-banner__link').href = sub.manage_url;
	el.querySelector('.ms-trial-banner__close').addEventListener('click', () => {
		writeSession(DISMISS_KEY, '1');
		el.classList.add('is-leaving');
		const remove = () => el.remove();
		el.addEventListener('transitionend', remove, { once: true });
		// Reduced motion has no transition to wait for.
		if (matchMedia('(prefers-reduced-motion: reduce)').matches) remove();
	});
	return el;
}

function insert(el) {
	const nav = document.getElementById('nav-container');
	if (nav?.parentNode) nav.parentNode.insertBefore(el, nav.nextSibling);
	else document.body.prepend(el);
}

export async function mountTrialBanner() {
	if (document.querySelector('.ms-trial-banner')) return;
	if (readSession(DISMISS_KEY) === '1') return;
	if (SKIP_PATHS.some((p) => location.pathname.startsWith(p))) return;
	const sub = pickTrial(await loadSubscriptions());
	if (!sub) return;
	insert(render(sub));
}
