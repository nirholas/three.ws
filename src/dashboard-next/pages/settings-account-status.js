// Settings panels for the account at a glance and per-agent X posting.
//
//   GET /api/v1/me/status   plan, limits, what is left, agents, wallet, approvals waiting
//   GET /api/x/agents       every owned agent with its X connection and posting policy
//
// Both are the same data the get_account_status and configure_twitter_posting
// MCP tools return, so the page and a connected assistant never disagree.

import { esc, relTime } from '../api.js';
import { emptyStateHTML, errorStateHTML, attachRetry } from '../../shared/state-kit.js';

const fmt = (n) => (n == null ? '?' : Number(n).toLocaleString());

function panelShell(id, title, sub) {
	const panel = document.createElement('div');
	panel.className = 'dn-panel';
	panel.id = id;
	panel.setAttribute('aria-label', title);
	panel.innerHTML = `
		<div class="set-panel-head">
			<div>
				<div class="dn-panel-title">${esc(title)}</div>
				<div class="dn-panel-sub" style="margin:2px 0 0">${esc(sub)}</div>
			</div>
		</div>
		<div data-slot="body"></div>
	`;
	return panel;
}

function meter(label, remaining, limit, note) {
	const pct = limit > 0 ? Math.max(0, Math.min(100, Math.round((remaining / limit) * 100))) : 0;
	return `
		<div style="flex:1;min-width:220px">
			<div style="display:flex;justify-content:space-between;font-size:12.5px;color:var(--nxt-ink-fade)"><span>${esc(label)}</span><span>${fmt(remaining)} of ${fmt(limit)} left</span></div>
			<div role="progressbar" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" style="height:6px;border-radius:3px;background:var(--nxt-stroke);margin-top:6px;overflow:hidden"><div style="height:100%;width:${pct}%;background:var(--nxt-accent, currentColor)"></div></div>
			<div style="font-size:11.5px;color:var(--nxt-ink-fade);margin-top:4px">${esc(note)}</div>
		</div>`;
}

const linkBtn = (href, label) => `<a class="dn-btn" href="${esc(href)}" style="padding:5px 10px;font-size:12px">${esc(label)}</a>`;

export function renderAccountStatus(resp, onRetry) {
	const panel = panelShell('account-status', 'Account status', 'Your plan, what is left of it, and what is waiting for you. A connected assistant reads the same numbers with get_account_status.');
	const body = panel.querySelector('[data-slot="body"]');
	if (!resp.ok) {
		body.innerHTML = errorStateHTML({ title: "Couldn't load account status", body: 'We couldn’t reach the account service. Check your connection and try again.' });
		attachRetry(body, onRetry);
		return panel;
	}
	const s = resp.data;
	const reset = s.remaining.api_calls_reset_at ? `resets ${relTime(s.remaining.api_calls_reset_at)}` : '';
	body.innerHTML = `
		<div style="display:flex;gap:20px;flex-wrap:wrap;padding:6px 0 12px">
			${meter('API calls this period', s.remaining.api_calls, s.limits.api_calls_per_period, `${s.plan.api.name} plan, burst ${fmt(s.limits.burst_per_minute)}/min, ${fmt(s.limits.concurrent)} concurrent ${reset ? '· ' + reset : ''}`)}
			${meter('Free chat today', s.remaining.free_chat_messages, s.limits.free_chat_per_day, 'Resets at 00:00 UTC')}
		</div>
		<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;padding:10px 0;border-top:1px solid var(--nxt-stroke)">
			<div style="flex:1;min-width:200px;font-size:13px;color:var(--nxt-ink)">${fmt(s.agents.count)} agent${s.agents.count === 1 ? '' : 's'} · ${s.approvals.pending ? `<strong>${fmt(s.approvals.pending)} approval${s.approvals.pending === 1 ? '' : 's'} waiting</strong>` : 'nothing waiting for approval'}</div>
			${s.approvals.pending ? linkBtn(s.approvals.url, 'Review approvals') : ''}
			${linkBtn(s.plan.api.manage_url, 'Manage plan')}
		</div>
		${s.wallet?.provisioned ? `<div style="font-size:12.5px;color:var(--nxt-ink-fade);padding-top:8px;overflow-wrap:anywhere">Agent wallet <code>${esc(s.wallet.address)}</code>: ${fmt(s.wallet.balances.sol)} SOL, ${fmt(s.wallet.balances.usdc)} USDC. Autonomous spend ${s.wallet.spend_enabled ? 'on' : 'off'}.</div>` : ''}
	`;
	return panel;
}

export function renderXPosting(resp, onRetry) {
	const panel = panelShell('x-posting', 'X posting', 'Which X account each agent posts through and whether you approve each post first. Connect an account, then set the policy with configure_twitter_posting or on the agent page.');
	const body = panel.querySelector('[data-slot="body"]');
	if (!resp.ok) {
		body.innerHTML = errorStateHTML({ title: "Couldn't load X posting", body: 'We couldn’t reach the posting service. Check your connection and try again.' });
		attachRetry(body, onRetry);
		return panel;
	}
	const agents = resp.data?.agents || [];
	if (!agents.length) {
		body.innerHTML = emptyStateHTML({ icon: '', title: 'No agents yet', body: 'Create an agent first. Each agent can post from its own X account under a policy you control.', compact: true });
		return panel;
	}
	body.innerHTML = agents.map((a) => {
		const own = Boolean(a.account);
		const state = !a.policy_configured ? 'No policy' : a.enabled ? (a.review_before_post ? 'On, you approve each post' : 'On, posts go out directly') : 'Paused';
		return `
			<div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--nxt-stroke);flex-wrap:wrap" data-agent-id="${esc(a.id)}">
				<div style="flex:1;min-width:200px">
					<div style="font-size:13.5px;color:var(--nxt-ink);font-weight:500;overflow-wrap:anywhere">${esc(a.name)}</div>
					<div style="font-size:12px;color:var(--nxt-ink-fade);margin-top:3px">${own ? `@${esc(a.account.username || 'connected')}` : 'No X account of its own'} · ${esc(state)}${a.pending_reviews ? ` · <strong>${a.pending_reviews} waiting for review</strong>` : ''}</div>
				</div>
				${own ? '' : linkBtn(`/api/auth/x/connect?scope=full&return_to=%2Fsettings%2Fconnections&agent_id=${encodeURIComponent(a.id)}&target=agent`, 'Connect X')}
				${linkBtn(`/agent/${encodeURIComponent(a.id)}/edit#x`, 'Policy')}
			</div>`;
	}).join('');
	return panel;
}
