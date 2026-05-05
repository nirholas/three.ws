import { getSessionUser } from '../../_lib/auth.js';
import { sql } from '../../_lib/db.js';
import { error, json, method, wrap } from '../../_lib/http.js';

export default wrap(async (req, res) => {
    if (!method(req, res, ['GET'])) return;

    const user = await getSessionUser(req);
    if (!user) return error(res, 401, 'unauthorized', 'sign in required');

    const purchases = await sql`
        SELECT agent_id, skill_name
        FROM skill_purchases
        WHERE user_id = ${user.id}
    `;

    return json(res, 200, { purchases });
});
