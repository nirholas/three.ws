// Detects the buyback / micro-buy lanes whose signer is the holder-rewards wallet.
// Both lanes sweep every $THREE their signer holds into the treasury, so a signer
// equal to THREE_REWARDS_WALLET would move the whole rewards pool. Shared by the
// ops health check and the receiver preflight script.

import { resolveSignerPubkey } from '../solana-signers.js';
import { rewardsWalletOrNull } from './config.js';

const TRUTHY = ['1', 'true', 'yes', 'on'];
const enabled = (name) => TRUTHY.includes(String(process.env[name] || '').toLowerCase());

/**
 * @param {{ rewards?: string|null, includeDisabled?: boolean }} [opts] `rewards`
 *   overrides the configured rewards wallet (preflight candidates);
 *   `includeDisabled` also reports lanes that are not armed yet.
 * @returns {Promise<Array<{ lane: 'buyback'|'microbuy', signer: string, armed: boolean }>>}
 */
export async function rewardsSignerConflicts({ rewards, includeDisabled = false } = {}) {
	const target = rewards ?? rewardsWalletOrNull();
	if (!target) return [];
	const lanes = [
		{ lane: 'buyback', armed: enabled('THREE_BUYBACK_ENABLED'), spec: { env: 'THREE_BUYBACK_SECRET_KEY_B64' } },
		{
			lane: 'microbuy',
			armed: enabled('THREE_MICROBUY_ENABLED'),
			spec: { env: 'THREE_MICROBUY_SECRET_KEY_B64', fallbackEnv: 'THREE_BUYBACK_SECRET_KEY_B64' },
		},
	];
	const out = [];
	for (const { lane, armed, spec } of lanes) {
		if (!armed && !includeDisabled) continue;
		const { pubkey } = await resolveSignerPubkey(spec);
		if (pubkey && pubkey === target) out.push({ lane, signer: pubkey, armed });
	}
	return out;
}
