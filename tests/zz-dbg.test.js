import { it, vi } from 'vitest'; import fs from 'node:fs';
vi.mock('../api/_lib/db.js', () => { fs.appendFileSync('/tmp/dbg.txt', 'FACTORY\n'); return { sql: async () => [{ id: 'x' }] }; });
it('x', async () => {
  const r = await Promise.all([import('../api/_lib/agent-wallet.js').then((W) => W.getOrCreateAgentSolanaWallet('x')).catch((e) => e.message), import('../api/_lib/agent-wallet.js').then((W) => W.getOrCreateAgentSolanaWallet('x')).catch((e) => e.message)]);
  fs.appendFileSync('/tmp/dbg.txt', JSON.stringify(r));
});
