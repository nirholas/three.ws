// Spend gate for externally imported skills.
//
// A gated external skill (one that asked for spending, signing or outbound
// messaging) may shape what the agent says, but it may never originate a
// value transfer. When such a skill is in the prompt for a turn, every
// autonomous send the model proposes is checked against the owner's own
// message: it passes only when the owner asked for a send in that message,
// with the same dollar amount and, if a recipient is set, that recipient
// written out. Anything else is held server-side before it reaches the wallet,
// and the reply shows recipient, amount, asset and chain so the owner can ask
// for it themselves. Pure and synchronous so it is testable in isolation.

const ASK_RE = /\b(send|pay|transfer|tip|give|forward)\b/i;
const AMOUNT_RE = /\$?\s?(\d+(?:[.,]\d+)?)/g;

/** True when `message` is the owner explicitly asking for exactly `action`. */
export function ownerAskedFor(action, message) {
	const text = String(message || '');
	if (!ASK_RE.test(text)) return false;
	const usd = Number(action?.usd);
	if (!Number.isFinite(usd)) return false;
	const amounts = [...text.matchAll(AMOUNT_RE)].map((m) => Number(m[1].replace(',', '.')));
	if (!amounts.some((n) => Math.abs(n - usd) < 1e-9)) return false;
	if (action.to && !text.includes(String(action.to))) return false;
	return true;
}

/**
 * Hold sends a gated external skill could have originated. Returns the actions
 * to forward and, when anything was held, a governance record for the done
 * event plus a plain-language note for the reply.
 */
export function holdSkillOriginatedSpend(actions, { userMessage, gatedSkills = [] } = {}) {
	if (!gatedSkills.length || !Array.isArray(actions) || !actions.length) return { actions: actions || [], held: null };
	const kept = [];
	const held = [];
	for (const a of actions) {
		if (a?.type === 'sendSol' && !ownerAskedFor(a, userMessage)) held.push(a);
		else kept.push(a);
	}
	if (!held.length) return { actions: kept, held: null };
	const rows = held.map((a) => ({
		type: a.type,
		recipient: a.to || 'your default recipient',
		amount_usd: Number(a.usd),
		asset: 'SOL',
		chain: 'Solana',
	}));
	const lines = rows.map((r) => `recipient ${r.recipient}, amount $${r.amount_usd} of ${r.asset}, chain ${r.chain}`);
	return {
		actions: kept,
		held: {
			reason: 'external_skill_gate',
			skills: gatedSkills,
			blocked: rows,
			note:
				`(Held: an imported skill (${gatedSkills.join(', ')}) is active and you did not ask for this transfer in your message, so nothing was sent. ` +
				`Proposed: ${lines.join('; ')}. To send it, ask for it yourself with the amount${rows.some((r) => r.recipient !== 'your default recipient') ? ' and recipient' : ''}.)`,
		},
	};
}
