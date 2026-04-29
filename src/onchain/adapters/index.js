/**
 * Adapter factory — pick the right WalletAdapter for a ChainRef family.
 *
 * Adapters are stateful (they hold the wallet provider handle), so callers
 * generally hold one instance per family for the lifetime of the page.
 */

import { EvmAdapter } from './evm.js';
import { SolanaAdapter } from './solana.js';

const cache = new Map();

/**
 * @param {'evm'|'solana'} family
 * @returns {import('./base.js').WalletAdapter}
 */
export function getAdapter(family) {
	if (cache.has(family)) return cache.get(family);
	let inst;
	if (family === 'evm') inst = new EvmAdapter();
	else if (family === 'solana') inst = new SolanaAdapter();
	else throw new Error(`No adapter for chain family: ${family}`);
	cache.set(family, inst);
	return inst;
}

/** Test hook — forget cached adapters. */
export function _resetAdapters() {
	cache.clear();
}

export { isUserRejection } from './base.js';
