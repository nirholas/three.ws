// Output shaping for alert rules and fired alerts. The three.ws API already
// returns clean, documented objects; these helpers pin the agent-facing shape so
// it stays stable regardless of incidental fields the API adds, and add a
// one-line human summary to each fired alert.

/**
 * Normalize a rule row from /api/alerts/rules into the agent-facing shape.
 * Field names mirror the API and the create/update tool inputs one-for-one.
 * @param {Record<string, any> | null | undefined} r
 */
export function shapeRule(r) {
	if (!r || typeof r !== 'object') return null;
	return {
		id: r.id,
		kind: r.kind,
		// `label` is what the user typed (null when auto-named); `label_display`
		// is the resolved name the dashboard shows (a derived default when unnamed).
		label: r.label ?? null,
		label_display: r.label_display ?? null,
		target_mint: r.target_mint ?? null,
		target_agent: r.target_agent ?? null,
		threshold: r.threshold ?? null,
		filters: r.filters ?? null,
		deliver_in_app: r.deliver_in_app ?? null,
		webhook_url: r.webhook_url ?? null,
		// Per-rule HMAC secret for verifying the `webhook-signature` header on
		// inbound deliveries. Returned only to the rule's owner.
		webhook_secret: r.webhook_secret ?? null,
		telegram_chat: r.telegram_chat ?? null,
		cooldown_seconds: r.cooldown_seconds ?? null,
		enabled: r.enabled ?? null,
		last_fired_at: r.last_fired_at ?? null,
		recent_failures: r.recent_failures ?? 0,
		recent_deliveries: Array.isArray(r.recent_deliveries) ? r.recent_deliveries : [],
		created_at: r.created_at ?? null,
		updated_at: r.updated_at ?? null,
	};
}

/**
 * Normalize a `pump_alert` notification row from /api/notifications into a
 * fired-alert entry. The notification's `payload` is the alert itself (kind,
 * mint, amounts, market cap, tx, …); we surface those fields and add a
 * human-readable summary.
 * @param {{ id?: any, payload?: Record<string, any>, read_at?: any, created_at?: any }} n
 */
export function shapeAlert(n) {
	if (!n || typeof n !== 'object') return null;
	const payload = n.payload && typeof n.payload === 'object' ? n.payload : {};
	return {
		id: n.id,
		fired_at: n.created_at ?? payload.at ?? null,
		read: n.read_at != null,
		summary: summarizeAlert(payload),
		rule_id: payload.rule_id ?? null,
		kind: payload.kind ?? null,
		mint: payload.mint ?? null,
		name: payload.name ?? null,
		symbol: payload.symbol ?? null,
		event: payload,
	};
}

const usd = (v) =>
	v != null && Number.isFinite(Number(v)) ? `$${Math.round(Number(v)).toLocaleString('en-US')}` : null;

/**
 * One-line, agent-readable summary of a fired-alert payload. Mirrors the site's
 * own alert wording so history reads the same as the in-app feed.
 * @param {Record<string, any>} p
 */
export function summarizeAlert(p) {
	const tok = p.symbol
		? `$${p.symbol}`
		: p.name || (p.mint ? `${String(p.mint).slice(0, 4)}…${String(p.mint).slice(-4)}` : 'token');
	switch (p.kind) {
		case 'graduation': {
			const mc = usd(p.market_cap_usd);
			return `${tok} graduated to AMM${mc ? ` at ${mc} mcap` : ''}`;
		}
		case 'new_mint':
			return `${tok} just launched`;
		case 'whale_buy': {
			const sol = p.amount_sol != null ? `${Number(p.amount_sol).toFixed(2)} SOL` : 'a large buy';
			const u = usd(p.amount_usd);
			return `Whale bought ${sol}${u ? ` (${u})` : ''} of ${tok}`;
		}
		case 'price_above':
			return `${tok} mcap rose above ${usd(p.threshold_usd)} (now ${usd(p.market_cap_usd)})`;
		case 'price_below':
			return `${tok} mcap fell below ${usd(p.threshold_usd)} (now ${usd(p.market_cap_usd)})`;
		case 'market_anomaly':
			return p.summary || `${p.subject || 'market'} ${p.processor || ''} anomaly`.replace(/\s+/g, ' ').trim();
		default:
			return `${tok} alert`;
	}
}
