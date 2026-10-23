// Transaction landing providers, as data.
//
// Every signed Solana transaction the execution engine submits is raced across
// all ENABLED providers in this table. The table is the single place that says
// what a provider is, where it submits, how it is tipped and which env var holds
// its credential. A provider whose credential we do not hold stays listed with
// `enabled: false` and the env var that would turn it on, so the gap is visible
// in the stats endpoint and the docs rather than silently absent.
//
// Kinds:
//   primary  the failover-wrapped Connection the caller handed the engine. It is
//            never skipped: it is the guaranteed lane, so a trade always has a
//            route even when every optional provider is in a failure streak.
//   bundle   a Jito block-engine bundle. Needs the tip transfer in the tx.
//   rpc      a JSON-RPC node or sender endpoint that takes sendTransaction.
//
// Tip rules (the tip is ONE instruction inside the one signed tx, so one rule
// wins per attempt; the per-trade ceiling clamps it for every provider):
//   none     the provider needs no tip
//   jito     a transfer to a Jito tip account
//   sender   a transfer to the account named by the provider's tipAccountEnv

export const LANDING_PROVIDERS = [
	{
		name: 'rpc',
		kind: 'primary',
		label: 'Primary RPC (protected send)',
		networks: ['mainnet', 'devnet'],
		tip: { rule: 'none' },
		authEnv: null,
	},
	{
		name: 'jito',
		kind: 'bundle',
		label: 'Jito block engine bundle',
		networks: ['mainnet'],
		tip: { rule: 'jito' },
		authEnv: null,
	},
	{
		name: 'helius',
		kind: 'rpc',
		label: 'Helius staked RPC',
		networks: ['mainnet'],
		tip: { rule: 'none' },
		authEnv: 'HELIUS_API_KEY',
		endpoint: (env) => `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(env.HELIUS_API_KEY)}`,
	},
	{
		name: 'helius_sender',
		kind: 'rpc',
		label: 'Helius sender (staked + tipped)',
		networks: ['mainnet'],
		tip: { rule: 'sender', tipAccountEnv: 'HELIUS_SENDER_TIP_ACCOUNT' },
		authEnv: 'HELIUS_SENDER_TIP_ACCOUNT',
		endpoint: () => 'https://sender.helius-rpc.com/fast?swqos_only=true',
	},
	{
		name: 'extra_rpc',
		kind: 'rpc',
		label: 'Additional RPC endpoint',
		networks: ['mainnet', 'devnet'],
		tip: { rule: 'none' },
		authEnv: 'LANDING_EXTRA_RPC_URL',
		endpoint: (env) => env.LANDING_EXTRA_RPC_URL,
	},
];

/**
 * Resolve the table against an environment: which providers are enabled for this
 * network, their concrete endpoint, and for the disabled ones why.
 *
 * @param {'mainnet'|'devnet'} network
 * @param {Record<string, string|undefined>} [env]
 * @returns {Array<{name:string,kind:string,label:string,enabled:boolean,
 *   disabledReason:string|null,authEnv:string|null,endpoint:string|null,
 *   tip:{rule:string,account:string|null}}>}
 */
export function resolveLandingProviders(network, env = process.env) {
	const off = String(env.LANDING_DISABLED_PROVIDERS || '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
	return LANDING_PROVIDERS.map((p) => {
		let disabledReason = null;
		if (!p.networks.includes(network)) disabledReason = `not available on ${network}`;
		else if (off.includes(p.name)) disabledReason = 'disabled by LANDING_DISABLED_PROVIDERS';
		else if (p.authEnv && !String(env[p.authEnv] || '').trim()) disabledReason = `set ${p.authEnv} to enable`;
		const enabled = disabledReason == null;
		return {
			name: p.name,
			kind: p.kind,
			label: p.label,
			enabled,
			disabledReason,
			authEnv: p.authEnv,
			endpoint: enabled && p.endpoint ? p.endpoint(env) : null,
			tip: {
				rule: p.tip.rule,
				account: p.tip.tipAccountEnv ? String(env[p.tip.tipAccountEnv] || '').trim() || null : null,
			},
		};
	});
}
