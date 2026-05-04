# Prompt 4: Create Payment Intent API

## Objective
Create a new backend API endpoint that generates a "payment intent." This intent is a secure, server-side record of a pending transaction, including what is being bought, by whom, and for how much.

## Explanation
Before a user can make a payment on the frontend, the backend needs to create a secure reference for the transaction. This is called a "payment intent." The frontend will request this intent right before showing the payment modal. The intent contains all the necessary details for the frontend to construct the transaction (like the recipient's address and the exact amount), and it provides a unique ID that we can use later to verify the payment's status.

## Instructions
1.  **Create a New API File:**
    *   Create a new file at `api/payments/intent.js`. This will house the logic for creating payment intents.

2.  **Define the Endpoint Logic:**
    *   The endpoint should accept a `POST` request.
    *   It must be authenticated, as only logged-in users can purchase skills.
    *   The request body should contain the `agent_id` and `skill_name` the user wants to purchase.

3.  **Implement the Core Logic:**
    *   Look up the agent to ensure it exists and is published.
    *   Look up the skill price in the `agent_skill_prices` table using the `agent_id` and `skill_name`. If no price is found, return an error.
    *   Look up the agent creator's payout wallet address. For now, this can be stored on the `agent_identities` table or in a related table.
    *   Generate a unique ID for this intent. A `uuid` is a good choice.
    *   Store the intent details in the `agent_payment_intents` table. This includes the payer's user ID, the agent ID, the amount, the currency, the recipient address, and a status of `'pending'`. Set an expiration time (e.g., 10 minutes).
    *   Return the payment intent ID and the necessary details for the frontend to construct the transaction (e.g., recipient address, amount, currency mint, etc.).

4.  **Add Vercel Routing:**
    *   In `vercel.json`, add a route to direct requests from `/api/payments/intent` to your new serverless function.

## Code Example (Backend - `api/payments/intent.js`)

```javascript
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
			p.amount, p.currency_mint, p.chain,
			a.user_id as owner_user_id
		FROM agent_skill_prices p
		JOIN agent_identities a ON p.agent_id = a.id
		WHERE p.agent_id = ${agent_id}
		  AND p.skill = ${skill_name}
		  AND p.is_active = true
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
		chain: priceInfo.chain,
		expires_at: expires_at.toISOString(),
	});
});
```
