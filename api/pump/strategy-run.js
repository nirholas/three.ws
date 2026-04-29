// POST /api/pump/strategy-run  (Server-Sent Events)
//
// Body:
//   strategy:    <spec>                     required
//   durationSec: number                     5..600
//   mode:        'simulate' | 'live'        default 'simulate'
//   agentId:     string                     required when mode='live'
//   network:     'mainnet' | 'devnet'       default 'mainnet'
//
// In 'simulate' mode the read-only pump-fun MCP is queried for real holder /
// curve / creator data, but trades are not signed (a SIMULATED:* sig is
// returned so the orchestrator state machine still progresses). This is a
// genuine dry-run against live chain state.
//
// In 'live' mode the caller must own an agent identity with a provisioned
// Solana wallet (see /api/agents/:id/solana). The encrypted secret is loaded
// server-side and used to actually sign + send buys/sells via the
// pump-fun-trade skill.
//
// Each scan/exit/entry decision is streamed as it happens via SSE. A final
// `event: done` carries the summary.

import { sql } from '../_lib/db.js';
import { getSessionUser, authenticateBearer, extractBearer } from '../_lib/auth.js';
import { cors, method, error, readJson } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { makeRuntime } from '../_lib/skill-runtime.js';
import { loadWallet } from '../_lib/solana-wallet.js';
import { checkBuyAllowed } from '../_lib/agent-spend-policy.js';

const RPC = {
	mainnet: process.env.SOLANA_MAINNET_RPC || 'https://api.mainnet-beta.solana.com',
	devnet: process.env.SOLANA_DEVNET_RPC || 'https://api.devnet.solana.com',
};

async function resolveAuth(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id };
	const bearer = await authenticateBearer(extractBearer(req));
	if (bearer) return { userId: bearer.userId };
	return null;
}

async function loadAgentWallet(agentId, userId) {
	const [row] = await sql`
		SELECT user_id, meta FROM agent_identities
		WHERE id = ${agentId} AND deleted_at IS NULL
	`;
	if (!row) throw Object.assign(new Error('agent not found'), { status: 404 });
	if (row.user_id !== userId) throw Object.assign(new Error('not your agent'), { status: 403 });
	const enc = row.meta?.encrypted_solana_secret;
	if (!enc) throw Object.assign(new Error('agent has no solana wallet — provision via /api/agents/:id/solana'), { status: 409 });
	const wallet = await loadWallet(enc);
	return { wallet, address: wallet.publicKey.toBase58(), meta: row.meta };
}

export default async function handler(req, res) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	let body;
	try { body = await readJson(req); }
	catch (e) { return error(res, 400, 'validation_error', e.message); }

	if (!body?.strategy) return error(res, 400, 'validation_error', 'strategy required');
	const durationSec = Math.max(5, Math.min(600, Number(body.durationSec) || 30));
	const mode = body.mode === 'live' ? 'live' : 'simulate';
	const network = body.network === 'devnet' ? 'devnet' : 'mainnet';

	let wallet = null, walletAddress = null, agentMeta = null;
	if (mode === 'live') {
		const auth = await resolveAuth(req);
		if (!auth) return error(res, 401, 'unauthorized', 'sign in required for live mode');
		if (!body.agentId) return error(res, 400, 'validation_error', 'agentId required for live mode');
		try {
			const r = await loadAgentWallet(body.agentId, auth.userId);
			wallet = r.wallet;
			walletAddress = r.address;
			agentMeta = r.meta;
		} catch (e) {
			return error(res, e.status ?? 500, e.status === 409 ? 'conflict' : 'unauthorized', e.message);
		}
	}

	res.statusCode = 200;
	res.setHeader('content-type', 'text/event-stream');
	res.setHeader('cache-control', 'no-cache, no-transform');
	res.setHeader('connection', 'keep-alive');
	res.setHeader('access-control-allow-origin', '*');
	const send = (event, data) => {
		res.write(`event: ${event}\n`);
		res.write(`data: ${JSON.stringify(data)}\n\n`);
	};

	let aborted = false;
	req.on('close', () => { aborted = true; });

	const rt = makeRuntime({
		wallet,
		agentId: mode === 'live' ? body.agentId : undefined,
		signerAddress: walletAddress,
		configOverrides: {
			'pump-fun-trade': { rpc: RPC[network] },
			'solana-wallet': { rpc: RPC[network] },
		},
		onEvent: (e) => send('memory', e),
	});

	send('start', { durationSec, mode, network, walletAddress });

	const { runStrategy } = await import('../../examples/skills/pump-fun-strategy/handlers.js');
	const ctx = {
		skills: { invoke: rt.invoke },
		skillConfig: { defaultPollMs: Math.max(1500, Number(body.pollMs) || 3000) },
		memory: { note: (tag, value) => send('memory', { tag, value }) },
		wallet,
	};

	const policyGuard = mode === 'live'
		? async ({ mint, amountSol }) => {
			const block = await checkBuyAllowed({ agentId: body.agentId, meta: agentMeta, mint, solAmount: amountSol });
			return block ? { code: block.code, msg: block.msg } : null;
		}
		: null;

	const abortController = new AbortController();
	req.on('close', () => abortController.abort());

	try {
		const result = await runStrategy(
			{
				strategy: body.strategy,
				durationSec,
				simulate: mode === 'simulate',
				onLog: (entry) => { if (!aborted) send('log', entry); },
				policyGuard,
				abortSignal: abortController.signal,
			},
			ctx,
		);
		send('done', result.data);
	} catch (e) {
		send('error', { message: e.message });
	}
	res.end();
}
