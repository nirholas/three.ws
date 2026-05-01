// Generates api/_lib/migrations/2026-05-01-skills-chat-seed.sql
// from the curatedToolPacks in chat/src/tools.js
// Run: node scripts/gen-skills-seed.mjs

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// Read and eval tools.js to extract curatedToolPacks.
// We use a VM-like approach: strip the export keyword and eval.
let src = readFileSync(join(root, 'chat/src/tools.js'), 'utf8');
// Replace ES module exports so we can eval in a function
src = src
  .replace(/^export const /gm, 'const ')
  .replace(/^export default /gm, 'const _default = ');

// eslint-disable-next-line no-new-func
const fn = new Function('window', src + '\nreturn { curatedToolPacks };');
const { curatedToolPacks } = fn({});

// Slugs/ids already in the existing seed (skip them)
const existing = new Set(['tradingview-charts', 'web-search', 'tradingview']);

const categoryMap = {
  'tradingview': 'finance',
  'price-chart-3d': 'finance',
  'token-price': 'finance',
  'token-ticker-3d': 'finance',
  'web-search': 'utility',
  'date-time': 'utility',
  'pump-launch': 'web3',
  'tx-explain': 'web3',
  'mint-scene-nft': 'web3',
  'nft-3d-import': 'web3',
  'wallet-balances': 'web3',
  'token-gate-scene': 'web3',
};

const tagsMap = {
  'price-chart-3d': ['3d','chart','crypto','finance'],
  'token-price': ['crypto','price','finance','coingecko'],
  'token-ticker-3d': ['3d','crypto','ticker','finance'],
  'date-time': ['time','date','utility'],
  'pump-launch': ['pump.fun','solana','token','web3'],
  'tx-explain': ['transaction','solana','evm','web3'],
  'mint-scene-nft': ['nft','solana','mint','3d'],
  'nft-3d-import': ['nft','3d','solana','evm'],
  'wallet-balances': ['wallet','solana','evm','web3'],
  'token-gate-scene': ['token-gate','nft','solana','web3'],
};

function sqlStr(s) {
  // Escape single quotes for SQL
  return s.replace(/'/g, "''");
}

function pgArray(arr) {
  return `'{${arr.map(t => `"${t}"`).join(',')}}'`;
}

const rows = curatedToolPacks
  .filter(p => !existing.has(p.id))
  .map(p => {
    const schemaJson = JSON.stringify(p.schema);
    const category = categoryMap[p.id] || 'utility';
    const tags = tagsMap[p.id] || [p.id];
    return `(
  '${sqlStr(p.name)}',
  '${sqlStr(p.id)}',
  '${sqlStr(p.description)}',
  '${category}',
  ${pgArray(tags)},
  '${sqlStr(schemaJson)}',
  true,
  null
)`;
  });

const sql = `-- Migration: seed curated chat skills into marketplace
-- Generated from chat/src/tools.js curatedToolPacks (skips tradingview-charts and web-search which are already seeded)
-- Idempotent via ON CONFLICT (slug) DO NOTHING.

begin;

insert into marketplace_skills (name, slug, description, category, tags, schema_json, is_public, author_id) values

${rows.join(',\n\n')}

on conflict (slug) do nothing;

commit;
`;

const outPath = join(root, 'api/_lib/migrations/2026-05-01-skills-chat-seed.sql');
writeFileSync(outPath, sql);
console.log(`Written: ${outPath}`);
console.log(`Skills seeded: ${rows.length}`);
curatedToolPacks.filter(p => !existing.has(p.id)).forEach(p => console.log(' -', p.id));
