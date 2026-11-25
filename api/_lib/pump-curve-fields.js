// @ts-check
// Pump renamed the bonding curve's quote-side reserves when USDC became a
// possible quote asset: `real_sol_reserves` -> `real_quote_reserves` and
// `virtual_sol_reserves` -> `virtual_quote_reserves` (same u64s at the same
// offsets). Current SDKs decode only the `*Quote*` names, so reading the
// legacy name yields `undefined`, which either throws on `.toString()` or
// silently coerces to 0 and reports a healthy curve as empty. Read the current
// name first and keep the legacy one for an older decoder or a payload that
// still carries it. (Pump's TradeEvent still carries both, so event readers
// are unaffected.)

/**
 * A decoded bonding curve's quote reserve as a base-unit string, or null.
 * @param {any} curve decoded BondingCurve (BN fields) or a plain payload
 * @param {'real' | 'virtual'} kind
 * @returns {string | null}
 */
export function curveQuoteReserve(curve, kind) {
	const quoteKey = kind === 'real' ? 'realQuoteReserves' : 'virtualQuoteReserves';
	const legacyKey = kind === 'real' ? 'realSolReserves' : 'virtualSolReserves';
	return curve?.[quoteKey]?.toString?.() ?? curve?.[legacyKey]?.toString?.() ?? null;
}
