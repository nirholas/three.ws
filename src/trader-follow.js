/**
 * Follow control for a trader profile: a toggle that subscribes the signed-in
 * visitor to hot-streak pushes for this trader (api/sniper/follow.js).
 *
 * States: loading skeleton, signed-out (link to sign in, returning here),
 * follow / following (optimistic, rolled back on error), own agent (hidden),
 * and unavailable (the endpoint answers 503 until its migration is applied: the
 * control says so instead of pretending). Mutations go through the shared
 * client in src/api.js, the only place a CSRF token is minted.
 */

import { apiFetch } from './api.js';

const ENDPOINT = '/api/sniper/follow';
const HELP = 'Get notified when this trader goes on a hot streak';

function countLabel(n) {
	return `${n.toLocaleString('en-US')} ${n === 1 ? 'follower' : 'followers'}`;
}

/**
 * @param {HTMLElement|null} el
 * @param {{ agentId: string, name?: string, toast?: (msg: string) => void }} opts
 */
export async function mountTraderFollow(el, { agentId, name, toast = () => {} }) {
	if (!el || !agentId) return;
	el.classList.add('tf');
	el.innerHTML = '<span class="tp-sk" style="width:140px;height:32px;display:inline-block"></span>';

	let state;
	try {
		const res = await apiFetch(`${ENDPOINT}?agent_id=${encodeURIComponent(agentId)}`, {
			allowAnonymous: true,
			headers: { accept: 'application/json' },
		});
		if (res.status === 503) return renderUnavailable(el);
		if (!res.ok) return renderError(el, () => mountTraderFollow(el, { agentId, name, toast }));
		state = await res.json();
	} catch {
		return renderError(el, () => mountTraderFollow(el, { agentId, name, toast }));
	}
	if (state.is_owner) {
		el.hidden = true;
		return;
	}
	const signedIn = await hasSession();
	render(el, { agentId, name, toast, signedIn, following: !!state.following, count: state.follower_count | 0 });
}

async function hasSession() {
	try {
		const res = await fetch('/api/auth/me', { credentials: 'include', headers: { accept: 'application/json' } });
		if (!res.ok) return false;
		const body = await res.json();
		return Boolean(body?.user);
	} catch {
		return false;
	}
}

function render(el, ctx) {
	const { following, count, signedIn } = ctx;
	if (!signedIn) {
		const next = encodeURIComponent(location.pathname + location.search);
		el.innerHTML = `
			<a class="lb-btn tf-btn" href="/login?next=${next}">Sign in to follow</a>
			<span class="tf-count">${countLabel(count)}</span>
			<span class="tf-help">${HELP}</span>`;
		return;
	}
	el.innerHTML = `
		<button type="button" class="lb-btn tf-btn ${following ? 'is-following' : 'lb-btn-primary'}" aria-pressed="${following}">
			${following ? 'Following' : 'Follow'}
		</button>
		<span class="tf-count" aria-live="polite">${countLabel(count)}</span>
		<span class="tf-help">${HELP}</span>`;
	el.querySelector('.tf-btn').addEventListener('click', () => toggle(el, ctx));
}

async function toggle(el, ctx) {
	const btn = el.querySelector('.tf-btn');
	if (btn.disabled) return;
	const wasFollowing = ctx.following;
	const nextFollowing = !wasFollowing;
	const nextCount = Math.max(0, ctx.count + (nextFollowing ? 1 : -1));
	// Optimistic: show the new state now, restore the old one if the server refuses.
	render(el, { ...ctx, following: nextFollowing, count: nextCount });
	el.querySelector('.tf-btn').disabled = true;
	try {
		const res = nextFollowing
			? await apiFetch(ENDPOINT, {
				method: 'POST',
				headers: { accept: 'application/json', 'content-type': 'application/json' },
				body: JSON.stringify({ agent_id: ctx.agentId }),
			})
			: await apiFetch(`${ENDPOINT}?agent_id=${encodeURIComponent(ctx.agentId)}`, {
				method: 'DELETE',
				headers: { accept: 'application/json' },
			});
		if (!res.ok) throw Object.assign(new Error(String(res.status)), { status: res.status });
		const body = await res.json();
		render(el, { ...ctx, following: !!body.following, count: body.follower_count | 0 });
		ctx.toast(body.following
			? `Following ${ctx.name || 'this trader'}. You will hear about their hot streaks.`
			: `Unfollowed ${ctx.name || 'this trader'}.`);
	} catch (err) {
		render(el, ctx);
		ctx.toast(err?.status === 503
			? 'Following is not available yet. Try again shortly.'
			: `Could not ${nextFollowing ? 'follow' : 'unfollow'} ${(ctx.name || 'this trader')}. Check your connection and try again.`);
	}
}

function renderUnavailable(el) {
	el.innerHTML = '<span class="tf-help">Following traders is coming online shortly.</span>';
}

function renderError(el, retry) {
	el.innerHTML = '<button type="button" class="lb-btn tf-btn">Retry follow</button><span class="tf-help">Could not load follow status.</span>';
	el.querySelector('.tf-btn').addEventListener('click', retry);
}
