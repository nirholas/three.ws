// Buyer-facing skill bundle storefront: pure view-model and markup helpers.
//
// A bundle sells several of one agent's skills for a single price. The numbers a
// buyer sees here (what the skills cost separately, what they save) come only from
// the agent's real per-skill list prices. When a price cannot be compared honestly
// (a skill is unpriced, or priced in a different mint than the bundle) no saving
// is shown at all, never an estimate.

const DEFAULT_DECIMALS = 6;

/**
 * Convert an atomic integer (string, number or bigint) to a human decimal string.
 * Goes through BigInt so a 9-decimal mint never loses precision.
 */
export function atomicToHuman(atomic, decimals = DEFAULT_DECIMALS, maxFraction = 4) {
	let value;
	try {
		value = BigInt(String(atomic).split('.')[0]);
	} catch {
		return '0';
	}
	const negative = value < 0n;
	if (negative) value = -value;
	const d = Math.max(0, Math.min(18, Number(decimals) | 0));
	const base = 10n ** BigInt(d);
	const whole = value / base;
	let frac = (value % base).toString().padStart(d, '0');
	frac = frac.slice(0, Math.max(2, maxFraction)).replace(/0+$/, '');
	if (frac.length < 2 && d >= 2) frac = frac.padEnd(2, '0');
	if (d === 0) frac = '';
	return `${negative ? '-' : ''}${whole.toString()}${frac ? `.${frac}` : ''}`;
}

function safeBigInt(v) {
	try {
		return BigInt(String(v).split('.')[0]);
	} catch {
		return null;
	}
}

/**
 * Build the render model for one bundle.
 *
 * @param {object} bundle   a row from GET /api/agents/:id/bundles
 * @param {object} ctx
 * @param {string} ctx.agentId
 * @param {Record<string, {amount:any, currency_mint:string, mint_decimals?:number}>} ctx.skillPrices
 * @param {Set<string>} ctx.owned  keys of the form `${agentId}:${skill}`
 * @param {(mint:string)=>string} ctx.mintLabel
 */
export function buildBundleView(bundle, { agentId, skillPrices = {}, owned = new Set(), mintLabel = (m) => m }) {
	const skills = Array.isArray(bundle.skills) ? bundle.skills.filter((s) => typeof s === 'string') : [];
	const price = safeBigInt(bundle.price_amount) ?? 0n;
	const mint = bundle.currency_mint || '';

	const sameMint = skills.map((s) => skillPrices[s]).find((p) => p && p.currency_mint === mint);
	const decimals = Number(sameMint?.mint_decimals ?? DEFAULT_DECIMALS);

	// Skills with no active price are free to the buyer, so they neither count
	// toward the list total nor block an "owned" verdict.
	const pricedSkills = skills.filter((s) => skillPrices[s]);
	const ownedCount = pricedSkills.filter((s) => owned.has(`${agentId}:${s}`)).length;
	const isOwned = pricedSkills.length > 0 && ownedCount === pricedSkills.length;

	let listAtomic = null;
	if (skills.length > 0 && pricedSkills.length === skills.length) {
		const comparable = pricedSkills.every((s) => skillPrices[s].currency_mint === mint && safeBigInt(skillPrices[s].amount) != null);
		if (comparable) listAtomic = pricedSkills.reduce((sum, s) => sum + safeBigInt(skillPrices[s].amount), 0n);
	}

	let savingsAtomic = null;
	let savingsPercent = null;
	if (listAtomic != null && listAtomic > price) {
		savingsAtomic = listAtomic - price;
		savingsPercent = Number((savingsAtomic * 10000n) / listAtomic) / 100;
	}

	const label = mintLabel(mint);
	return {
		id: bundle.id,
		name: bundle.name || 'Skill bundle',
		description: bundle.description || '',
		skills,
		priceAtomic: price.toString(),
		mint,
		decimals,
		priceText: `${atomicToHuman(price, decimals)} ${label}`,
		listText: listAtomic != null ? `${atomicToHuman(listAtomic, decimals)} ${label}` : null,
		savingsText: savingsAtomic != null ? `${atomicToHuman(savingsAtomic, decimals)} ${label}` : null,
		savingsPercent,
		owned: isOwned,
		ownedCount,
		pricedCount: pricedSkills.length,
	};
}

export function escapeText(s) {
	return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Markup for one bundle card. */
export function renderBundleCard(view, agentId) {
	const chips = view.skills.map((s) => `<li class="bundle-chip">${escapeText(s)}</li>`).join('');
	const savings = view.savingsText
		? `<p class="bundle-savings"><span class="bundle-save-badge">Save ${escapeText(view.savingsText)}${
				view.savingsPercent != null ? ` (${Math.round(view.savingsPercent)}%)` : ''
			}</span> <span class="bundle-list-price">${escapeText(view.listText)} separately</span></p>`
		: '';
	const partial = !view.owned && view.ownedCount > 0
		? `<p class="bundle-partial">You own ${view.ownedCount} of ${view.pricedCount} priced skills.</p>`
		: '';
	const action = view.owned
		? `<button type="button" class="bundle-buy-btn is-owned" disabled aria-label="${escapeText(view.name)}: owned">&#10003; Owned</button>`
		: `<button type="button" class="bundle-buy-btn" data-bundle-id="${escapeText(view.id)}" data-agent-id="${escapeText(agentId)}" aria-label="Buy bundle ${escapeText(view.name)} for ${escapeText(view.priceText)}">Buy bundle</button>`;
	return `<article class="bundle-card${view.owned ? ' is-owned' : ''}" data-bundle-card="${escapeText(view.id)}">
	<div class="bundle-card-head">
		<h3 class="bundle-name">${escapeText(view.name)}</h3>
		<span class="bundle-price">${escapeText(view.priceText)}</span>
	</div>
	${view.description ? `<p class="bundle-desc">${escapeText(view.description)}</p>` : ''}
	<ul class="bundle-chips" aria-label="Skills included">${chips}</ul>
	${savings}${partial}
	<div class="bundle-card-foot">${action}</div>
</article>`;
}

/** Skeleton placeholder cards while the public list loads. */
export function renderBundleSkeletons(count = 2) {
	return Array.from({ length: count }, () =>
		`<div class="bundle-card bundle-skeleton" aria-hidden="true"><span class="sk sk-title"></span><span class="sk sk-line"></span><span class="sk sk-line short"></span></div>`
	).join('');
}

/** Error card with a retry control. */
export function renderBundleError(message) {
	return `<div class="bundle-error" role="alert"><p>${escapeText(message || 'Bundles could not be loaded.')}</p><button type="button" class="bundle-retry-btn">Try again</button></div>`;
}

/** Owner-only note shown when an agent has no active bundle. */
export function renderBundleOwnerEmpty() {
	return `<div class="bundle-empty"><p>You have no active bundles on this agent. Sell several skills for one price.</p><a class="bundle-create-link" href="/bundles">Create a bundle</a></div>`;
}
