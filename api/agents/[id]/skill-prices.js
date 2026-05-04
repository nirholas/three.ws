import { sql } from '../../_lib/db.js';
import { getSessionUser } from '../../_lib/auth.js';
import { error, json, wrap } from '../../_lib/http.js';
import { z } from 'zod';

const priceSchema = z.object({
  skill_id: z.string().min(1),
  amount: z.number().int().positive(),
  currency_mint: z.string().min(32), // Solana mint address length
});

const updatePriceSchema = z.object({
  skill_id: z.string().min(1),
  amount: z.number().int().positive(),
});

const deletePriceSchema = z.object({
    skill_id: z.string().min(1),
});

export default wrap(async (req, res) => {
  const user = await getSessionUser(req);
  if (!user) return error(res, 401, 'unauthorized');

  const agentId = req.query.id;
  const [agent] = await sql`
    SELECT user_id FROM agent_identities WHERE id = ${agentId} AND deleted_at IS NULL
  `;

  if (!agent || agent.user_id !== user.id) {
    return error(res, 403, 'forbidden', 'You do not own this agent.');
  }

  if (req.method === 'POST') {
    const body = priceSchema.parse(await readJson(req));
    await sql`
      INSERT INTO agent_skill_prices (agent_id, skill_id, creator_id, amount, currency_mint)
      VALUES (${agentId}, ${body.skill_id}, ${user.id}, ${body.amount}, ${body.currency_mint})
      ON CONFLICT (agent_id, skill_id) WHERE deleted_at IS NULL
      DO UPDATE SET
        amount = EXCLUDED.amount,
        currency_mint = EXCLUDED.currency_mint,
        creator_id = EXCLUDED.creator_id,
        updated_at = NOW(),
        deleted_at = NULL
    `;
    return json(res, { success: true });
  }

  if (req.method === 'PUT') {
    const body = updatePriceSchema.parse(await readJson(req));
    await sql`
        UPDATE agent_skill_prices
        SET amount = ${body.amount}, updated_at = NOW()
        WHERE agent_id = ${agentId} AND skill_id = ${body.skill_id} AND deleted_at IS NULL
    `;
    return json(res, { success: true });
  }

  if (req.method === 'DELETE') {
    const body = deletePriceSchema.parse(await readJson(req));
    await sql`
        UPDATE agent_skill_prices
        SET deleted_at = NOW()
        WHERE agent_id = ${agentId} AND skill_id = ${body.skill_id}
    `;
    return json(res, { success: true });
  }

  return error(res, 405, 'method_not_allowed');
});
