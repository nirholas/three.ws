// Mainnet launch plan for staked Event Markets: the ordered owner steps with every
// value filled from facts about the environment, and a preflight computed from those
// same facts. Pure functions only. The script that gathers the facts and prints this
// is scripts/event-markets-stake-launch-plan.mjs; nothing here signs, sends or writes.

/** Public addresses of the platform economy wallets. Staking keys must never reuse them. */
export const ECONOMY_WALLETS = [
	'wwwwwDxFWRn7grgr3Esrsg5C6NvDoDHSA4gaCffccrU',
	'wwwqvAbN4RjaRvfGsorxMuauq7SWVcV13Aa7GaqHGUn',
	'WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW',
];

const SLUG = '<market-slug>';

/**
 * @typedef {object} LaunchFacts
 * @property {string|null} programId
 * @property {string|null} programHash        sha256 of the built .so, or null when not built
 * @property {string|null} cluster
 * @property {string|null} authority          pubkey, null when the keypair is missing
 * @property {string|null} resolver
 * @property {string|null} buybackWallet
 * @property {string|null} treasury
 * @property {boolean} migrationApplied
 * @property {boolean} flagEnabled
 * @property {boolean} rpcReachable
 * @property {number|null} openMarkets        null when the listing could not be read
 * @property {{ checked: boolean, ok: boolean, detail: string }} reconcile
 * @property {{ feeBps: number, buybackShareBps: number }} fee
 * @property {{ usdc: { maxStake: string, maxPool: string }, three: { maxStake: string, maxPool: string } }} caps
 */

/** @param {LaunchFacts} f */
export function evaluatePreflight(f) {
	const used = [f.authority, f.resolver, f.buybackWallet].filter(Boolean);
	const distinct = used.length === 3 && new Set(used).size === 3;
	const noEconomyReuse = used.every((k) => !ECONOMY_WALLETS.includes(k));
	return [
		{ id: 'cluster', ok: f.cluster === 'mainnet', detail: `EVENT_MARKETS_STAKE_CLUSTER=${f.cluster || 'unset'} (must be mainnet)` },
		{ id: 'program-id', ok: Boolean(f.programId), detail: f.programId || 'EVENT_MARKETS_STAKE_PROGRAM_ID is not set' },
		{ id: 'program-build', ok: Boolean(f.programHash), detail: f.programHash ? `built .so sha256 ${f.programHash}` : 'contracts/event-markets-stake/target/deploy/event_markets_stake.so not built' },
		{ id: 'keys-present', ok: Boolean(f.authority && f.resolver), detail: f.authority && f.resolver ? `authority ${f.authority}, resolver ${f.resolver}` : 'authority or resolver keypair file missing (EVENT_MARKETS_STAKE_AUTHORITY_KEYPAIR / _RESOLVER_KEYPAIR)' },
		{ id: 'buyback-key', ok: Boolean(f.buybackWallet), detail: f.buybackWallet ? `buyback wallet ${f.buybackWallet}` : 'EVENT_MARKETS_STAKE_BUYBACK_KEYPAIR missing' },
		{ id: 'keys-distinct', ok: distinct, detail: distinct ? 'authority, resolver and buyback wallets are three different keys' : 'authority, resolver and buyback wallet must be three different keys' },
		{ id: 'keys-not-economy', ok: noEconomyReuse, detail: noEconomyReuse ? 'none of the staking keys is a platform economy wallet' : 'a staking key reuses a platform economy wallet' },
		{ id: 'migration', ok: f.migrationApplied, detail: f.migrationApplied ? 'event_market_stake_* tables exist' : 'migration 20261013000000 not applied (npm run db:status, then the owner applies it)' },
		{ id: 'flag-off', ok: !f.flagEnabled, detail: f.flagEnabled ? 'EVENT_MARKETS_STAKING_ENABLED is already 1 here; launch with it off and enable last' : 'EVENT_MARKETS_STAKING_ENABLED is off (enable it last)' },
		{ id: 'rpc', ok: f.rpcReachable, detail: f.rpcReachable ? 'cluster RPC answered' : 'cluster RPC unreachable' },
		{ id: 'open-market', ok: (f.openMarkets ?? 0) > 0, detail: f.openMarkets == null ? 'open markets could not be listed' : `${f.openMarkets} open market(s)` },
		{ id: 'reconcile', ok: f.reconcile.ok, detail: f.reconcile.detail },
	];
}

/** @param {LaunchFacts} f */
export function buildLaunchSteps(f) {
	const adm = 'node --env-file=.env scripts/event-markets-stake-admin.mjs';
	return [
		{ n: 1, owner: 'owner + counsel', gate: false, title: 'External audit and counsel sign-off', run: 'Program is unaudited. Obtain the audit report and counsel sign-off on jurisdiction, minimum age (21 default), KYC and how a fee-funded buyback is characterized.', expect: 'Written sign-off recorded outside the repo.' },
		{ n: 2, owner: 'owner', gate: false, title: 'Generate hardware-backed keys', run: 'solana-keygen new -o <authority.json>; solana-keygen new -o <resolver.json>; solana-keygen new -o <buyback.json>. Set EVENT_MARKETS_STAKE_AUTHORITY_KEYPAIR, _RESOLVER_KEYPAIR and _BUYBACK_KEYPAIR to the file paths.', expect: `Three distinct pubkeys, none an economy wallet. Authority ${f.authority || '<pending>'}, resolver ${f.resolver || '<pending>'}, buyback ${f.buybackWallet || '<pending>'}.` },
		{ n: 3, owner: 'owner', gate: true, title: 'Deploy the program to mainnet (spends SOL for rent and the upload)', run: 'cd contracts/event-markets-stake && cargo build-sbf && solana program deploy target/deploy/event_markets_stake.so --program-id target/deploy/event_markets_stake-keypair.json --url mainnet-beta', expect: `Program id ${f.programId || '<EVENT_MARKETS_STAKE_PROGRAM_ID>'}. Then: solana program dump ${f.programId || '<id>'} dump.so --url mainnet-beta && sha256sum dump.so must equal ${f.programHash || '<built .so sha256>'}.` },
		{ n: 4, owner: 'owner', gate: true, title: 'Apply the database migration', run: 'npm run db:status && npm run db:migrate   # 20261013000000, applies immediately', expect: 'event_market_stake_pools, event_market_stakes, event_market_stake_settings, event_market_stake_attestations exist.' },
		{ n: 5, owner: 'owner', gate: true, title: 'Initialize the program config', run: `${adm} init --treasury ${f.treasury || '<treasury owner pubkey>'} --buyback ${f.buybackWallet || '<buyback owner pubkey>'} --fee-bps ${f.fee.feeBps} --buyback-share-bps ${f.fee.buybackShareBps} --yes --confirm-mainnet`, expect: 'Prints the confirmation table, then "sent <signature>". status then shows the config with paused=false.' },
		{ n: 6, owner: 'owner', gate: true, title: 'Create the first pool on an open market', run: `${adm} create-pool --market ${SLUG} --token usdc --yes --confirm-mainnet`, expect: `Table shows min/max stake and pool cap (USDC max stake ${f.caps.usdc.maxStake}, pool ${f.caps.usdc.maxPool} base units), then "sent <signature>" and "pool recorded". No funds move (rent only).` },
		{ n: 7, owner: 'owner', gate: true, title: 'Enable staking in production (config-only change)', run: 'gcloud run services update three-ws-api --region us-central1 --update-env-vars EVENT_MARKETS_STAKING_ENABLED=1,EVENT_MARKETS_STAKE_CLUSTER=mainnet,EVENT_MARKETS_STAKE_PROGRAM_ID=<id>', expect: 'GET /api/event-markets/<slug>/staking reports available for an attested viewer outside blocked regions. Use --update-env-vars, never --set-env-vars.' },
		{ n: 8, owner: 'owner', gate: true, title: 'After the market resolves', run: `${adm} resolve --market ${SLUG} --yes --confirm-mainnet   # or: void, if nobody picked the winner`, expect: 'Fee leaves the vault to treasury and buyback; winners claim their own payouts.' },
		{ n: 9, owner: 'owner', gate: true, title: 'Run the $THREE buyback', run: `${adm} buyback --yes --confirm-mainnet`, expect: 'Table lists wallet, USDC in, $THREE out, enforced minimum out, slippage and impact. Refuses above the bounds.' },
	];
}

/** Render the plan and preflight as text. `ok` is true only when every preflight check passes. */
export function renderLaunchPlan(f) {
	const checks = evaluatePreflight(f);
	const steps = buildLaunchSteps(f);
	const lines = ['Staked Event Markets: mainnet launch plan (read-only, nothing is sent)', ''];
	lines.push('Preflight');
	for (const c of checks) lines.push(`  [${c.ok ? 'ok' : 'FAIL'}] ${c.id.padEnd(16)} ${c.detail}`);
	lines.push('', 'Ordered steps (a step marked GATE moves funds or changes production; each needs the owner to say yes)');
	for (const s of steps) {
		lines.push(`  ${s.n}. ${s.title}${s.gate ? '  [GATE]' : ''}  (${s.owner})`, `     run:    ${s.run}`, `     expect: ${s.expect}`);
	}
	lines.push('', 'Rollback: set EVENT_MARKETS_STAKING_ENABLED off, POST pause on /api/event-markets/staking-admin, run `pause` on the CLI, and `void` any open pool so every staker refunds.');
	return { ok: checks.every((c) => c.ok), checks, steps, text: lines.join('\n') };
}
