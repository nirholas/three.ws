import { sql } from '../_lib/db.js';
import { getSessionUser } from '../_lib/auth.js';
import { cors, json, method, readJson, wrap, error } from '../_lib/http.js';
import { nanoid } from 'nanoid';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const user = await getSessionUser(req);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const { agent_id, skill_name } = await readJson(req);
	if (!agent_id || !skill_name) {
		return error(res, 400, 'validation_error', 'agent_id and skill_name are required');
	}

	// 1. Fetch skill price and agent owner's payout wallet
	const [priceInfo] = await sql`
		SELECT
			p.amount, p.currency_mint,
			a.user_id as owner_user_id
		FROM agent_skill_prices p
		JOIN agent_identities a ON p.agent_id = a.id
		WHERE p.agent_id = ${agent_id}
		  AND p.skill_name = ${skill_name}
	`;

	if (!priceInfo) {
		return error(res, 404, 'not_found', 'The specified skill is not for sale.');
	}
	
	// For this example, we assume the owner's Solana wallet is on the agent's meta field
	// A better approach would be a dedicated agent_payout_wallets table
	const [agent] = await sql`SELECT meta FROM agent_identities WHERE id = ${agent_id}`;
	const recipient_address = agent.meta?.solana_address;
	
	if (!recipient_address) {
		return error(res, 500, 'configuration_error', 'Agent owner has not configured a payout wallet.');
	}

	// 2. Create and store the payment intent
	const intent_id = `pi_${nanoid()}`;
	const expires_at = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now

	await sql`
		INSERT INTO agent_payment_intents
			(id, payer_user_id, agent_id, currency_mint, amount, status, expires_at, payload)
		VALUES
			(${intent_id}, ${user.id}, ${agent_id}, ${priceInfo.currency_mint}, ${String(priceInfo.amount)}, 'pending', ${expires_at}, ${JSON.stringify({ skill: skill_name, recipient_address })})
	`;

	// 3. Return details to the frontend
	return json(res, 201, {
		intent_id,
		recipient_address,
		amount: String(priceInfo.amount),
		currency_mint: priceInfo.currency_mint,
		expires_at: expires_at.toISOString(),
	});
});
