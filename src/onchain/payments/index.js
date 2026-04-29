import { PumpfunPaymentsAdapter } from './pumpfun-payments.js';

const cache = new Map();

export function getPaymentsAdapter(provider = 'pumpfun') {
	if (cache.has(provider)) return cache.get(provider);
	let inst;
	if (provider === 'pumpfun') inst = new PumpfunPaymentsAdapter();
	else throw new Error(`No payments adapter for provider: ${provider}`);
	cache.set(provider, inst);
	return inst;
}

export function _resetPaymentsAdapters() {
	cache.clear();
}
