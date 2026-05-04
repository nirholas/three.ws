import { sql } from '../_lib/db.js';
import { json, method, cors, error, auth } from '../_lib/http.js';

export default async function checkSkillAccess(req, res) {
    if (cors(req, res)) return;
    if (!method(req, res, ['GET'])) return;
    const authUser = await auth(req, res);
    if (!authUser) return;

    const { agent_id, skill_name } = req.query;

    if (!agent_id || !skill_name) {
        return error(res, 400, 'bad_request', 'Missing agent_id or skill_name.');
    }

    try {
        const [purchase] = await sql`
            SELECT id FROM skill_purchases
            WHERE user_id = ${authUser.id}
              AND agent_id = ${agent_id}
              AND skill_name = ${skill_name}
            LIMIT 1;
        `;

        const has_access = !!purchase;

        return json(res, 200, { ok: true, has_access });

    } catch (e) {
        console.error('Error checking skill access:', e);
        return error(res, 500, 'server_error', 'Failed to check access.');
    }
}
