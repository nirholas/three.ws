// Forge cost preview line and pay-to-keep gate for the result Download button.
//
// The preview reads GET /api/forge-quote (public, spend-free): what the current
// quality, engine and input would cost, from the same tables the server enforces.
// Pay-to-keep is OFF unless the owner enables FORGE_PAY_TO_KEEP; with it off the
// keep check answers kept:true and Download behaves exactly as before.
//
// When it is on, a preview is free and the original file is released once per
// generation to a $THREE holder, or against one settled $THREE payment (the same
// quote, sign, settle rail High and Game-Ready use). Nothing here signs or spends
// without the wallet prompt in forge-pay.js, which asks first.

import { payForConsumption } from './forge-pay.js';
import { attachTierPass, getTierPass } from './three-access.js';

const usd = (n) => `$${Number(n).toFixed(2)}`;

/** One human line for a quote. Pure: unit-tested. */
export function describeQuote(q) {
	if (!q || !q.generation) return '';
	const g = q.generation;
	const bits = [];
	if (g.model === 'byok') {
		bits.push('Billed to your own vendor key, free on three.ws');
	} else if (g.model === 'hold_or_pay') {
		bits.push(`${usd(g.usd)} in $THREE per generation, free for ${g.gate?.holder_tier_label || 'holders'}`);
	} else {
		bits.push('Free to generate');
	}
	if (q.keep?.applies && q.keep.usd > 0) {
		bits.push(`keep the original file for ${usd(q.keep.usd)} in $THREE, free for holders`);
	}
	if (q.gameready?.usd > 0) {
		bits.push(`Game-Ready export ${usd(q.gameready.usd)}`);
	}
	return bits.join(' · ');
}

let seq = 0;

/**
 * Fetch and render the quote for the current composer state into `el`.
 * Stale responses (a faster, later request) are dropped. A failed preview clears
 * the line: the catalog estimate above it stays the fallback.
 */
export async function renderQuote(el, { tier, path, backend, images = false, headers = {} } = {}) {
	if (!el) return null;
	const mine = ++seq;
	const sp = new URLSearchParams();
	if (tier) sp.set('tier', tier);
	if (path) sp.set('path', path);
	if (backend) sp.set('backend', backend);
	if (images) sp.set('images', '1');
	try {
		const res = await fetch(`/api/forge-quote?${sp}`, { headers });
		if (!res.ok) throw new Error(String(res.status));
		const q = await res.json();
		if (mine !== seq) return null;
		el.textContent = describeQuote(q);
		el.hidden = !el.textContent;
		return q;
	} catch {
		if (mine === seq) {
			el.textContent = '';
			el.hidden = true;
		}
		return null;
	}
}

async function keepRequest(creationId, headers, payment) {
	const res = await fetch('/api/forge-keep', {
		method: 'POST',
		headers: attachTierPass({ 'content-type': 'application/json', ...headers }),
		body: JSON.stringify({
			creation_id: creationId,
			...(payment ? { payment_id: payment.paymentId, ref_id: payment.refId } : {}),
		}),
	});
	const data = await res.json().catch(() => ({}));
	return { res, data };
}

/**
 * Gate a download on pay-to-keep. Resolves { ok:true } when the file may be
 * released (feature off, included, holder, or paid) and { ok:false, message } when
 * the user cancelled or the payment could not be verified. Never throws. A network
 * or server fault fails open (see below), so the default experience cannot regress.
 */
export async function ensureKept(creationId, { headers = {} } = {}) {
	if (!creationId) return { ok: true };
	try {
		await getTierPass({ interactive: false }).catch(() => null);
		let { res, data } = await keepRequest(creationId, headers);
		if (res.ok && data.kept) return { ok: true };
		// The keep check is a bonus gate, never a reason a download that worked before
		// stops working: a missing route or a server fault releases the file, since the
		// stored file URL is already public and the gate only adds the payment step.
		if (res.status === 404 || res.status >= 500) return { ok: true };
		const price = Number(data.pay_per_use?.usd) || 0;
		if (res.status === 402 && price > 0) {
			const paid = await payForConsumption({
				usd: price,
				unit: 'keeping this model',
				confirm: 'Keep the original file of this generation. Previewing stays free.',
				footnote: '$THREE is the only coin on three.ws. Holders keep every model free.',
				successText: 'Payment confirmed. Preparing your file…',
				refPrefix: 'forge-keep',
			});
			if (!paid?.ok) return { ok: false, message: 'Download cancelled. No $THREE was spent.' };
			({ res, data } = await keepRequest(creationId, headers, paid));
			if (res.ok && data.kept) return { ok: true };
		}
		return { ok: false, message: data.message || 'Could not confirm this download. Try again.' };
	} catch {
		return { ok: true };
	}
}
