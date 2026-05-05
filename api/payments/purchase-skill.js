import { getSessionUser } from '../../_lib/auth.js';
import { sql } from '../../_lib/db.js';
import { error, json, method, readJson, wrap } from '../../_lib/http.js';

export default wrap(async (req, res) => {
    if (!method(req, res, ['POST'])) return;

    const user = await getSessionUser(req);
    if (!user) return error(res, 401, 'unauthorized', 'sign in required');

    const { agentId, skillName, userWallet } = await readJson(req);

    if (!agentId || !skillName || !userWallet) {
        return error(res, 400, 'bad_request', 'Missing required fields.');
    }

    // 1. Verify the agent and skill exist and get the price
    const [priceInfo] = await sql`
        SELECT p.amount, p.currency_mint, a.user_id as creator_id
        FROM agent_skill_prices p
        JOIN agent_identities a ON p.agent_id = a.id
        WHERE p.agent_id = ${agentId} AND p.skill_id = ${skillName} AND p.is_active = true
    `;

    if (!priceInfo) {
        return error(res, 404, 'not_found', 'Skill not for sale.');
    }

    // 2. Verify the user does not already own the skill
    const [existingPurchase] = await sql`
        SELECT id FROM skill_purchases
        WHERE user_id = ${user.id} AND agent_id = ${agentId} AND skill_name = ${skillName}
    `;

    if (existingPurchase) {
        return error(res, 409, 'conflict', 'Skill already owned.');
    }

    // 3. Construct the Solana Transaction (to be implemented)
    const transaction = "base64_serialized_transaction_here";
    const signature = "transaction_signature_here";


    // 4. Record the pending transaction
    await sql`
        INSERT INTO skill_purchases (user_id, agent_id, skill_name, transaction_signature, amount, currency_mint)
        VALUES (${user.id}, ${agentId}, ${skillName}, ${signature}, ${priceInfo.amount}, ${priceInfo.currency_mint})
    `;

    // 5. Return the transaction
    return json(res, 200, { transaction, signature });
});
