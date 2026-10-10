import { sql } from '../../_lib/db.js';
import { logAudit } from '../../_lib/audit.js';
import { ExternalWalletError, payoutChangePolicy, stepUpProven } from '../../_lib/account-link/external-wallets.js';
import { getSessionUser } from '../../_lib/auth.js';
import { cors, json, method, wrap, error, readJson, rateLimited } from '../../_lib/http.js';
import { parse, isValidSolanaAddress, isValidEvmAddress } from '../../_lib/validate.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { requireCsrf } from '../../_lib/csrf.js';
import { z } from 'zod';

const postBody = z.object({
	address: z.string().trim().min(1).max(100),
	chain: z.enum(['solana', 'base', 'evm']),
	agent_id: z.string().uuid().nullable().optional(),
	is_default: z.boolean().optional().default(false),
});

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'POST'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	if (req.method === 'GET') {
		const wallets = await sql`
			select id, agent_id, address, chain, is_default, created_at, approved_at, effective_at, set_by,
			       (approved_at is not null and effective_at <= now()) as live
			from agent_payout_wallets
			where user_id = ${user.id}
			order by created_at desc
		`;
		return json(res, 200, { wallets });
	}

	// POST — CSRF on state-changing session-cookie request.
	if (!(await requireCsrf(req, res, user.id))) return;

	const body = parse(postBody, await readJson(req));
	const { address, chain, agent_id = null, is_default } = body;

	if (chain === 'solana' && !isValidSolanaAddress(address)) {
		return error(res, 400, 'validation_error', 'invalid Solana address');
	}
	if ((chain === 'base' || chain === 'evm') && !isValidEvmAddress(address)) {
		return error(res, 400, 'validation_error', 'invalid EVM address');
	}

	// Verify agent_id belongs to this user if provided
	if (agent_id) {
		const [agent] = await sql`
			select id from agent_identities
			where id = ${agent_id} and user_id = ${user.id} and deleted_at is null
		`;
		if (!agent) return error(res, 404, 'not_found', 'agent not found');
	}

	// A default that replaces a live address goes through step-up and the
	// cooldown (api/_lib/account-link/external-wallets.js); a non-default row
	// is never paid, so it is approved at once.
	let policy = { approvedAt: new Date().toISOString(), effectiveAt: new Date().toISOString(), replacing: false, previous: null };
	if (is_default) {
		try {
			policy = await payoutChangePolicy({ userId: user.id, agentId: agent_id, chain, address, stepUp: await stepUpProven(req, user.id, body) });
		} catch (e) {
			if (e instanceof ExternalWalletError) return error(res, e.status, e.code, e.message, e.extra);
			throw e;
		}
	}

	let wallet;
	if (is_default) {
		// Clear existing defaults for (user, chain) in a transaction, then insert
		const clearDefault =
			agent_id !== null
				? sql`update agent_payout_wallets set is_default = false where user_id = ${user.id} and chain = ${chain} and agent_id = ${agent_id}`
				: sql`update agent_payout_wallets set is_default = false where user_id = ${user.id} and chain = ${chain} and agent_id is null`;
		const insert = sql`
			insert into agent_payout_wallets (user_id, agent_id, address, chain, is_default, approved_at, effective_at, set_by)
			values (${user.id}, ${agent_id}, ${address}, ${chain}, true, ${policy.approvedAt}, ${policy.effectiveAt}, 'owner')
			on conflict (user_id, agent_id, chain) do update set
				address = excluded.address, is_default = true, approved_at = excluded.approved_at,
				effective_at = excluded.effective_at, set_by = excluded.set_by, approval_request_id = null
			returning id, agent_id, address, chain, is_default, created_at, approved_at, effective_at
		`;
		const results = await sql.transaction([clearDefault, insert]);
		[wallet] = results[1];
		if (policy.replacing) logAudit({ userId: user.id, action: 'link_payout_wallet', resourceId: wallet.id, meta: { chain, address, previous: policy.previous, agent_id, actor: 'owner', effective_at: policy.effectiveAt, step_up: true }, req });
	} else {
		[wallet] = await sql`
			insert into agent_payout_wallets (user_id, agent_id, address, chain, is_default, approved_at, effective_at, set_by)
			values (${user.id}, ${agent_id}, ${address}, ${chain}, false, ${policy.approvedAt}, ${policy.effectiveAt}, 'owner')
			on conflict (user_id, agent_id, chain) do update set
				address = excluded.address, approved_at = excluded.approved_at, effective_at = excluded.effective_at, set_by = excluded.set_by
			returning id, agent_id, address, chain, is_default, created_at, approved_at, effective_at
		`;
	}

	return json(res, 201, { wallet });
});
