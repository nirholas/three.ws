
import { db } from '../_lib/db';
import { authMiddleware } from '../_lib/auth';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // 1. Authenticate and authorize the user
  const user = await authMiddleware(req, res);
  if (!user) return; // authMiddleware handles the response

  const { id: agentId } = req.query;
  const { skill_name, amount, currency_mint } = req.body;

  // 2. Validate input
  if (!skill_name || typeof amount !== 'number' || !currency_mint) {
    return res.status(400).json({ error: 'Invalid input' });
  }

  try {
    // 3. Check if the user owns the agent
    const agent = await db.one('SELECT owner_id FROM agents WHERE id = $1', [agentId]);
    if (agent.owner_id !== user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // 4. Upsert the price into the database
    const query = `
      INSERT INTO agent_skill_prices (agent_id, skill_name, amount, currency_mint)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (agent_id, skill_name)
      DO UPDATE SET amount = $3, currency_mint = $4, updated_at = NOW();
    `;
    await db.none(query, [agentId, skill_name, amount, currency_mint]);

    // 5. Return success
    return res.status(200).json({ message: 'Price updated successfully' });
  } catch (error) {
    console.error('Error setting skill price:', error);
    if (error.code === '23503') { // Foreign key violation
        return res.status(404).json({ error: 'Agent not found' });
    }
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
