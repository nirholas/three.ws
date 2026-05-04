import { sql } from '@vercel/postgres';
import { getAuth } from '@clerk/nextjs/server';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { userId } = getAuth(req);
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { agentId } = req.query;
  const { skill_name, amount, currency_mint } = req.body;

  try {
    // Verify ownership of the agent
    const { rows: agents } = await sql`
      SELECT id, creator_id FROM agents WHERE id = ${agentId};
    `;

    if (agents.length === 0 || agents[0].creator_id !== userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Input validation from Prompt 4
    if (!skill_name || amount == null || !currency_mint) {
        return res.status(400).json({ error: 'Missing required fields: skill_name, amount, currency_mint' });
    }
    if (!Number.isInteger(amount) || amount < 0) {
        return res.status(400).json({ error: 'Amount must be a non-negative integer.' });
    }
    // A simple validation for mint address format.
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(currency_mint)) {
        return res.status(400).json({ error: 'Invalid currency mint address.' });
    }

    if (amount > 0) {
      await sql`
        INSERT INTO agent_skill_prices (agent_id, skill_name, amount, currency_mint)
        VALUES (${agentId}, ${skill_name}, ${amount}, ${currency_mint})
        ON CONFLICT (agent_id, skill_name)
        DO UPDATE SET amount = EXCLUDED.amount, currency_mint = EXCLUDED.currency_mint, updated_at = NOW();
      `;
    } else {
      await sql`
        DELETE FROM agent_skill_prices
        WHERE agent_id = ${agentId} AND skill_name = ${skill_name};
      `;
    }
    
    res.status(200).json({ message: 'Skill price updated successfully.' });
  } catch (error) {
    console.error('Error updating skill price:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
