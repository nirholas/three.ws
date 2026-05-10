// Skill-access gate primitives for the agent runtime.
//
// The Runtime calls `skillAccess(toolName)` before invoking any skill tool.
// If the call returns `{ allowed: false, ...paymentInfo }`, the runtime
// emits a `skill:payment-required` event and feeds a structured 402 result
// back to the LLM so it can react (ask the user to purchase, or — once track 2
// is wired — let an autonomous agent invoke its own purchase flow).
//
// Built-in tools (BUILTIN_HANDLERS) and stage tools are always allowed; the
// gate only applies to skill-provided tools.

export class PaymentRequiredError extends Error {
	/**
	 * @param {{ skill: string, price?: object, reference?: string, message?: string, recipient?: string }} payload
	 */
	constructor(payload) {
		super(payload?.message || `payment required to use skill: ${payload?.skill}`);
		this.name = 'PaymentRequiredError';
		this.code = 'payment_required';
		this.payload = payload || {};
	}
}

/**
 * Default no-op gate: every skill is allowed. Used when the runtime is not
 * wired to a marketplace context (local dev, embedded agent without monetization).
 */
export function alwaysAllow() {
	return async () => ({ allowed: true });
}

/**
 * Build a `skillAccess` checker from a marketplace agent detail payload.
 *
 * @param {{
 *   skill_prices?: Record<string, { amount: string|number, currency_mint: string, chain?: string }>,
 *   purchased_skills?: string[],
 * }} agent
 * @returns {(toolName: string) => Promise<{allowed: boolean, price?: object, message?: string}>}
 */
export function fromAgentDetail(agent) {
	const prices = agent?.skill_prices || {};
	const purchased = new Set(agent?.purchased_skills || []);

	return async (toolName) => {
		const price = prices[toolName];
		if (!price) return { allowed: true }; // free skill

		if (purchased.has(toolName)) return { allowed: true };

		return {
			allowed: false,
			skill: toolName,
			price: {
				amount: String(price.amount),
				currency_mint: price.currency_mint,
				chain: price.chain || 'solana',
			},
			message: `This skill requires a purchase: ${toolName}`,
		};
	};
}

/**
 * Build a `skillAccess` checker that re-fetches purchase status against the
 * server on every check. More authoritative than the snapshot built from
 * agent detail, but adds a network round-trip per call.
 *
 * @param {{ agentId: string, fetchImpl?: typeof fetch }} opts
 */
export function remoteCheck({ agentId, fetchImpl = fetch }) {
	return async (toolName) => {
		try {
			const url = `/api/marketplace/check-skill-access?agent_id=${encodeURIComponent(agentId)}&skill=${encodeURIComponent(toolName)}`;
			const r = await fetchImpl(url, { credentials: 'include' });
			if (!r.ok) {
				// Anonymous or skill not for sale → treat as allowed (free).
				return { allowed: true };
			}
			const j = await r.json();
			if (j?.has_access) return { allowed: true };
			return {
				allowed: false,
				skill: toolName,
				message: `This skill requires a purchase: ${toolName}`,
			};
		} catch {
			// Network error: fail open so transient issues don't block use.
			return { allowed: true };
		}
	};
}
