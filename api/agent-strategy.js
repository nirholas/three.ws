
import { xyz } from '../../src/xyz.js';
import { getDB, send } from '../../_lib/db.js';

export default async function handler(req, res) {
  const db = await getDB();
  const { id } = req.query;

  if (req.method === 'GET') {
    const strategy = await db.collection('strategies').findOne({ agentId: id });
    if (!strategy) {
      return send(res, 404, { error: 'Strategy not found' });
    }
    return send(res, 200, strategy);
  }

  if (req.method === 'POST' || req.method === 'PUT') {
    const { strategy } = req.body;
    if (!strategy) {
      return send(res, 400, { error: 'Strategy is required' });
    }

    const result = await db.collection('strategies').updateOne(
      { agentId: id },
      { $set: { strategy } },
      { upsert: true }
    );

    return send(res, 200, { success: true, result });
  }

  return send(res, 405, { error: 'Method not allowed' });
}
