/**
 * Pump.fun avatar reaction engine.
 *
 * Given a raw feed event from /api/agents/pumpfun-feed, decides:
 *   1. how to derive a richer "signal envelope" (tier shape, MC delta, dev
 *      track record, GitHub legitimacy, curve proximity, post-graduation
 *      health, whale-claimer flag) from the messy upstream payload
 *   2. which Reaction (emote + gesture + speak + look-at) best matches that
 *      envelope across the full animation library
 *   3. when to fire vs. defer it given an in-flight gesture, dedupe history,
 *      and the configured personality/mood
 *
 * Design pillars
 * ──────────────
 * - **Pure** reaction map — `reactionFor(kind, ev, opts)` is deterministic
 *   so it tests cleanly and composes with mood biases.
 * - **One-liner speak** for every variant. Avatar can be muted, but when
 *   narration is on, it always has something to say.
 * - **Queue, not drop** — if an event lands mid-dance and is too low-priority
 *   to preempt, it's enqueued and fires after cooldown, ordered by priority.
 * - **Telemetry** — ring buffer of the last N reactions and per-variant
 *   counts, available via `.history()` / `.stats()` for debug surfaces.
 * - **Mood** — 'chill' | 'normal' | 'hype' biases gesture duration and
 *   raises/lowers the threshold at which low-priority events fire at all.
 *
 * Animation library coverage (32 clips → 23 used distinct):
 *   rumba, thriller, silly, capoeira, dance, kiss, taunt, celebrate,
 *   reaction, wave, jump, pray, sitclap, sitlaugh, shake, defeated,
 *   angry, dying, falling, dodge, stepback, shoved, standup
 */

/**
 * @typedef {{ trigger: string, weight: number }} EmotePayload
 * @typedef {{ name: string, duration: number }} GesturePayload
 * @typedef {{ text: string, sentiment: number }} SpeakPayload
 * @typedef {'token'|'camera'|'down'|'up'} LookTarget
 *
 * @typedef {Object} Reaction
 * @property {string} variant   stable identifier for telemetry / toasts
 * @property {string} icon      emoji icon for UI overlays
 * @property {EmotePayload} [emote]
 * @property {GesturePayload} [gesture]
 * @property {SpeakPayload} [speak]
 * @property {LookTarget} [lookAt]
 * @property {number} [priority]  higher = preempts lower in-flight reactions
 */

/** @typedef {'chill'|'normal'|'hype'} Mood */

const MOOD_PROFILE = {
	chill:  { gestureScale: 0.7, threshold: 30, speakRate: 0.4 },
	normal: { gestureScale: 1.0, threshold: 0,  speakRate: 1.0 },
	hype:   { gestureScale: 1.25, threshold: -20, speakRate: 1.5 },
};

const TIER_RANK = { mega: 3, influencer: 2, notable: 1 };

/**
 * Extract a normalized signal envelope from a raw feed event. Centralizes the
 * dozens of `??` / fallback chains so the reaction map can read clean fields.
 *
 * @param {object} ev
 * @returns {object}
 */
export function extractSignals(ev) {
	if (!ev) return {};
	const num = (x) => {
		const n = Number(x);
		return Number.isFinite(n) ? n : 0;
	};

	const mint = ev.mint || ev.token_mint || '';
	const symbol = ev.symbol || ev.token_symbol || '';
	const name = ev.name || ev.token_name || symbol || 'a token';

	const mcInitial = num(ev.market_cap_usd_initial ?? ev.initial_market_cap_usd ?? ev.market_cap_at_launch);
	const mcCurrent = num(ev.usd_market_cap ?? ev.market_cap_usd ?? ev.market_cap);
	const mcAth = num(ev.ath_market_cap ?? ev.ath_usd ?? ev.market_cap_ath_usd);
	const mcMultiple = mcInitial && mcCurrent ? mcCurrent / mcInitial : 0;
	const drawdown = mcAth && mcCurrent ? mcCurrent / mcAth : 1; // 1 = at ATH, 0.1 = down 90%
	const initialBuySol = num(ev.initial_buy_sol);
	const amountSol = num(ev.amount_sol);
	const amountUsd = num(ev.amount_usd);
	const lifetimeSol = num(ev.lifetime_claim_sol ?? ev.lifetime_sol);
	const curvePct = num(ev.bonding_curve_pct ?? ev.curve_progress);

	// Creator / dev cred
	const creatorLaunches = num(ev.creator_launches);
	const creatorGraduated = num(ev.creator_graduated);
	const isSerialCreator = creatorGraduated >= 3;
	const isFirstLaunch = creatorLaunches <= 1;
	const isDevRelaunch = creatorLaunches >= 2 && creatorGraduated === 0;

	// GitHub / claim legitimacy
	const ghUser = ev.github_user || null;
	const ghLinked = !!(ghUser || ev.github_repo || ev.github_account_age_days != null);
	const ghVerified = !!(ev.verified ?? ev.signal_verified);
	const ghFollowers = num(ev.github_followers);
	const ghAccountAgeDays = num(ev.github_account_age_days);
	const repoStars = num(ev.github_repo_stars ?? ev.repo_stars);
	const ghCredible = ghLinked && (ghAccountAgeDays >= 365 || ghFollowers >= 50 || repoStars >= 10);

	// Outcome flags
	const isFirstClaim = !!ev.first_time_claim;
	const isFakeClaim = !!ev.fake_claim;
	const isWhaleClaim = lifetimeSol >= 50; // >= 50 SOL lifetime → whale
	const tier = (ev.tier || '').toLowerCase() || null;
	const tierRank = TIER_RANK[tier] || 0;

	// Health flags
	const isRugged = mcAth > 0 && mcCurrent > 0 && drawdown <= 0.1; // down >= 90% from ATH
	const isMooning = mcMultiple >= 100;
	const isGiantPump = mcMultiple >= 10 && mcMultiple < 100;
	const isNearGrad = curvePct >= 95 && curvePct < 100;

	return {
		mint, symbol, name,
		mcInitial, mcCurrent, mcAth, mcMultiple, drawdown, curvePct,
		initialBuySol, amountSol, amountUsd, lifetimeSol,
		creatorLaunches, creatorGraduated,
		isSerialCreator, isFirstLaunch, isDevRelaunch,
		ghUser, ghLinked, ghVerified, ghCredible, ghFollowers, repoStars, ghAccountAgeDays,
		isFirstClaim, isFakeClaim, isWhaleClaim,
		tier, tierRank,
		isRugged, isMooning, isGiantPump, isNearGrad,
		txSig: ev.tx_signature || ev.signature || null,
		aiTake: ev.ai_take || null,
	};
}

/**
 * @param {string} kind   'mint' | 'claim' | 'graduation' | 'trade'
 * @param {object} ev     raw event payload
 * @param {{ mood?: Mood }} [opts]
 * @returns {Reaction|null}
 */
export function reactionFor(kind, ev, opts = {}) {
	if (!ev) return null;
	const s = extractSignals(ev);
	let r = null;
	if (kind === 'graduation') r = graduationReaction(s);
	else if (kind === 'claim') r = claimReaction(s);
	else if (kind === 'mint') r = mintReaction(s);
	else if (kind === 'trade') r = tradeReaction(s, ev);

	if (!r) return null;
	const profile = MOOD_PROFILE[opts.mood] || MOOD_PROFILE.normal;
	const priority = (r.priority ?? 0) + profile.threshold;
	if (priority < 0) return null;
	if (r.gesture) r.gesture = { ...r.gesture, duration: Math.round(r.gesture.duration * profile.gestureScale) };
	r.priority = priority;
	return r;
}

// ── Variants ─────────────────────────────────────────────────────────────────

function graduationReaction(s) {
	if (s.isMooning) {
		return {
			variant: 'graduation_moonshot',
			icon: '🚀🌕',
			emote: { trigger: 'celebration', weight: 1.0 },
			gesture: { name: 'thriller', duration: 9000 },
			speak: { text: `Moonshot! $${s.symbol || s.name} just went ${fmtMult(s.mcMultiple)} — bonded to PumpAMM.`, sentiment: 0.95 },
			lookAt: 'camera',
			priority: 100,
		};
	}
	if (s.isGiantPump) {
		return {
			variant: 'graduation_giant',
			icon: '🎓🔥',
			emote: { trigger: 'celebration', weight: 0.95 },
			gesture: { name: 'rumba', duration: 7000 },
			speak: { text: `Giant pump: $${s.symbol || s.name} ${fmtMult(s.mcMultiple)} into PumpAMM.`, sentiment: 0.85 },
			lookAt: 'camera',
			priority: 95,
		};
	}
	if (s.isSerialCreator) {
		return {
			variant: 'graduation_serial_dev',
			icon: '🎓👑',
			emote: { trigger: 'celebration', weight: 0.85 },
			gesture: { name: 'capoeira', duration: 6500 },
			speak: { text: `Serial creator strikes again — $${s.symbol || s.name} graduated. ${s.creatorGraduated} grads now.`, sentiment: 0.7 },
			lookAt: 'camera',
			priority: 92,
		};
	}
	return {
		variant: 'graduation_standard',
		icon: '🎓',
		emote: { trigger: 'celebration', weight: 0.9 },
		gesture: { name: 'rumba', duration: clampDur(4500 + Math.log10(Math.max(s.mcMultiple, 1) + 1) * 1500, 4500, 8000) },
		speak: { text: `Migration: $${s.symbol || s.name} bonded to PumpAMM.`, sentiment: 0.7 },
		lookAt: 'camera',
		priority: 90,
	};
}

function claimReaction(s) {
	if (s.isFakeClaim) {
		return {
			variant: 'claim_fake',
			icon: '⚠️',
			emote: { trigger: 'concern', weight: 0.85 },
			gesture: { name: 'shake', duration: 1800 },
			speak: { text: `Fake claim spotted${s.ghUser ? ' from @' + s.ghUser : ''}. Ignore it.`, sentiment: -0.6 },
			lookAt: 'down',
			priority: 75,
		};
	}

	if (s.isFirstClaim) {
		// Tiered first-claim variants — credibility ladders the dance.
		if (s.ghCredible && s.ghVerified) {
			return {
				variant: 'claim_first_verified_credible',
				icon: '🚨✅',
				emote: { trigger: 'celebration', weight: 1.0 },
				gesture: { name: 'thriller', duration: 6000 },
				speak: { text: `Verified first claim by @${s.ghUser}${s.aiTake ? ' — ' + s.aiTake : ''}.`, sentiment: 0.85 },
				lookAt: 'camera',
				priority: 88,
			};
		}
		if (s.ghLinked && s.ghVerified) {
			return {
				variant: 'claim_first_verified',
				icon: '🚨',
				emote: { trigger: 'celebration', weight: 0.95 },
				gesture: { name: 'silly', duration: 5500 },
				speak: { text: `First claim by @${s.ghUser || 'dev'}${s.aiTake ? ' — ' + s.aiTake : ''}.`, sentiment: 0.8 },
				lookAt: 'camera',
				priority: 86,
			};
		}
		if (s.ghLinked) {
			return {
				variant: 'claim_first_unverified_gh',
				icon: '🚨❓',
				emote: { trigger: 'curiosity', weight: 0.7 },
				gesture: { name: 'capoeira', duration: 4500 },
				speak: { text: `First claim — @${s.ghUser || 'dev'} unverified. Watch closely.`, sentiment: 0.4 },
				lookAt: 'token',
				priority: 82,
			};
		}
		if (s.isWhaleClaim) {
			return {
				variant: 'claim_first_whale',
				icon: '🐋',
				emote: { trigger: 'celebration', weight: 0.85 },
				gesture: { name: 'taunt', duration: 3000 },
				speak: { text: `Whale claimer — ${fmtSol(s.lifetimeSol)} lifetime on $${s.symbol || 'this'}.`, sentiment: 0.6 },
				lookAt: 'token',
				priority: 80,
			};
		}
		return {
			variant: 'claim_first_raw',
			icon: '🚨',
			emote: { trigger: 'celebration', weight: 0.85 },
			gesture: { name: 'celebrate', duration: 4500 },
			speak: { text: `First-time claim on $${s.symbol || 'a new token'}.`, sentiment: 0.7 },
			lookAt: 'camera',
			priority: 78,
		};
	}

	// Repeat claims — calm, no full dance.
	if (s.isWhaleClaim) {
		return {
			variant: 'claim_whale_repeat',
			icon: '🐋',
			emote: { trigger: 'curiosity', weight: 0.6 },
			gesture: { name: 'taunt', duration: 2200 },
			speak: { text: `Whale claim — ${fmtSol(s.amountSol)} on $${s.symbol || 'token'}.`, sentiment: 0.4 },
			lookAt: 'token',
			priority: 55,
		};
	}
	if (s.tier === 'mega') {
		return {
			variant: 'claim_tier_mega',
			icon: '🔥🔥',
			emote: { trigger: 'celebration', weight: 0.7 },
			gesture: { name: 'taunt', duration: 2500 },
			speak: { text: `Mega claim — ${fmtSol(s.amountSol)}.`, sentiment: 0.5 },
			lookAt: 'token',
			priority: 50,
		};
	}
	if (s.tier === 'influencer') {
		return {
			variant: 'claim_tier_influencer',
			icon: '🔥',
			emote: { trigger: 'curiosity', weight: 0.55 },
			gesture: { name: 'reaction', duration: 1800 },
			speak: { text: `Influencer claim on $${s.symbol || 'token'}.`, sentiment: 0.3 },
			lookAt: 'token',
			priority: 35,
		};
	}
	if (s.tier === 'notable') {
		return {
			variant: 'claim_tier_notable',
			icon: '⭐',
			emote: { trigger: 'curiosity', weight: 0.4 },
			speak: { text: `Notable claim seen.`, sentiment: 0.2 },
			lookAt: 'token',
			priority: 20,
		};
	}
	return null;
}

function mintReaction(s) {
	if (s.initialBuySol >= 20) {
		return {
			variant: 'mint_giant_buy',
			icon: '🚀💸',
			emote: { trigger: 'curiosity', weight: 0.85 },
			gesture: { name: 'jump', duration: 2000 },
			speak: { text: `Massive launch: $${s.symbol || 'new token'} opens with ${fmtSol(s.initialBuySol)}.`, sentiment: 0.6 },
			lookAt: 'camera',
			priority: 60,
		};
	}
	if (s.isDevRelaunch) {
		return {
			variant: 'mint_dev_relaunch',
			icon: '🔁',
			emote: { trigger: 'concern', weight: 0.5 },
			gesture: { name: 'reaction', duration: 1600 },
			speak: { text: `Dev's back — ${s.creatorLaunches} launches, 0 grads. $${s.symbol}.`, sentiment: -0.2 },
			lookAt: 'down',
			priority: 40,
		};
	}
	if (s.isSerialCreator) {
		return {
			variant: 'mint_serial_creator',
			icon: '👑',
			emote: { trigger: 'curiosity', weight: 0.7 },
			gesture: { name: 'wave', duration: 1500 },
			speak: { text: `Pro dev launching $${s.symbol || 'a new token'} — ${s.creatorGraduated} prior grads.`, sentiment: 0.5 },
			lookAt: 'camera',
			priority: 45,
		};
	}
	if (s.tier === 'mega' || s.initialBuySol >= 5) {
		return {
			variant: 'mint_notable',
			icon: '🌱🔥',
			emote: { trigger: 'curiosity', weight: 0.55 },
			gesture: { name: 'wave', duration: 1500 },
			speak: { text: `New token $${s.symbol || '?'} — ${fmtSol(s.initialBuySol)} initial.`, sentiment: 0.3 },
			lookAt: 'token',
			priority: 25,
		};
	}
	if (s.tier === 'influencer' || s.initialBuySol >= 1) {
		return {
			variant: 'mint_warm',
			icon: '🌱',
			emote: { trigger: 'curiosity', weight: 0.35 },
			lookAt: 'token',
			priority: 10,
		};
	}
	return null;
}

function tradeReaction(s, ev) {
	const usd = Number(ev?.amount_usd) || 0;
	const isBuy = ev?.is_buy ?? ev?.isBuy ?? (ev?.txType === 'buy') ?? (ev?.type === 'buy');
	if (usd < 1000) return null;
	if (isBuy) {
		if (usd >= 50_000) {
			return {
				variant: 'trade_whale_buy',
				icon: '🐋💚',
				emote: { trigger: 'celebration', weight: 0.85 },
				gesture: { name: 'jump', duration: 2200 },
				speak: { text: `Whale buy — ${fmtUsd(usd)} into $${s.symbol || 'token'}.`, sentiment: 0.7 },
				lookAt: 'camera',
				priority: 65,
			};
		}
		return {
			variant: 'trade_big_buy',
			icon: '💚',
			emote: { trigger: 'celebration', weight: 0.55 },
			gesture: { name: 'wave', duration: 1200 },
			speak: { text: `Big buy on $${s.symbol || 'token'}.`, sentiment: 0.4 },
			lookAt: 'token',
			priority: 30,
		};
	}
	// Sells
	if (usd >= 50_000) {
		return {
			variant: 'trade_whale_sell',
			icon: '🐋💀',
			emote: { trigger: 'concern', weight: 0.85 },
			gesture: { name: 'shoved', duration: 1800 },
			speak: { text: `Whale dump — ${fmtUsd(usd)} out of $${s.symbol || 'token'}.`, sentiment: -0.7 },
			lookAt: 'down',
			priority: 65,
		};
	}
	return {
		variant: 'trade_big_sell',
		icon: '🩸',
		emote: { trigger: 'concern', weight: 0.5 },
		gesture: { name: 'dodge', duration: 1300 },
		speak: { text: `Big sell on $${s.symbol || 'token'}.`, sentiment: -0.4 },
		lookAt: 'down',
		priority: 30,
	};
}

// ── Dispatcher ───────────────────────────────────────────────────────────────

/**
 * Stateful dispatcher: dedupes per (kind,mint), enforces a global cooldown,
 * supports priority preemption, queues high-priority events that arrive
 * mid-gesture, and tracks telemetry.
 *
 * @param {{
 *   now?: () => number,
 *   cooldownMs?: number,
 *   dedupeWindowMs?: number,
 *   mood?: Mood,
 *   maxQueue?: number,
 *   maxHistory?: number,
 *   onFire?: (reaction: Reaction, kind: string, ev: object) => void,
 * }} [opts]
 */
export function createReactionDispatcher(opts = {}) {
	const now = opts.now || (() => Date.now());
	const cooldownMs = opts.cooldownMs ?? 2200;
	const dedupeWindowMs = opts.dedupeWindowMs ?? 30_000;
	const maxQueue = opts.maxQueue ?? 6;
	const maxHistory = opts.maxHistory ?? 50;
	let mood = opts.mood || 'normal';

	/** @type {Map<string, number>} */
	const seen = new Map();
	let activeUntil = 0;
	let activePriority = 0;
	/** @type {{ kind: string, ev: object, priority: number, enqueuedAt: number, runner: (r: Reaction)=>void }[]} */
	const queue = [];
	/** @type {{ at: number, kind: string, variant: string, mint: string }[]} */
	const history = [];
	const stats = Object.create(null); // variant → count
	let queueTimer = null;

	function record(reaction, kind, ev) {
		stats[reaction.variant] = (stats[reaction.variant] || 0) + 1;
		history.push({
			at: now(),
			kind,
			variant: reaction.variant,
			mint: ev?.mint || ev?.token_mint || '',
		});
		while (history.length > maxHistory) history.shift();
		try { opts.onFire?.(reaction, kind, ev); } catch {}
		// Toast overlays attach themselves via dispatcher._toastHook.
		try { dispatcherSelf._toastHook?.(reaction, kind, ev); } catch {}
	}

	let dispatcherSelf;

	function tryDrainQueue() {
		queueTimer = null;
		if (!queue.length) return;
		const t = now();
		if (t < activeUntil) {
			scheduleDrain();
			return;
		}
		queue.sort((a, b) => b.priority - a.priority);
		const next = queue.shift();
		const reaction = reactionFor(next.kind, next.ev, { mood });
		if (!reaction) {
			scheduleDrain();
			return;
		}
		fire(reaction, next.kind, next.ev, next.runner);
		scheduleDrain();
	}

	function scheduleDrain() {
		if (queueTimer != null || !queue.length) return;
		const wait = Math.max(0, activeUntil - now());
		queueTimer = setTimeout(tryDrainQueue, wait + 5);
	}

	function fire(reaction, kind, ev, runner) {
		const dur = reaction.gesture?.duration ?? cooldownMs;
		activeUntil = now() + Math.max(cooldownMs, dur);
		activePriority = reaction.priority ?? 0;
		record(reaction, kind, ev);
		try { runner(reaction); } catch (err) {
			console.warn('[pumpfun-reactions] runner threw:', err);
		}
	}

	dispatcherSelf = {
		/**
		 * @param {string} kind
		 * @param {object} ev
		 * @param {(reaction: Reaction) => void} run
		 * @returns {'fired'|'queued'|'deduped'|'dropped'|'silent'}
		 */
		dispatch(kind, ev, run) {
			const reaction = reactionFor(kind, ev, { mood });
			if (!reaction) return 'silent';

			const t = now();
			const key = dedupeKey(kind, ev);
			if (key) {
				const last = seen.get(key);
				if (last != null && t - last < dedupeWindowMs) return 'deduped';
				seen.set(key, t);
				if (seen.size > 200) {
					for (const [k, v] of seen) if (t - v > dedupeWindowMs) seen.delete(k);
				}
			}

			const priority = reaction.priority ?? 0;
			if (t < activeUntil) {
				if (priority > activePriority) {
					fire(reaction, kind, ev, run);
					return 'fired';
				}
				if (priority >= 30 && queue.length < maxQueue) {
					queue.push({ kind, ev, priority, enqueuedAt: t, runner: run });
					scheduleDrain();
					return 'queued';
				}
				return 'dropped';
			}

			fire(reaction, kind, ev, run);
			return 'fired';
		},
		setMood(next) { if (MOOD_PROFILE[next]) mood = next; },
		mood: () => mood,
		history: () => history.slice(),
		stats: () => ({ ...stats }),
		queueDepth: () => queue.length,
		_state() { return { activeUntil, activePriority, seen, queue, history, stats }; },
	};
	return dispatcherSelf;
}

/**
 * Apply a Reaction by emitting protocol actions. Caller controls which
 * channels are live so a muted host can still drive gestures.
 *
 * @param {{ emit: (a: any) => void } | null} protocol
 * @param {Reaction} reaction
 * @param {{ emote?: boolean, gesture?: boolean, speak?: boolean, lookAt?: boolean }} [flags]
 */
export function applyReaction(protocol, reaction, flags = {}) {
	if (!protocol || !reaction) return;
	const want = { emote: true, gesture: true, speak: true, lookAt: true, ...flags };
	if (want.emote && reaction.emote) {
		protocol.emit({ type: 'emote', payload: reaction.emote });
	}
	if (want.lookAt && reaction.lookAt) {
		protocol.emit({ type: 'look-at', payload: { target: reaction.lookAt } });
	}
	if (want.gesture && reaction.gesture) {
		protocol.emit({ type: 'gesture', payload: reaction.gesture });
	}
	if (want.speak && reaction.speak) {
		protocol.emit({ type: 'speak', payload: reaction.speak });
	}
}

/**
 * Mount a small overlay near the avatar that flashes the reaction icon and
 * variant label whenever the avatar reacts. Returns a destroy function.
 *
 * @param {HTMLElement} container
 * @param {ReturnType<createReactionDispatcher>} dispatcher
 */
export function mountReactionToast(container, dispatcher) {
	if (!container) return () => {};
	const root = document.createElement('div');
	root.className = 'pumpfun-reaction-toast';
	root.style.cssText = [
		'position:absolute', 'left:16px', 'top:16px',
		'display:flex', 'flex-direction:column', 'gap:6px',
		'pointer-events:none', 'z-index:6',
		'font-family:ui-sans-serif,system-ui,-apple-system,sans-serif',
	].join(';');
	container.appendChild(root);

	const original = dispatcher._state().history;
	const onFire = (reaction, kind, ev) => {
		const el = document.createElement('div');
		el.style.cssText = [
			'background:rgba(20,20,28,0.85)',
			'border:1px solid rgba(255,255,255,0.12)',
			'border-radius:999px',
			'padding:6px 12px',
			'color:#fff', 'font-size:12px',
			'display:flex', 'gap:8px', 'align-items:center',
			'box-shadow:0 4px 14px rgba(0,0,0,0.45)',
			'opacity:0', 'transform:translateY(-4px)',
			'transition:opacity .22s ease, transform .22s ease',
			'max-width:260px',
		].join(';');
		const sym = ev?.symbol || ev?.token_symbol || ev?.name || '';
		el.innerHTML = `<span style="font-size:16px">${reaction.icon || '✨'}</span><span style="font-weight:600">${reaction.variant.replace(/_/g, ' ')}</span>${sym ? `<span style="opacity:0.7">$${escapeHtml(sym)}</span>` : ''}`;
		root.appendChild(el);
		requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'translateY(0)'; });
		setTimeout(() => {
			el.style.opacity = '0';
			el.style.transform = 'translateY(-4px)';
			setTimeout(() => el.remove(), 250);
		}, Math.max(2200, (reaction.gesture?.duration || 1500) - 500));
		// Cap visible toasts so a flood doesn't stack forever.
		while (root.children.length > 4) root.firstChild?.remove();
		void original; // keep reference happy
	};

	// Wrap dispatcher.onFire — expose by re-wiring through a hook.
	dispatcher._toastHook = onFire;
	return () => { root.remove(); dispatcher._toastHook = null; };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function dedupeKey(kind, ev) {
	const mint = ev?.mint || ev?.token_mint;
	if (!mint) return null;
	if (kind === 'claim') return `claim:${mint}:${ev?.tx_signature || ev?.signature || ev?.claim_number || ''}`;
	if (kind === 'trade') return `trade:${mint}:${ev?.tx_signature || ev?.signature || ev?.ts || ''}`;
	return `${kind}:${mint}`;
}

function clampDur(v, lo, hi) {
	return Math.max(lo, Math.min(hi, Math.round(v)));
}

function fmtUsd(n) {
	if (!Number.isFinite(n) || n <= 0) return '$0';
	if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
	if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
	return `$${Math.round(n)}`;
}
function fmtSol(n) {
	if (!Number.isFinite(n) || n <= 0) return '0 SOL';
	if (n >= 1000) return `${Math.round(n)} SOL`;
	return `${n.toFixed(2)} SOL`;
}
function fmtMult(m) {
	if (!Number.isFinite(m) || m <= 0) return '—';
	if (m >= 100) return `${Math.round(m)}×`;
	if (m >= 10) return `${m.toFixed(0)}×`;
	return `${m.toFixed(1)}×`;
}
function escapeHtml(s) {
	return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
