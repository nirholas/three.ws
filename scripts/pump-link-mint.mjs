// Links a freshly-launched pump.fun coin to an agent_identity on three.ws.
//
// Reads:
//   ~/.claude/pump-deploy/launch-result.json  outcome from pump-launch-usdc.mjs
//   $DATABASE_URL                              neon/postgres connection string
//
// Inserts into pump_agent_mints (so the coin shows up on the agent's page) and
// optionally into coin_launches (for the lottery/reflection mechanic — skipped
// by default since this is a vanilla token launch).
//
// Env:
//   AGENT_ID — required. The agent_identity uuid to link to. If unset, the
//              script lists candidate agents owned by the wallet's linked user
//              and exits with instructions.
//   USER_ID  — optional override. Default: derived from agent_identities.user_id.
//   NETWORK  — mainnet (default) | devnet
//   BUYBACK_BPS — int 0..10000 (default 0).

import { neon } from '@neondatabase/serverless';
import fs from 'fs';
import os from 'os';
import path from 'path';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
	console.error('DATABASE_URL not set. Export it from your three.ws env (Vercel/Neon URL).');
	process.exit(2);
}
const sql = neon(DATABASE_URL);

const RESULT_PATH = path.join(os.homedir(), '.claude', 'pump-deploy', 'launch-result.json');
if (!fs.existsSync(RESULT_PATH)) {
	console.error(`No launch-result.json at ${RESULT_PATH} — run pump-launch-usdc.mjs first.`);
	process.exit(2);
}
const result = JSON.parse(fs.readFileSync(RESULT_PATH, 'utf8'));
if (!result.ok) {
	console.error(`Launch did not succeed (reason: ${result.reason}). Refusing to link.`);
	process.exit(2);
}

const AGENT_ID    = process.env.AGENT_ID || '';
const NETWORK     = process.env.NETWORK || 'mainnet';
const BUYBACK_BPS = Number(process.env.BUYBACK_BPS || '0');

async function main() {
	console.log('Linking pump.fun mint to agent_identity');
	console.log('  mint:        ', result.mint);
	console.log('  wallet:      ', result.wallet);
	console.log('  tx:          ', result.tx_signature);
	console.log('');

	if (!AGENT_ID) {
		console.log('AGENT_ID env var not set. Listing recent agent_identities so you can pick one:\n');
		const rows = await sql`
			select id, name, user_id, created_at
			from agent_identities
			where deleted_at is null
			order by created_at desc
			limit 20
		`;
		for (const r of rows) {
			console.log(`  ${r.id}  ${r.name}  (user ${r.user_id})  created ${r.created_at}`);
		}
		console.log('\nRe-run with:  AGENT_ID=<id> node scripts/pump-link-mint.mjs');
		process.exit(2);
	}

	// Verify the agent exists.
	const [agent] = await sql`
		select id, name, user_id from agent_identities
		where id=${AGENT_ID} and deleted_at is null limit 1
	`;
	if (!agent) {
		console.error(`agent_identities.id=${AGENT_ID} not found.`);
		process.exit(3);
	}
	const userId = process.env.USER_ID || agent.user_id;
	console.log(`  agent:       ${agent.id}  "${agent.name}"  (user ${userId})`);

	// Insert into pump_agent_mints (idempotent on mint+network).
	const inserted = await sql`
		insert into pump_agent_mints
			(agent_id, user_id, network, mint, name, symbol, metadata_uri, agent_authority, buyback_bps)
		values
			(${agent.id}, ${userId}, ${NETWORK}, ${result.mint},
			 ${result.coin_name}, ${result.coin_symbol}, ${result.uri},
			 ${result.wallet}, ${BUYBACK_BPS})
		on conflict (mint, network) do update set
			updated_at = now(),
			name        = excluded.name,
			symbol      = excluded.symbol,
			metadata_uri = excluded.metadata_uri
		returning id, created_at, updated_at
	`;
	const row = inserted[0];
	console.log(`  pump_agent_mints.id: ${row.id}`);
	console.log(`  created_at:          ${row.created_at}`);
	console.log(`  updated_at:          ${row.updated_at}`);

	console.log('\nLinked.');
	console.log(`  /agent/${agent.id} should now show the coin.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
