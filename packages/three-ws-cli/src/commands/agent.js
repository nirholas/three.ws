// `three-ws create` and `three-ws launch`: an agent and its coin from the terminal.
//
// create  POSTs /api/agents with the stored credential. The server mints the
//         agent's own Solana wallet in that request; nothing here touches keys.
// launch  never spends from the terminal. Launching signs with the agent's
//         custodial wallet, which three.ws only allows from a same-site browser
//         session, so this collects the coin details and opens /launch with them
//         filled in: the owner reviews the cost there and signs it themselves.
//         With --intent it instead creates a funded launch intent through
//         POST /api/pump/launch-intents (quote asset, creator fee, every fee line
//         and the quote's expiry come back), opens the intent page where the
//         funding and the final yes happen, and polls the stages. The bearer
//         token this CLI holds can create and poll an intent; the server refuses
//         it on the pay and confirm steps (403 session_required) by design.
// launch status <id>  polls one intent's stages (quote, paid, submitted,
//         confirmed, indexed) until it settles.

import * as p from '@clack/prompts';
import { answer, canPrompt, signIn } from './common.js';
import { c, line, rows, sym, printJson, shortAddress } from '../ui.js';
import { bearerFor } from '../oauth.js';
import { requestJson, ApiError } from '../http.js';
import { openBrowser } from '../browser.js';

const NAME_MAX = 100;
const DESCRIPTION_MAX = 500;
const COIN_NAME_MAX = 32;
const SYMBOL_MAX = 10;
const COIN_DESCRIPTION_MAX = 500;

/** A bearer for the signed-in account, signing in first when a prompt is allowed. */
async function requireBearer(ctx) {
	let bearer = await bearerFor(ctx.env, { origin: ctx.origin });
	if (bearer) return bearer;
	if (!canPrompt(ctx)) throw new ApiError('sign in first: `npx three-ws login` (or pass --key / set THREE_WS_API_KEY)');
	await signIn(ctx, {});
	bearer = await bearerFor(ctx.env, { origin: ctx.origin });
	if (!bearer) throw new ApiError('sign-in did not complete; run `npx three-ws login`');
	return bearer;
}

async function ask(ctx, { flag, message, placeholder, max, required = true, validate }) {
	const given = typeof flag === 'string' ? flag.trim() : '';
	if (given) {
		const err = validate?.(given);
		if (err) throw new Error(err);
		return given.slice(0, max);
	}
	if (!canPrompt(ctx)) {
		if (required) throw new Error(`${message.toLowerCase()} is required (pass it as a flag)`);
		return '';
	}
	const value = answer(await p.text({
		message,
		placeholder,
		validate: (v) => {
			const s = String(v || '').trim();
			if (required && !s) return 'Required.';
			if (s.length > max) return `At most ${max} characters.`;
			return validate?.(s);
		},
	}));
	return String(value || '').trim();
}

async function listAgents(ctx, bearer) {
	const data = await requestJson(`${ctx.origin}/api/agents`, { headers: { authorization: `Bearer ${bearer}` } });
	return Array.isArray(data?.agents) ? data.agents : [];
}

export async function create(ctx) {
	const { flags, positionals } = ctx;
	const bearer = await requireBearer(ctx);
	if (canPrompt(ctx)) p.intro(`${c.bold('three.ws')} create an agent`);

	const name = await ask(ctx, {
		flag: flags.name || positionals[0],
		message: 'Agent name',
		placeholder: 'Nova',
		max: NAME_MAX,
	});
	const description = await ask(ctx, {
		flag: flags.description,
		message: 'What does it do? (shown on its page and in search)',
		placeholder: 'A deep-space guide who explains orbital mechanics in plain language.',
		max: DESCRIPTION_MAX,
		required: false,
	});

	const body = { name, ...(description ? { description } : {}), ...(flags.avatar ? { avatar_id: flags.avatar } : {}) };
	let agent;
	try {
		const res = await requestJson(`${ctx.origin}/api/agents`, {
			method: 'POST',
			headers: { authorization: `Bearer ${bearer}` },
			json: body,
			timeoutMs: 60_000,
		});
		agent = res.agent;
	} catch (err) {
		// A name that impersonates an existing public agent is refused on purpose.
		if (err instanceof ApiError && err.status === 409) {
			const reason = err.body?.integrity?.reasons?.[0] || err.message;
			throw new ApiError(`three.ws refused that name: ${reason}. Pick a distinct name and run create again.`, { status: 409, code: 'identity_conflict' });
		}
		throw err;
	}

	const page = `${ctx.origin}/agents/${agent.id}`;
	if (flags.json) {
		printJson({ agent: { id: agent.id, name: agent.name, solana_address: agent.solana_address, wallet_ready: agent.walletReady ?? null }, page });
		return 0;
	}
	if (canPrompt(ctx)) p.outro(`${c.green(sym.ok)} ${c.bold(agent.name)} is live`);
	else line(`${c.green(sym.ok)} ${c.bold(agent.name)} is live`);
	rows([
		['Page', c.cyan(page)],
		['Agent id', agent.id],
		['Solana wallet', agent.solana_address ? `${agent.solana_address} ${c.dim(`(${shortAddress(agent.solana_address)})`)}` : c.dim('preparing; it appears on the agent page')],
	], '  ');
	line('');
	if (!agent.avatar_id) line(c.dim(`  Give it a 3D body on its page. A body is also what a coin launch shows.`));
	line(c.dim(`  Launch its coin: npx three-ws launch --agent ${agent.id}`));
	return 0;
}

export async function launch(ctx) {
	const { flags } = ctx;
	if (ctx.positionals[0] === 'status') return launchStatus({ ...ctx, positionals: ctx.positionals.slice(1) });
	const bearer = await requireBearer(ctx);
	const interactive = canPrompt(ctx);
	if (flags.intent || flags.quote || flags['creator-fee'] || flags.network) return launchIntent(ctx, bearer, interactive);
	if (interactive) p.intro(`${c.bold('three.ws')} launch a coin`);

	// /launch picks the launching agent by its 3D body, so only agents with one
	// can be preselected there.
	const agents = await listAgents(ctx, bearer);
	let agent = null;
	if (flags.agent) {
		agent = agents.find((a) => a.id === flags.agent || a.avatar_id === flags.agent);
		if (!agent) throw new Error(`no agent ${flags.agent} on this account. \`npx three-ws create\` makes one.`);
	} else if (!agents.length) {
		throw new Error('this account has no agents yet. Run `npx three-ws create` first.');
	} else if (agents.length === 1 || !interactive) {
		[agent] = agents.filter((a) => a.avatar_id).concat(agents);
	} else {
		agent = answer(await p.select({
			message: 'Which agent launches it?',
			options: agents.map((a) => ({
				value: a,
				label: a.name,
				hint: a.avatar_id ? (a.token?.mint ? 'already has a coin' : undefined) : 'no 3D body yet',
			})),
		}));
	}
	if (!agent.avatar_id) {
		throw new Error(`${agent.name} has no 3D body yet, and /launch picks the launching agent by its body. Give it one at ${ctx.origin}/agents/${agent.id}, then run launch again.`);
	}
	if (agent.token?.mint && !flags.json) {
		line(c.yellow(`  ${agent.name} already launched ${agent.token.symbol ? `$${agent.token.symbol}` : 'a coin'} (${agent.token.mint}).`));
	}

	const coinName = await ask(ctx, { flag: flags.name, message: 'Coin name', placeholder: agent.name, max: COIN_NAME_MAX });
	const symbol = (await ask(ctx, {
		flag: flags.symbol,
		message: 'Ticker',
		placeholder: coinName.replace(/[^A-Za-z0-9]/g, '').slice(0, 5).toUpperCase(),
		max: SYMBOL_MAX,
		validate: (s) => (/^[A-Za-z0-9]+$/.test(s) ? undefined : 'Letters and digits only.'),
	})).toUpperCase();
	const description = await ask(ctx, {
		flag: flags.description,
		message: 'Coin description (optional)',
		max: COIN_DESCRIPTION_MAX,
		required: false,
	});
	const image = await ask(ctx, {
		flag: flags.image,
		message: 'Image URL (optional; the agent\'s portrait is used when blank)',
		max: 2000,
		required: false,
		validate: (s) => (/^https:\/\//.test(s) ? undefined : 'Use an https:// URL.'),
	});
	const initialBuy = flags['initial-buy'] ? Number(flags['initial-buy']) : 0;
	if (!Number.isFinite(initialBuy) || initialBuy < 0) throw new Error('--initial-buy must be a SOL amount of 0 or more');

	const url = new URL('/launch', ctx.origin);
	url.searchParams.set('avatar', agent.avatar_id);
	url.searchParams.set('name', coinName);
	url.searchParams.set('symbol', symbol);
	if (description) url.searchParams.set('description', description);
	if (image) url.searchParams.set('image', image);
	if (initialBuy > 0) url.searchParams.set('initialBuy', String(initialBuy));

	if (flags.json) {
		printJson({ agent: { id: agent.id, name: agent.name }, coin: { name: coinName, symbol, description: description || null, image: image || null, initial_buy_sol: initialBuy }, review_url: url.toString() });
		return 0;
	}

	rows([
		['Agent', agent.name],
		['Coin', `${coinName} ($${symbol})`],
		['Initial buy', initialBuy > 0 ? `${initialBuy} SOL` : 'none'],
	], '  ');
	line('');
	const opened = await openBrowser(url.toString(), { env: ctx.env.vars });
	line(`  ${opened ? 'Opened' : 'Open'} ${c.cyan(url.toString())}`);
	line(c.dim('  Nothing is paid from the terminal. Review the cost on that page and sign the launch there.'));
	if (interactive) p.outro('Finish the launch in your browser.');
	return 0;
}

// ── funded launch intents ─────────────────────────────────────────────────────

const INTENT_POLL_MS = 5000;
const INTENT_POLL_MAX_MS = 30 * 60 * 1000;
const SETTLED_STAGES = new Set(['indexed', 'failed', 'expired']);

function intentUrl(ctx, intent) {
	return new URL(intent.links?.page || `/launch/intents/${intent.id}`, ctx.origin).toString();
}

function money(n, symbol) {
	if (n == null) return 'unknown';
	const v = Number(n);
	const digits = symbol === 'SOL' ? 4 : 2;
	return `${v.toLocaleString('en-US', { maximumFractionDigits: digits })} ${symbol}`;
}

function stageLine(intent) {
	return (intent.stages || []).map((s) => (s.done ? c.green(`${sym.ok} ${s.label}`) : s.current ? c.cyan(`${sym.arrow} ${s.label}`) : c.dim(`  ${s.label}`))).join(c.dim('  ·  '));
}

function printIntent(ctx, intent) {
	const q = intent.quote || {};
	const asset = intent.quote_asset?.symbol || 'SOL';
	const fee = intent.creator_fee || {};
	rows([
		['Intent', intent.id],
		['Agent', intent.agent?.name || intent.agent?.id || 'unknown'],
		['Coin', `${intent.name} ($${intent.symbol})`],
		['Network', intent.network],
		['Quote asset', asset],
		['Initial buy', Number(intent.initial_buy) > 0 ? money(intent.initial_buy, asset) : 'none'],
		['Creator fee', `${fee.bps} bps (${fee.percent}%)${fee.configurable ? ` of ${fee.min_bps}-${fee.max_bps}` : ', fixed by the program'}`],
		['Stage', intent.stage + (intent.error ? c.red(`  ${intent.error}`) : '')],
	], '  ');
	if (Array.isArray(q.lines) && q.lines.length) {
		line('');
		line(c.bold('  Quote'));
		for (const l of q.lines) line(`    ${l.label.padEnd(28)} ${money(l.amount, l.asset || asset)}${l.included ? c.dim('  (in the buy)') : ''}`);
		if (q.totals) {
			for (const [k, v] of Object.entries(q.totals)) if (v != null && typeof v !== 'object') line(`    ${c.bold(k.replace(/_/g, ' ').padEnd(28))} ${typeof v === 'number' ? money(v, /usd/i.test(k) ? 'USD' : asset) : v}`);
		}
		if (q.expires_at) line(c.dim(`    quote ${q.expired ? 'expired' : 'expires'} ${new Date(q.expires_at).toLocaleString()}`));
	}
	if (intent.funding?.address) {
		line('');
		line(`  Fund ${c.cyan(intent.funding.address)} with ${money(intent.funding.required, asset)}${intent.funding.paid ? c.green('  paid') : ''}`);
	}
	if (intent.launch?.signature) {
		line('');
		rows([
			['Mint', intent.mint],
			['Launch tx', intent.launch.signature],
			['pump.fun', intent.launch.pumpfun_url],
			['three.ws', intent.launch.launch_url ? new URL(intent.launch.launch_url, ctx.origin).toString() : null],
		].filter(([, v]) => v), '  ');
	}
	line('');
	line(`  ${stageLine(intent)}`);
}

async function fetchIntent(ctx, bearer, id) {
	return requestJson(new URL(`/api/pump/launch-intents/${encodeURIComponent(id)}?balance=0`, ctx.origin), { headers: { authorization: bearer } });
}

/** Poll one intent until it settles or the stage stops moving for INTENT_POLL_MAX_MS. */
async function pollIntent(ctx, bearer, id, { interactive, from }) {
	let last = from?.stage || null;
	const started = Date.now();
	const spin = interactive ? p.spinner() : null;
	spin?.start(`Waiting on ${last || 'the intent'}. Finish the funding and the yes in your browser.`);
	let intent = from;
	while (Date.now() - started < INTENT_POLL_MAX_MS) {
		await new Promise((r) => setTimeout(r, INTENT_POLL_MS));
		({ intent } = await fetchIntent(ctx, bearer, id));
		if (intent.stage !== last) {
			last = intent.stage;
			if (spin) spin.message(`Stage: ${intent.stage}`);
			else line(`  stage: ${intent.stage}`);
		}
		if (SETTLED_STAGES.has(intent.stage)) break;
	}
	spin?.stop(SETTLED_STAGES.has(intent.stage) ? `Intent ${intent.stage}.` : 'Still in progress. `npx three-ws launch status <id>` picks it back up.');
	return intent;
}

async function launchIntent(ctx, bearer, interactive) {
	const { flags } = ctx;
	if (interactive) p.intro(`${c.bold('three.ws')} funded coin launch`);
	const agents = await listAgents(ctx, bearer);
	let agent = null;
	if (flags.agent) {
		agent = agents.find((a) => a.id === flags.agent || a.avatar_id === flags.agent);
		if (!agent) throw new Error(`no agent ${flags.agent} on this account. \`npx three-ws create\` makes one.`);
	} else if (!agents.length) {
		throw new Error('this account has no agents yet. Run `npx three-ws create` first.');
	} else if (agents.length === 1 || !interactive) {
		[agent] = agents;
	} else {
		agent = answer(await p.select({ message: 'Which agent launches it?', options: agents.map((a) => ({ value: a, label: a.name })) }));
	}

	const network = (flags.network || 'mainnet').toLowerCase();
	if (!['mainnet', 'devnet'].includes(network)) throw new Error('--network must be mainnet or devnet');
	const pairsRes = await requestJson(new URL(`/api/pump/pairs?network=${network}`, ctx.origin), { headers: { authorization: bearer } });
	const pairs = (pairsRes.pairs || []).filter((x) => x.status === 'live' || x.status === 'unknown');
	if (!pairs.length) throw new Error(`no launch pair is live on ${network} right now`);
	let pair = null;
	if (flags.quote) {
		const want = flags.quote.toLowerCase();
		pair = pairs.find((x) => x.id === want || x.symbol?.toLowerCase() === want || x.mint === flags.quote);
		if (!pair) throw new Error(`--quote must be one of ${pairs.map((x) => x.id).join(', ')} on ${network}`);
	} else if (pairs.length === 1 || !interactive) {
		pair = pairs.find((x) => x.id === 'sol') || pairs[0];
	} else {
		pair = answer(await p.select({
			message: 'Pay for the launch and the first buy in',
			options: pairs.map((x) => ({ value: x, label: x.symbol, hint: x.creator_fee?.configurable ? `creator fee ${x.creator_fee.min_bps}-${x.creator_fee.max_bps} bps` : `creator fee fixed at ${x.creator_fee?.fixed_bps ?? x.fees?.creator_bps} bps` })),
		}));
	}

	const coinName = await ask(ctx, { flag: flags.name, message: 'Coin name', placeholder: agent.name, max: COIN_NAME_MAX });
	const symbol = (await ask(ctx, {
		flag: flags.symbol,
		message: 'Ticker',
		placeholder: coinName.replace(/[^A-Za-z0-9]/g, '').slice(0, 5).toUpperCase(),
		max: SYMBOL_MAX,
		validate: (s) => (/^[A-Za-z0-9]+$/.test(s) ? undefined : 'Letters and digits only.'),
	})).toUpperCase();
	const description = await ask(ctx, { flag: flags.description, message: 'Coin description (optional)', max: COIN_DESCRIPTION_MAX, required: false });
	const image = await ask(ctx, {
		flag: flags.image,
		message: 'Image URL (optional; the agent\'s portrait is used when blank)',
		max: 2000,
		required: false,
		validate: (s) => (/^https:\/\//.test(s) ? undefined : 'Use an https:// URL.'),
	});
	const initialBuy = flags['initial-buy'] ? Number(flags['initial-buy']) : 0;
	if (!Number.isFinite(initialBuy) || initialBuy < 0) throw new Error(`--initial-buy must be a ${pair.symbol} amount of 0 or more`);

	const rule = pair.creator_fee || {};
	let creatorFeeBps = null;
	if (flags['creator-fee'] != null) {
		creatorFeeBps = Number(flags['creator-fee']);
		if (!Number.isInteger(creatorFeeBps)) throw new Error('--creator-fee is a whole number of basis points (100 = 1%)');
		if (rule.configurable && (creatorFeeBps < rule.min_bps || creatorFeeBps > rule.max_bps)) throw new Error(`--creator-fee must be between ${rule.min_bps} and ${rule.max_bps} bps on ${pair.symbol}`);
	} else if (rule.configurable && interactive) {
		creatorFeeBps = Number(answer(await p.text({
			message: `Creator fee in bps (${rule.min_bps}-${rule.max_bps}; ${rule.default_bps} = ${(rule.default_bps / 100).toFixed(2)}% of every trade goes to ${agent.name})`,
			placeholder: String(rule.default_bps),
			defaultValue: String(rule.default_bps),
			validate: (v) => (/^\d+$/.test(v) && Number(v) >= rule.min_bps && Number(v) <= rule.max_bps ? undefined : `A whole number from ${rule.min_bps} to ${rule.max_bps}.`),
		})));
	}

	const body = {
		agent_id: agent.id,
		name: coinName,
		symbol,
		description: description || undefined,
		image_url: image || undefined,
		quote: pair.id,
		initial_buy: initialBuy,
		network,
		creator_fee_bps: creatorFeeBps ?? undefined,
	};
	let created;
	try {
		created = await requestJson(new URL('/api/pump/launch-intents', ctx.origin), { method: 'POST', headers: { authorization: bearer }, json: body });
	} catch (err) {
		if (err instanceof ApiError && err.body?.message) throw new Error(`${err.body.code || 'error'}: ${err.body.message}`);
		throw err;
	}
	const { intent, preflight_token: preflightToken } = created;
	const url = intentUrl(ctx, intent);

	if (flags.json) {
		printJson({ intent, preflight_token: preflightToken, page: url, status_command: `npx three-ws launch status ${intent.id}` });
		return 0;
	}

	printIntent(ctx, intent);
	line('');
	line(`  Preflight token (paste it on the page if asked; it is shown once): ${c.yellow(preflightToken)}`);
	const earn = intent.creator_fee?.earnings;
	if (Array.isArray(earn?.scenarios) && earn.scenarios.length) {
		line(c.dim(`  At ${intent.creator_fee.bps} bps, ${agent.name} earns ${earn.scenarios.map((s) => `${money(s.earnings, s.quote || pair.symbol)} on ${money(s.volume, s.quote || pair.symbol)} traded`).join('; ')}.`));
	}
	line('');
	const opened = await openBrowser(url, { env: ctx.env.vars });
	line(`  ${opened ? 'Opened' : 'Open'} ${c.cyan(url)}`);
	line(c.dim('  Nothing is paid from the terminal. Fund the agent wallet and give the final yes on that page; this command only watches the stages.'));
	if (!interactive) return 0;
	const settled = await pollIntent(ctx, bearer, intent.id, { interactive, from: intent });
	printIntent(ctx, settled);
	p.outro(settled.stage === 'indexed' ? 'Launched.' : settled.stage === 'failed' ? 'The launch failed; the reason is above.' : 'Come back with `npx three-ws launch status <id>`.');
	return settled.stage === 'failed' ? 1 : 0;
}

export async function launchStatus(ctx) {
	const [id] = ctx.positionals;
	if (!id) throw new Error('usage: three-ws launch status <intent-id> [--watch]');
	const bearer = await requireBearer(ctx);
	const interactive = canPrompt(ctx);
	let { intent } = await fetchIntent(ctx, bearer, id);
	if (ctx.flags.watch && !SETTLED_STAGES.has(intent.stage)) intent = await pollIntent(ctx, bearer, id, { interactive, from: intent });
	if (ctx.flags.json) {
		printJson(intent);
		return 0;
	}
	printIntent(ctx, intent);
	line('');
	line(`  ${c.cyan(intentUrl(ctx, intent))}`);
	return intent.stage === 'failed' ? 1 : 0;
}
