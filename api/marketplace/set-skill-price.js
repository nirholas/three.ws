import { sql } from '../_lib/db.js';
import { json, method, cors, error, auth } from '../_lib/http.js';

export default async function setSkillPrice(req, res) {
    if (cors(req, res)) return;
    if (!method(req, res, ['POST'])) return;
    const authUser = await auth(req, res);
    if (!authUser) return;

    const { agent_id, skill_name, amount, currency_mint } = req.body;

    if (!agent_id || !skill_name || !amount || !currency_mint) {
        return error(res, 400, 'bad_request', 'Missing required fields.');
    }

    try {
        // First, verify ownership of the agent
        const [agent] = await sql`
            SELECT id FROM agents WHERE id = ${agent_id} AND user_id = ${authUser.id}
        `;

        if (!agent) {
            return error(res, 403, 'forbidden', 'You do not own this agent.');
        }

        // Now, upsert the price
        await sql`
            INSERT INTO agent_skill_prices (agent_id, skill_name, amount, currency_mint, updated_at)
            VALUES (${agent_id}, ${skill_name}, ${amount}, ${currency_mint}, NOW())
            ON CONFLICT (agent_id, skill_name)
            DO UPDATE SET
                amount = EXCLUDED.amount,
                currency_mint = EXCLUDED.currency_mint,
                updated_at = NOW();
        `;

        return json(res, 200, { ok: true, message: 'Price set successfully.' });

    } catch (e) {
        console.error('Error setting skill price:', e);
        return error(res, 500, 'server_error', 'Failed to set skill price.');
    }
}
