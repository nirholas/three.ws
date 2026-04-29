/**
 * Token-adapter factory. Mirrors src/onchain/adapters/index.js for the wallet
 * layer.
 */

import { PumpfunTokenAdapter } from './pumpfun.js';

const cache = new Map();

/**
 * @param {'pumpfun'} provider
 * @returns {import('./base.js').TokenAdapter}
 */
export function getTokenAdapter(provider) {
	if (cache.has(provider)) return cache.get(provider);
	let inst;
	if (provider === 'pumpfun') inst = new PumpfunTokenAdapter();
	else throw new Error(`No token adapter for provider: ${provider}`);
	cache.set(provider, inst);
	return inst;
}

export function _resetTokenAdapters() {
	cache.clear();
}

/** @returns {string[]} */
export function listProviders() {
	return ['pumpfun'];
}
