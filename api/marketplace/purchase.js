import { sql } from '../_lib/db.js';
import { getSessionUser } from '../_lib/auth.js';
import { error, json, readJson, wrap } from '../_lib/http.js';
import { z } from 'zod';

const purchaseSchema = z.object({
  agent_id: z.string().uuid(),
  skill_id: z.string().min(1),
});

export default wrap(async (req, res) => {
  if (req.method !== 'POST') return error(res, 405, 'method_not_allowed');

  const user = await getSessionUser(req);
  if (!user) return error(res, 401, 'unauthorized');

  const body = purchaseSchema.parse(await readJson(req));

  // Check for existing purchase
  const [existingPurchase] = await sql`
    SELECT id FROM user_skill_purchases
    WHERE user_id = ${user.id} AND agent_id = ${body.agent_id} AND skill_id = ${body.skill_id} AND status = 'confirmed'
  `;
  if (existingPurchase) {
      return error(res, 409, 'already_owned', 'You have already purchased this skill.');
  }

  // Fetch price and creator info
  const [priceInfo] = await sql`
    SELECT asp.id, asp.creator_id, asp.amount, asp.currency_mint, u.wallet_address as creator_wallet
    FROM agent_skill_prices asp
    JOIN users u ON asp.creator_id = u.id
    WHERE asp.agent_id = ${body.agent_id} AND asp.skill_id = ${body.skill_id} AND asp.deleted_at IS NULL
  `;
  if (!priceInfo) return error(res, 404, 'price_not_found', 'This skill is not for sale.');
  if (!priceInfo.creator_wallet) return error(res, 500, 'creator_wallet_missing', 'The skill creator has not configured a wallet for payments.');


  // Create pending purchase record
  const [purchase] = await sql`
    INSERT INTO user_skill_purchases (user_id, agent_id, skill_id, price_id, status)
    VALUES (${user.id}, ${body.agent_id}, ${body.skill_id}, ${priceInfo.id}, 'pending')
    ON CONFLICT (user_id, agent_id, skill_id) DO UPDATE
    SET status = 'pending', price_id = EXCLUDED.price_id, updated_at = NOW()
    RETURNING id
  `;

  // Return details for Solana Pay transaction
  return json(res, {
    purchaseId: purchase.id,
    recipient: priceInfo.creator_wallet,
    amount: (priceInfo.amount / 1_000_000).toString(), // Assuming 6 decimals for USDC
    splToken: priceInfo.currency_mint,
    reference: purchase.id,
    label: `3D-Agent Skill: ${body.skill_id}`,
    message: `Purchase of skill '${body.skill_id}' for agent.`
  });
});
