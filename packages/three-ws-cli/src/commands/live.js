// Live state from the terminal. Read-only: nothing here signs or moves funds.
//
//   three-ws agent status [id|name]   each agent's wallet balance, page and body
//   three-ws team [list]              your specialist teams
//   three-ws team status <id|name>    one team: roster, wallets, findings, last error
//
// Backed by GET /api/agents, POST /api/agents/balances (real on-chain valuation,
// cached 60s server side) and GET /api/teams[/:id].

import { c, line, rows, sym, printJson, shortAddress } from '../ui.js';
import { bearerFor } from '../oauth.js';
import { requestJson, ApiError } from '../http.js';

async function authed(ctx) {
	const bearer = await bearerFor(ctx.env, { origin: ctx.origin });
	if (!bearer) throw new ApiError('sign in first: `npx three-ws login` (or set THREE_WS_API_KEY)', { code: 'login_required' });
	return { authorization: `Bearer ${bearer}` };
}

const ago = (iso) => {
	if (!iso) return 'never';
	const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
	if (secs < 90) return `${secs}s ago`;
	if (secs < 5400) return `${Math.round(secs / 60)}m ago`;
	if (secs < 129600) return `${Math.round(secs / 3600)}h ago`;
	return `${Math.round(secs / 86400)}d ago`;
};

const money = (n, digits = 2) => (Number.isFinite(n) ? n.toFixed(digits) : '?');

function pick(list, key, label) {
	if (!key) return list;
	const k = key.toLowerCase();
	const hit = list.filter((x) => x.id === key || x.id.startsWith(key) || String(x.name || '').toLowerCase() === k);
	if (!hit.length) throw new Error(`no ${label} "${key}" on this account. Run without an argument to list them.`);
	if (hit.length > 1) throw new Error(`"${key}" matches ${hit.length} ${label}s (${hit.map((h) => h.id.slice(0, 8)).join(', ')}). Use an id.`);
	return hit;
}

export async function agentStatus(ctx) {
	const headers = await authed(ctx);
	const { agents = [] } = await requestJson(`${ctx.origin}/api/agents`, { headers });
	const chosen = pick(agents, ctx.positionals[0], 'agent');
	const ids = chosen.map((a) => a.id);
	const balances = ids.length
		? (await requestJson(`${ctx.origin}/api/agents/balances`, { method: 'POST', headers, json: { ids } })).data || {}
		: {};
	const view = chosen.map((a) => {
		const b = balances[a.id] || {};
		return {
			id: a.id,
			name: a.name,
			page: `${ctx.origin}/agents/${a.id}`,
			has_body: Boolean(a.avatar_id),
			wallet: a.solana_address || null,
			wallet_ready: a.walletReady ?? null,
			sol: b.sol ?? null,
			usdc: b.usdc ?? null,
			usd: b.usd ?? null,
			pnl_24h: b.pnl ?? null,
		};
	});
	if (ctx.flags.json) {
		printJson({ agents: view });
		return 0;
	}
	if (!view.length) {
		line('No agents on this account yet.');
		line(c.dim('  Create one: npx three-ws create "Nova"'));
		return 0;
	}
	for (const a of view) {
		line(`${c.bold(a.name)} ${c.dim(a.id)}`);
		rows([
			['Page', c.cyan(a.page)],
			['Body', a.has_body ? 'has a 3D avatar' : c.yellow('none yet; add one on its page')],
			['Wallet', a.wallet ? `${shortAddress(a.wallet)} ${a.wallet_ready === false ? c.yellow('(preparing)') : ''}` : c.dim('none')],
			['Balance', a.usd == null ? c.dim('not priced yet') : `${money(a.sol, 4)} SOL, ${money(a.usdc)} USDC, about $${money(a.usd)}`],
		], '  ');
		line('');
	}
	return 0;
}

export async function team(ctx) {
	const [sub, ...rest] = ctx.positionals;
	const headers = await authed(ctx);
	const get = (path) => requestJson(`${ctx.origin}${path}`, { headers }).catch((err) => {
		if (err.status === 404) throw new ApiError(`${ctx.origin} does not serve teams yet. Try without --origin, or update.`, { status: 404 });
		throw err;
	});
	const { data: teams = [] } = await get('/api/teams');

	if (!sub || sub === 'list') {
		if (ctx.flags.json) {
			printJson({ teams });
			return 0;
		}
		if (!teams.length) {
			line('No teams yet.');
			line(c.dim(`  Create one at ${ctx.origin}/teams`));
			return 0;
		}
		for (const t of teams) {
			line(`${c.bold(t.name)} ${c.dim(t.id)}  ${t.status}, ${t.network}, ${t.member_count} members, last finding ${ago(t.last_finding_at)}`);
			line(`  ${c.dim(t.roster.map((r) => `${r.role}: ${r.name}`).join('  '))}`);
		}
		return 0;
	}

	const key = sub === 'status' ? rest[0] : sub;
	const [match] = pick(teams, key, 'team');
	if (!match) throw new Error('usage: three-ws team status <id|name>');
	const { data: t } = await get(`/api/teams/${match.id}`);
	if (ctx.flags.json) {
		printJson({ team: t });
		return 0;
	}
	line(`${c.bold(t.name)} ${c.dim(t.id)}`);
	rows([
		['Status', `${t.status} on ${t.network}`],
		['Page', c.cyan(`${ctx.origin}${t.page_url}`)],
		['Findings', `${t.findings.total} total, ${t.findings.last_24h} in the last 24h, latest ${ago(t.findings.last_at)}`],
		...(t.trader_balance_sol != null ? [['Trader wallet', `${money(t.trader_balance_sol, 4)} SOL`]] : []),
		...(t.missing_roles.length ? [['Missing', c.yellow(`${t.missing_roles.join(', ')}; repair at ${ctx.origin}${t.page_url}`)]] : []),
		...(t.last_error ? [['Last error', c.red(t.last_error)]] : []),
	], '  ');
	line('');
	for (const m of t.members) {
		const a = m.agent || {};
		line(`  ${c.green(sym.ok)} ${String(m.role).padEnd(11)} ${a.name || m.agent_id}  ${c.dim(a.wallet ? shortAddress(a.wallet) : '')}`);
	}
	return 0;
}
