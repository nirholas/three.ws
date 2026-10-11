// Step-up for payout wallet changes.
//
// Replacing a live payout wallet is the one change that can redirect money, so
// every writer (PUT /api/monetization/wallet, POST /api/billing/payout-wallets,
// POST /api/auth/external-wallet/verify) answers 403 `step_up_required` until
// the session proves itself: a fresh password in the body, or a Google or
// Telegram re-authentication within the last five minutes. The replacement
// then takes effect after the cooldown the response names, and the old wallet
// keeps receiving payouts until it does. Setting a first wallet needs none of
// this.
//
// `attempt(extra)` performs the write with `extra` merged into the body and
// returns `{ ok, status, data }`; it is called once plain, and once more with
// the password when the first answer was the step-up refusal. The returned
// result is the final answer, so a caller handles it exactly as before.

export const STEP_UP_CODE = 'step_up_required';

export function isStepUpRefusal(status, data) {
	return status === 403 && data?.error === STEP_UP_CODE;
}

export function stepUpPrompt(data) {
	const current = data?.current_address ? `${data.current_address.slice(0, 6)}…${data.current_address.slice(-4)}` : 'the current wallet';
	const hours = Number(data?.cooldown_hours) || 24;
	return `Payouts currently go to ${current}. Enter your password to replace it. The new wallet takes over after ${hours} hour${hours === 1 ? '' : 's'}; until then the current one keeps receiving.`;
}

// `data` is one wallet row or a list of them (PUT /api/monetization/wallet
// answers with every wallet it touched); the latest effective_at wins.
export function cooldownNotice(data) {
	const rows = Array.isArray(data) ? data : data ? [data] : [];
	let at = null;
	for (const row of rows) {
		const t = row?.effective_at ? new Date(row.effective_at) : null;
		if (t && !Number.isNaN(t.getTime()) && (!at || t > at)) at = t;
	}
	if (!at || at.getTime() <= Date.now()) return 'Payout wallet saved';
	return `Payout wallet saved. It takes over on ${at.toLocaleString()}; the previous wallet receives until then.`;
}

export async function withPayoutStepUp(attempt) {
	const first = await attempt({});
	if (!isStepUpRefusal(first.status, first.data)) return first;
	const password = window.prompt(stepUpPrompt(first.data));
	if (!password) return { ok: false, status: 403, data: { error: 'step_up_cancelled', error_description: 'Nothing changed. The current payout wallet stays.' }, cancelled: true };
	return attempt({ password });
}
