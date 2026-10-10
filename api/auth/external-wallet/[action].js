// External wallets proved by a signed message. Dispatches on
// ?action=challenge|verify. Library: api/_lib/account-link/external-wallets.js.
//
//   challenge  POST {chain: solana|evm, address, role: owner|payout, agent_id?}
//              returns the Sign-In with Solana or Sign-In with Ethereum
//              message to sign, carrying a single-use nonce bound to the
//              caller's account and this origin.
//   verify     POST {chain, message, signature, password?} proves the wallet.
//              role owner  attaches a sign-in wallet to the account.
//              role payout sets where an agent's earnings go. The first one
//              is live at once. Replacing one from a session needs step-up
//              (password in the body, or a fresh re-authentication) and takes
//              effect after the cooldown; from an API key or MCP tool it
//              files an approval the owner decides.
//
// Callers: a signed-in session (CSRF checked) or a bearer with wallet:write;
// a bearer is always the agent actor, so it can never skip the approval.
// Nothing here signs anything or moves funds.

import { sql } from '../../_lib/db.js';
import { getRequestUser, hasScope } from '../../_lib/auth.js';
import { requireCsrf } from '../../_lib/csrf.js';
import { cors, method, wrap, error, json, readJson, rateLimited } from '../../_lib/http.js';
import { limits } from '../../_lib/rate-limit.js';
import {
	ExternalWalletError, issueWalletChallenge, verifyWalletProof, attachOwnerWallet, setPayoutWallet, stepUpProven, PAYOUT_COOLDOWN_HOURS,
} from '../../_lib/account-link/external-wallets.js';

function fail(res, err) {
	if (err instanceof ExternalWalletError) return error(res, err.status, err.code, err.message, err.extra);
	throw err;
}

async function callerOrFail(req, res) {
	const user = await getRequestUser(req, res);
	if (!user) {
		error(res, 401, 'unauthorized', 'sign in or send an API key with wallet:write');
		return null;
	}
	if (user.source === 'bearer') {
		if (!hasScope(user.scope, 'wallet:write')) {
			error(res, 403, 'insufficient_scope', 'this key needs the wallet:write scope', { required: 'wallet:write' });
			return null;
		}
	} else if (!(await requireCsrf(req, res, user.id))) {
		return null;
	}
	const rl = await limits.externalWalletUser(user.id);
	if (!rl.success) {
		rateLimited(res, rl);
		return null;
	}
	return user;
}

async function handleChallenge(req, res) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;
	const user = await callerOrFail(req, res);
	if (!user) return;
	const body = (await readJson(req)) || {};
	try {
		let agentName = null;
		if (body.agent_id) {
			const [agent] = await sql`select name from agent_identities where id = ${body.agent_id} and user_id = ${user.id} and deleted_at is null limit 1`;
			if (!agent) return error(res, 404, 'agent_not_found', 'agent not found');
			agentName = agent.name;
		}
		const challenge = await issueWalletChallenge({ userId: user.id, chain: body.chain, address: body.address, role: body.role, agentId: body.agent_id || null, agentName });
		return json(res, 200, challenge);
	} catch (err) {
		return fail(res, err);
	}
}

async function handleVerify(req, res) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;
	const user = await callerOrFail(req, res);
	if (!user) return;
	const body = (await readJson(req)) || {};
	try {
		const proof = await verifyWalletProof({ userId: user.id, chain: body.chain, message: body.message, signature: body.signature });
		if (proof.role === 'owner') {
			if (user.source === 'bearer') return error(res, 403, 'session_required', 'a sign-in wallet is attached from a signed-in session, not an API key');
			return json(res, 200, { role: 'owner', ...(await attachOwnerWallet({ userId: user.id, chain: body.chain, address: proof.address, req })) });
		}
		const actor = user.source === 'bearer' ? 'agent' : 'owner';
		const stepUp = actor === 'owner' ? await stepUpProven(req, user.id, body) : false;
		const result = await setPayoutWallet({
			userId: user.id, agentId: proof.agentId, chain: body.chain, address: proof.address, signatureHash: proof.signatureHash, actor, stepUp, req,
		});
		return json(res, 200, { role: 'payout', cooldown_hours: PAYOUT_COOLDOWN_HOURS, ...result });
	} catch (err) {
		return fail(res, err);
	}
}

const DISPATCH = { challenge: handleChallenge, verify: handleVerify };

export default wrap(async (req, res) => {
	const action = req.query?.action ?? new URL(req.url, 'http://x').pathname.split('/').pop();
	const fn = DISPATCH[action];
	if (!fn) return error(res, 404, 'not_found', `unknown external wallet action: ${action}`);
	return fn(req, res);
});
