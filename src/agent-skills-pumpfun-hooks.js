/**
 * Pump.fun protocol hooks
 * -----------------------
 * Subscribes to skill-done events on the agent protocol bus and writes
 * structured memories whenever a pump.fun-related skill succeeds. Lets the
 * agent answer "what's my token?" or "what was my last trade?" without the
 * user re-stating context every turn.
 *
 * Memory types written:
 *   - project: launches  (so the agent remembers its own coin)
 *   - project: trades    (recent buy/sell, capped)
 *   - reference: payments (mint, currency, memo)
 *
 * Idempotent: re-attaching is safe — the hook tags entries with `pumpfun:*`
 * tags so dedupe logic in agent-memory can keep the latest only.
 */

import { ACTION_TYPES } from './agent-protocol.js';
import { MEMORY_TYPES } from './agent-memory.js';

const TAG_LAUNCH = 'pumpfun:launch';
const TAG_TRADE = 'pumpfun:trade';
const TAG_PAY = 'pumpfun:payment';

function shortMint(m) {
	return m ? `${String(m).slice(0, 6)}…${String(m).slice(-4)}` : '?';
}

/**
 * @param {import('./agent-protocol.js').AgentProtocol} protocol
 * @param {import('./agent-memory.js').AgentMemory} memory
 */
export function attachPumpFunMemoryHooks(protocol, memory) {
	if (!protocol || !memory || protocol._pumpfunHooked) return;
	protocol._pumpfunHooked = true;

	protocol.on(ACTION_TYPES.SKILL_DONE, (ev) => {
		const skill = ev.detail?.payload?.skill;
		const result = ev.detail?.payload?.result;
		if (!skill || !result?.success || !skill.startsWith('pumpfun-')) return;
		const data = result.data || {};

		try {
			if (skill === 'pumpfun-create' || skill === 'pumpfun-self-launch' ||
				skill === 'pumpfun-launch-from-agent' || skill === 'pumpfun-self-launch-from-identity') {
				memory.add({
					type: MEMORY_TYPES.PROJECT,
					content: `My pump.fun token: ${data.symbol || '?'} (${data.mint}) on ${data.network || 'mainnet'}.`,
					tags: [TAG_LAUNCH, `mint:${data.mint}`],
					context: {
						mint: data.mint,
						symbol: data.symbol,
						network: data.network,
						signature: data.signature,
						launchedAt: Date.now(),
					},
					salience: 1.0,
				});
			} else if (skill === 'pumpfun-buy' || skill === 'pumpfun-sell' ||
				skill === 'pumpfun-amm-buy' || skill === 'pumpfun-amm-sell' ||
				skill === 'pumpfun-self-swap') {
				const isBuy = skill.includes('buy') || data.side === 'buy';
				memory.add({
					type: MEMORY_TYPES.PROJECT,
					content: `${isBuy ? 'Bought' : 'Sold'} ${shortMint(data.mint)} on ${data.network || 'mainnet'}.`,
					tags: [TAG_TRADE, `mint:${data.mint}`],
					context: {
						mint: data.mint,
						side: isBuy ? 'buy' : 'sell',
						signature: data.signature,
						solAmount: data.solAmount,
						tradedAt: Date.now(),
					},
					salience: 0.6,
				});
			} else if (skill === 'pumpfun-accept-payment' || skill === 'pumpfun-self-pay') {
				memory.add({
					type: MEMORY_TYPES.REFERENCE,
					content: `Accepted payment ${data.amount || ''} for memo ${data.memo || '?'}.`,
					tags: [TAG_PAY],
					context: {
						agentMint: data.agentMint,
						currencyMint: data.currencyMint,
						amount: data.amount,
						memo: data.memo,
						signature: data.signature,
						paidAt: Date.now(),
					},
					salience: 0.5,
				});
			}
		} catch {
			// memory writes are best-effort
		}
	});
}
