/**
 * Pump.fun Live Feed Widget
 *
 * DOM overlay on top of the 3D viewer. Subscribes to /api/agents/pumpfun-feed
 * (SSE) and renders a stack of cards. When `autoNarrate` is on, the agent
 * narrates each event through the existing protocol bus — speak + emote
 * routed through the Empathy Layer (see src/CLAUDE.md "Empathy Layer").
 *
 * Config (validated in widget-types.js):
 *   - kind        'all' | 'claims' | 'graduations'
 *   - minTier     ''    | 'notable' | 'influencer' | 'mega'
 *   - autoNarrate boolean
 *   - maxCards    1..50
 */

const FEED_PATH = '/api/agents/pumpfun-feed';
const TIER_BADGE = { mega: '🔥🔥', influencer: '🔥', notable: '⭐' };

/**
 * @param {import('../viewer.js').Viewer} viewer
 * @param {object} config
 * @param {HTMLElement} container  parent element to attach the overlay to
 * @param {{ protocol?: any }} [ctx]
 */
export async function mountPumpfunFeed(viewer, config, container, ctx = {}) {
	const root = document.createElement('div');
	root.className = 'pumpfun-feed';
	root.style.cssText = [
		'position:absolute',
		'right:16px',
		'top:16px',
		'width:320px',
		'max-height:80%',
		'overflow-y:auto',
		'pointer-events:auto',
		'z-index:5',
		'font-family:ui-sans-serif,system-ui,-apple-system,sans-serif',
		'color:#fff',
	].join(';');
	(container || document.body).appendChild(root);

	const status = document.createElement('div');
	status.style.cssText = 'opacity:0.6;font-size:12px;padding:4px 8px';
	status.textContent = 'Connecting to pump.fun feed…';
	root.appendChild(status);

	const stack = document.createElement('div');
	root.appendChild(stack);

	const params = new URLSearchParams();
	params.set('kind', config.kind || 'all');
	if (config.minTier) params.set('minTier', config.minTier);

	const es = new EventSource(`${FEED_PATH}?${params.toString()}`, {
		withCredentials: true,
	});

	const maxCards = Math.max(1, Math.min(50, config.maxCards || 8));
	const protocol = ctx.protocol || (typeof window !== 'undefined' ? window.VIEWER?.agent_protocol : null);
	let narrateOn = config.autoNarrate !== false;

	const onNarrateToggle = (e) => {
		narrateOn = !!e.detail?.on;
	};
	(container || document.body).addEventListener('pumpfun-feed:set-narrate', onNarrateToggle);

	let focusMint = null;
	const matchesFocus = (ev) =>
		!focusMint || ev?.mint === focusMint || ev?.token_mint === focusMint;

	const onFocus = (e) => {
		focusMint = e.detail?.mint || null;
		// Mark visually when a filter is active.
		status.textContent = focusMint
			? `Live · pump.fun · ${focusMint.slice(0, 6)}…${focusMint.slice(-4)}`
			: 'Live · pump.fun';
		// Highlight: pulse the badge once.
		status.style.transition = 'color .2s';
		status.style.color = focusMint ? '#6ce0c8' : '';
	};
	(container || document.body).addEventListener('pumpfun-feed:focus-mint', onFocus);

	es.addEventListener('open', () => {
		status.textContent = focusMint
			? `Live · pump.fun · ${focusMint.slice(0, 6)}…${focusMint.slice(-4)}`
			: 'Live · pump.fun';
	});

	es.addEventListener('claim', (msg) => {
		const ev = safeJson(msg.data);
		if (!ev) return;
		if (!matchesFocus(ev)) return;
		addCard(stack, renderClaim(ev), maxCards);
		if (narrateOn) narrateClaim(protocol, ev);
	});

	es.addEventListener('graduation', (msg) => {
		const ev = safeJson(msg.data);
		if (!ev) return;
		if (!matchesFocus(ev)) return;
		addCard(stack, renderGraduation(ev), maxCards);
		if (narrateOn) narrateGraduation(protocol, ev);
	});

	es.addEventListener('error', () => {
		if (es.readyState === EventSource.CLOSED) {
			status.textContent = 'Disconnected.';
		}
	});

	es.addEventListener('close', () => {
		status.textContent = 'Reconnecting…';
	});

	return {
		destroy() {
			try {
				es.close();
			} catch {}
			(container || document.body).removeEventListener('pumpfun-feed:focus-mint', onFocus);
			(container || document.body).removeEventListener('pumpfun-feed:set-narrate', onNarrateToggle);
			root.remove();
		},
	};
}

function addCard(stack, el, max) {
	stack.prepend(el);
	while (stack.children.length > max) stack.lastChild?.remove();
}

function renderClaim(ev) {
	if (ev.first_time_claim && (ev.github_user || ev.github_repo || ev.github_account_age_days != null)) {
		return renderFirstGithubClaim(ev);
	}
	const el = document.createElement('div');
	el.style.cssText = cardStyle(ev.fake_claim ? '#3a1418' : ev.first_time_claim ? '#0d2d1a' : '#161616');
	const tier = ev.tier ? `${TIER_BADGE[ev.tier] || ''} ${ev.tier}` : '';
	const sol = ev.amount_sol != null ? `${Number(ev.amount_sol).toFixed(3)} SOL` : '';
	el.innerHTML = `
		<div style="display:flex;justify-content:space-between;font-size:11px;opacity:0.7">
			<span>${ev.first_time_claim ? '🚨 FIRST CLAIM' : 'Claim'}</span>
			<span>${tier}</span>
		</div>
		<div style="font-weight:600;margin-top:4px">${escapeHtml(ev.github_user ? '@' + ev.github_user : ev.claimer || '—')}</div>
		<div style="font-size:12px;opacity:0.85">${sol}${ev.token_symbol ? ' · $' + escapeHtml(ev.token_symbol) : ''}</div>
		${ev.ai_take ? `<div style="font-size:11px;opacity:0.75;margin-top:4px;font-style:italic">${escapeHtml(ev.ai_take)}</div>` : ''}
	`;
	return el;
}

function renderFirstGithubClaim(ev) {
	const el = document.createElement('div');
	el.style.cssText = [
		'background:linear-gradient(180deg,#0d2d1a 0%,#0a1f14 100%)',
		'border:1px solid rgba(108,224,200,0.35)',
		'border-radius:10px',
		'padding:12px 14px',
		'margin-bottom:8px',
		'box-shadow:0 4px 14px rgba(0,0,0,0.45)',
		'font-size:12px',
		'line-height:1.5',
	].join(';');

	const tier = ev.tier ? `${TIER_BADGE[ev.tier] || ''} ${cap(ev.tier)}` : '';
	const symbol = ev.token_symbol || ev.symbol;
	const name = ev.token_name || ev.name;
	const mint = ev.mint || ev.token_mint || '';
	const mcUsd = num(ev.market_cap_usd);
	const priceSol = ev.price_sol != null ? Number(ev.price_sol).toFixed(9).replace(/0+$/, '').replace(/\.$/, '') : null;
	const priceUsd = ev.price_usd != null ? Number(ev.price_usd).toFixed(6).replace(/0+$/, '').replace(/\.$/, '') : null;
	const createdAgo = relTime(ev.token_created_at || ev.created_at);
	const status = ev.graduated
		? 'Graduated to PumpAMM'
		: ev.curve_progress != null ? `Bonding curve (${Math.round(ev.curve_progress)}%)` : null;
	const ath = num(ev.ath_usd || ev.market_cap_ath_usd);
	const lastTrade = relTime(ev.last_trade_at);

	const claimNum = ev.claim_count ?? ev.claim_number ?? 1;
	const amtSol = ev.amount_sol != null ? Number(ev.amount_sol).toFixed(4) : null;
	const amtUsd = num(ev.amount_usd);
	const lifeSol = ev.lifetime_claim_sol != null ? Number(ev.lifetime_claim_sol).toFixed(4) : amtSol;
	const lifeUsd = num(ev.lifetime_claim_usd) || amtUsd;
	const claimType = ev.claim_type || 'Claim Social Fee PDA (GitHub)';

	const claimer = ev.claimer || ev.github_wallet;
	const tx = ev.tx_signature || ev.signature;

	const ghUser = ev.github_user;
	const ghName = ev.github_name;
	const ghRepos = ev.github_repos;
	const ghFollowers = ev.github_followers;
	const ghFollowing = ev.github_following;
	const ghAge = ev.github_account_age_days != null ? formatAccountAge(ev.github_account_age_days) : null;
	const ghLoc = ev.github_location;
	const ghBio = ev.github_bio;
	const ghTwitter = ev.github_twitter;

	const repoFull = ev.github_repo_full || (ghUser && ev.github_repo ? `${ghUser}/${ev.github_repo}` : null);
	const repoDesc = ev.github_repo_description;
	const repoLang = ev.github_repo_language;
	const repoStars = ev.github_repo_stars;
	const repoForks = ev.github_repo_forks;
	const repoLastPush = relTime(ev.github_repo_last_push);
	const repoCreated = relTime(ev.github_repo_created_at);
	const repoTopics = Array.isArray(ev.github_repo_topics) ? ev.github_repo_topics : null;

	const creator = ev.token_creator;
	const creatorLaunches = ev.creator_launches;
	const creatorGraduated = ev.creator_graduated;
	const creatorTokens = Array.isArray(ev.creator_recent_tokens) ? ev.creator_recent_tokens : null;

	const verified = ev.verified ?? ev.signal_verified;

	const sections = [];

	sections.push(`
		<div style="font-weight:700;color:#ff6e6e;letter-spacing:0.5px">🚨🚨🚨 FIRST CREATOR FEE CLAIM</div>
		${tier ? `<div style="opacity:0.85;margin-top:2px">${escapeHtml(tier)}</div>` : ''}
		${mint ? `<div style="font-family:ui-monospace,monospace;font-size:11px;opacity:0.7;margin-top:6px;word-break:break-all">${escapeHtml(mint)}</div>` : ''}
	`);

	const tokenLines = [];
	if (symbol || name) tokenLines.push(`🐙 ${symbol ? '$' + escapeHtml(symbol) : ''}${symbol && name ? ' — ' : ''}${name ? escapeHtml(name) : ''}`);
	if (mcUsd) tokenLines.push(`💰 MC: $${mcUsd}`);
	if (priceSol || priceUsd) tokenLines.push(`💲 Price: ${priceSol ? priceSol + ' SOL' : ''}${priceSol && priceUsd ? ' ' : ''}${priceUsd ? '($' + priceUsd + ')' : ''}`);
	if (createdAgo) tokenLines.push(`⏱ Created: ${createdAgo}`);
	if (status) tokenLines.push(`📈 Status: ${escapeHtml(status)}`);
	if (ath) tokenLines.push(`🏆 ATH: $${ath}`);
	if (lastTrade) tokenLines.push(`🕐 Last trade: ${lastTrade}`);
	if (tokenLines.length) sections.push(linesBlock(tokenLines));

	const claimLines = [`<b>Claim #${claimNum}</b>`];
	if (amtSol || amtUsd) claimLines.push(`${amtSol || '?'} SOL${amtUsd ? ' ($' + amtUsd + ')' : ''}`);
	if (lifeSol || lifeUsd) claimLines.push(`Lifetime claims: ${lifeSol || '?'} SOL${lifeUsd ? ' ($' + lifeUsd + ')' : ''}`);
	claimLines.push(`Type: ${escapeHtml(claimType)}`);
	sections.push(headedBlock('💸 Claim Stats', claimLines));

	if (claimer) {
		sections.push(headedBlock('👛 Claimed By', [
			escapeHtml(shortAddr(claimer)),
			`🔗 <a href="https://pump.fun/profile/${encodeURIComponent(claimer)}" target="_blank" rel="noopener" style="color:#6ce0c8">pump.fun/profile/${escapeHtml(shortAddr(claimer))}</a>`,
		]));
	}

	if (tx) {
		sections.push(headedBlock('🔎 Transaction', [
			`<a href="https://solscan.io/tx/${encodeURIComponent(tx)}" target="_blank" rel="noopener" style="color:#6ce0c8;word-break:break-all">solscan.io/tx/${escapeHtml(tx.slice(0, 24))}…</a>`,
		]));
	}

	if (ghUser || ghName) {
		const devLines = [];
		devLines.push(`<b>${escapeHtml(ghUser || '')}</b>${ghName ? ' (' + escapeHtml(ghName) + ')' : ''}`);
		if (ghRepos != null) devLines.push(`📦 Repos: ${ghRepos}`);
		if (ghFollowers != null) devLines.push(`👁 Followers: ${ghFollowers}`);
		if (ghFollowing != null) devLines.push(`👥 Following: ${ghFollowing}`);
		if (ghAge) devLines.push(`📅 Account age: ${ghAge}`);
		if (ghLoc) devLines.push(`📍 Location: ${escapeHtml(ghLoc)}`);
		if (ghBio) devLines.push(`<span style="opacity:0.85;font-style:italic">${escapeHtml(ghBio)}</span>`);
		if (ghTwitter) devLines.push(`𝕏 <a href="https://x.com/${encodeURIComponent(ghTwitter)}" target="_blank" rel="noopener" style="color:#6ce0c8">${escapeHtml(ghTwitter)}</a>`);
		sections.push(headedBlock('👨‍💻 Linked Dev', devLines));
	}

	if (repoFull) {
		const repoLines = [`<b>${escapeHtml(repoFull)}</b>`];
		if (repoDesc) repoLines.push(`<span style="opacity:0.85">${escapeHtml(repoDesc)}</span>`);
		if (repoLang) repoLines.push(`🔤 Language: ${escapeHtml(repoLang)}`);
		if (repoStars != null) repoLines.push(`⭐ Stars: ${repoStars}`);
		if (repoForks != null) repoLines.push(`🍴 Forks: ${repoForks}`);
		if (repoLastPush) repoLines.push(`🕐 Last push: ${repoLastPush}`);
		if (repoCreated) repoLines.push(`📅 Repo created: ${repoCreated}`);
		if (repoTopics?.length) repoLines.push(`🏷 Topics: ${repoTopics.map(escapeHtml).join(', ')}`);
		sections.push(headedBlock('📂 Repo Claimed', repoLines));
	}

	if (creator) {
		const cLines = [escapeHtml(shortAddr(creator))];
		if (creatorLaunches != null) cLines.push(`🚀 Launches: ${creatorLaunches}`);
		if (creatorGraduated != null) cLines.push(`🎓 Graduated: ${creatorGraduated}`);
		if (creatorTokens?.length) {
			const tokenStr = creatorTokens
				.slice(0, 3)
				.map((t) => `${escapeHtml(t.symbol || '?')}${t.tier ? TIER_BADGE[t.tier] || '' : ''}${t.market_cap_usd != null ? ' [' + num(t.market_cap_usd) + ']' : ''}`)
				.join(' · ');
			cLines.push(`🪙 ${tokenStr}`);
		}
		sections.push(headedBlock('🧑‍💻 Token Creator', cLines));
	}

	if (verified || ev.ai_take) {
		const sigLines = [];
		if (verified) sigLines.push('✅ Verified — token GitHub matches claimer');
		if (ev.ai_take) sigLines.push(`<span style="font-style:italic;opacity:0.85">${escapeHtml(ev.ai_take)}</span>`);
		sections.push(headedBlock('⚡ Signals', sigLines));
	}

	const links = [];
	if (mint) links.push(`<a href="https://pump.fun/coin/${encodeURIComponent(mint)}" target="_blank" rel="noopener" style="color:#6ce0c8">📊 pump.fun</a>`);
	if (ghTwitter) links.push(`<a href="https://x.com/${encodeURIComponent(ghTwitter)}" target="_blank" rel="noopener" style="color:#6ce0c8">𝕏 ${escapeHtml(ghTwitter)}</a>`);
	if (repoFull) links.push(`<a href="https://github.com/${repoFull.split('/').map(encodeURIComponent).join('/')}" target="_blank" rel="noopener" style="color:#6ce0c8">🌐 github.com/${escapeHtml(repoFull)}</a>`);
	if (links.length) sections.push(`<div style="margin-top:8px;display:flex;flex-direction:column;gap:2px">${links.join('')}</div>`);

	if (mint) {
		const trade = [
			`<a href="https://axiom.trade/t/${encodeURIComponent(mint)}" target="_blank" rel="noopener" style="color:#6ce0c8">Axiom</a>`,
			`<a href="https://gmgn.ai/sol/token/${encodeURIComponent(mint)}" target="_blank" rel="noopener" style="color:#6ce0c8">GMGN</a>`,
			`<a href="https://padre.gg/sol/${encodeURIComponent(mint)}" target="_blank" rel="noopener" style="color:#6ce0c8">Padre</a>`,
		].join(' | ');
		sections.push(`
			<div style="border-top:1px solid rgba(255,255,255,0.08);margin-top:10px;padding-top:8px">
				<div style="font-weight:600">💹 Trade</div>
				<div style="margin-top:2px">${trade}</div>
			</div>
		`);
	}

	el.innerHTML = sections.join('<div style="height:8px"></div>');
	return el;
}

function headedBlock(heading, lines) {
	return `
		<div>
			<div style="font-weight:600">${heading}</div>
			<div style="margin-top:2px">${lines.map((l) => `<div>${l}</div>`).join('')}</div>
		</div>
	`;
}

function linesBlock(lines) {
	return `<div>${lines.map((l) => `<div>${l}</div>`).join('')}</div>`;
}

function num(x) {
	if (x == null || !isFinite(x)) return null;
	const n = Number(x);
	if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
	return n.toFixed(2);
}

function relTime(t) {
	if (t == null) return null;
	const ts = typeof t === 'number' ? (t < 1e12 ? t * 1000 : t) : Date.parse(t);
	if (!isFinite(ts)) return null;
	const diff = Date.now() - ts;
	if (diff < 60_000) return `${Math.max(1, Math.round(diff / 1000))}s ago`;
	if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
	if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
	if (diff < 7 * 86_400_000) return `${Math.round(diff / 86_400_000)}d ago`;
	if (diff < 30 * 86_400_000) return `${Math.round(diff / (7 * 86_400_000))}w ago`;
	if (diff < 365 * 86_400_000) return `${Math.round(diff / (30 * 86_400_000))}mo ago`;
	return `${Math.round(diff / (365 * 86_400_000))}y ago`;
}

function formatAccountAge(days) {
	if (days < 30) return `${Math.round(days)}d ago`;
	if (days < 365) return `${Math.round(days / 30)}mo ago`;
	return `${Math.round(days / 365)}y ago`;
}

function shortAddr(s) {
	const str = String(s || '');
	if (str.length <= 12) return str;
	return `${str.slice(0, 6)}…${str.slice(-4)}`;
}

function cap(s) {
	const str = String(s || '');
	return str ? str[0].toUpperCase() + str.slice(1) : '';
}

function renderGraduation(ev) {
	const el = document.createElement('div');
	el.style.cssText = cardStyle('#1a1632');
	el.innerHTML = `
		<div style="font-size:11px;opacity:0.7">🎓 Graduation</div>
		<div style="font-weight:600;margin-top:4px">${escapeHtml(ev.name || ev.symbol || ev.mint)}</div>
		${ev.symbol ? `<div style="font-size:12px;opacity:0.85">$${escapeHtml(ev.symbol)}</div>` : ''}
	`;
	return el;
}

function cardStyle(bg) {
	return [
		`background:${bg}`,
		'border:1px solid rgba(255,255,255,0.08)',
		'border-radius:8px',
		'padding:10px 12px',
		'margin-bottom:6px',
		'box-shadow:0 2px 6px rgba(0,0,0,0.3)',
	].join(';');
}

function narrateClaim(protocol, ev) {
	if (!protocol) return;
	if (ev.first_time_claim) {
		protocol.emit({ type: 'emote', payload: { trigger: 'celebration', weight: 0.9 } });
		protocol.emit({
			type: 'speak',
			payload: {
				text: `First-time claim: ${ev.github_user ? '@' + ev.github_user : 'unknown'}${ev.ai_take ? ' — ' + ev.ai_take : ''}`,
				sentiment: 0.7,
			},
		});
	} else if (ev.fake_claim) {
		protocol.emit({ type: 'emote', payload: { trigger: 'concern', weight: 0.7 } });
		protocol.emit({
			type: 'speak',
			payload: { text: `Fake claim from ${ev.github_user || ev.claimer}.`, sentiment: -0.5 },
		});
	} else if (ev.tier === 'mega' || ev.tier === 'influencer') {
		protocol.emit({ type: 'emote', payload: { trigger: 'curiosity', weight: 0.5 } });
	}
}

function narrateGraduation(protocol, ev) {
	if (!protocol) return;
	protocol.emit({ type: 'gesture', payload: { name: 'wave', duration: 1500 } });
	protocol.emit({
		type: 'speak',
		payload: { text: `Graduation: ${ev.symbol || ev.name || 'a token'} hit PumpAMM.`, sentiment: 0.6 },
	});
}

function escapeHtml(s) {
	return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function safeJson(s) {
	try {
		return JSON.parse(s);
	} catch {
		return null;
	}
}
