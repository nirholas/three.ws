export const TOOL_COST_USDC = 0.001;

let sessionSpend = 0;
let callCount = 0;
let spendLimit = Infinity;

export function setSpendLimit(usdc) {
	spendLimit = usdc > 0 ? usdc : Infinity;
}

export function checkSpend() {
	if (spendLimit !== Infinity && sessionSpend + TOOL_COST_USDC > spendLimit) {
		return {
			allowed: false,
			reason: `Session spend limit of $${spendLimit.toFixed(3)} USDC reached ($${sessionSpend.toFixed(3)} used). Call spend_status for details or set a higher THREE_WS_SPEND_LIMIT.`,
		};
	}
	return { allowed: true };
}

export function recordSpend() {
	sessionSpend += TOOL_COST_USDC;
	callCount++;
}

export function spendStats() {
	return {
		session_spend_usdc: +sessionSpend.toFixed(4),
		call_count: callCount,
		cost_per_call_usdc: TOOL_COST_USDC,
		spend_limit_usdc: spendLimit === Infinity ? null : spendLimit,
		remaining_usdc: spendLimit === Infinity ? null : +(Math.max(0, spendLimit - sessionSpend)).toFixed(4),
	};
}
