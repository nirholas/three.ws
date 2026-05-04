/**
 * Pump.fun avatar reaction map.
 *
 * Given a feed event (mint / claim / graduation), returns the sequence of
 * protocol actions the avatar should perform: an emote stimulus (drives the
 * empathy layer), a one-shot gesture clip (visible body language / dance),
 * and an optional speak line. All clip names map to entries in
 * /public/animations/manifest.json. Slot names ('celebrate', 'concern',
 * 'wave', 'shake'…) flow through DEFAULT_ANIMATION_MAP; non-slot names
 * (e.g. 'rumba', 'thriller', 'silly', 'capoeira', 'taunt', 'kiss') are
 * resolved by the AnimationManager directly via _playSlot's fallback path.
 *
 * Design notes
 * ─────────────
 * - Each reaction is a plain { emote, gesture, speak } record so callers can
 *   route it through any combination of channels (full narration vs. silent
 *   gesture-only). This keeps narration toggle and avatar reaction decoupled.
 * - Durations are returned in milliseconds. agent-avatar's _onGesture
 *   converts to seconds before handing off to the animation manager.
 * - A single dispatcher (`reactToEvent`) runs the dedupe + cooldown gate so
 *   the host page and the in-iframe widget can both call it without stepping
 *   on each other when both are mounted (e.g. /pumpfun.html host page +
 *   pumpfun-feed widget mounted inside /app).
 */

/** @typedef {{ emote?: { trigger: string, weight: number },
 *              gesture?: { name: string, duration: number },
 *              speak?: { text: string, sentiment: number },
 *              priority?: number }} Reaction */

const TIER_WEIGHT = { mega: 1.0, influencer: 0.75, notable: 0.5 };

/**
 * Decide which reaction to play for a given pump.fun event.
 * Returns null when nothing notable should happen (silent flyby).
 *
 * @param {string} kind  'mint' | 'claim' | 'graduation'
 * @param {object} ev    raw event payload from /api/agents/pumpfun-feed
 * @returns {Reaction|null}
 */
export function reactionFor(kind, ev) {
	if (!ev) return null;
	if (kind === 'graduation') return graduationReaction(ev);
	if (kind === 'claim') return claimReaction(ev);
	if (kind === 'mint') return mintReaction(ev);
	return null;
}

function graduationReaction(ev) {
	const sym = ev.symbol || ev.name || 'a token';
	// Graduation = the milestone moment. Always celebrate big.
	// Bigger MC delta gets a longer dance, capped.
	const initial = num(ev.market_cap_usd_initial ?? ev.initial_market_cap_usd ?? ev.market_cap_at_launch);
	const current = num(ev.usd_market_cap ?? ev.market_cap_usd ?? ev.market_cap);
	const multiple = initial && current ? current / initial : 1;
	const duration = clamp(4500 + Math.log10(Math.max(multiple, 1)) * 1500, 4500, 9000);
	return {
		emote: { trigger: 'celebration', weight: 0.95 },
		gesture: { name: 'rumba', duration },
		speak: { text: `Migration: ${sym} bonded to PumpAMM.`, sentiment: 0.7 },
		priority: 90,
	};
}

function claimReaction(ev) {
	if (ev.fake_claim) {
		return {
			emote: { trigger: 'concern', weight: 0.75 },
			gesture: { name: 'shake', duration: 1500 },
			speak: {
				text: `Fake claim from ${ev.github_user ? '@' + ev.github_user : shortAddr(ev.claimer)}.`,
				sentiment: -0.6,
			},
			priority: 70,
		};
	}

	if (ev.first_time_claim) {
		// First-claim variants: GitHub-linked → silly hip-hop, raw wallet → celebrate clip.
		const linked = !!(ev.github_user || ev.github_repo || ev.github_account_age_days != null);
		const verified = ev.verified ?? ev.signal_verified;
		const gestureName = linked ? (verified ? 'thriller' : 'silly') : 'celebrate';
		const sym = ev.token_symbol || ev.symbol;
		const who = linked ? '@' + ev.github_user : shortAddr(ev.claimer || ev.creator);
		return {
			emote: { trigger: 'celebration', weight: 0.95 },
			gesture: { name: gestureName, duration: 5000 },
			speak: {
				text: `First-time claim by ${who}${sym ? ' on $' + sym : ''}${ev.ai_take ? ' — ' + ev.ai_take : ''}.`,
				sentiment: 0.75,
			},
			priority: 85,
		};
	}

	// Tiered repeat claims — quieter, no full dance.
	const tier = ev.tier;
	if (tier === 'mega') {
		return {
			emote: { trigger: 'celebration', weight: 0.7 },
			gesture: { name: 'taunt', duration: 2500 },
			priority: 50,
		};
	}
	if (tier === 'influencer') {
		return {
			emote: { trigger: 'curiosity', weight: 0.55 },
			gesture: { name: 'reaction', duration: 1800 },
			priority: 35,
		};
	}
	if (tier === 'notable') {
		return {
			emote: { trigger: 'curiosity', weight: 0.4 },
			priority: 20,
		};
	}
	return null;
}

function mintReaction(ev) {
	// Mints fire constantly. Only react to ones with notable initial buy or
	// that come pre-tiered, otherwise the avatar would never stop reacting.
	const initialSol = num(ev.initial_buy_sol);
	if (ev.tier === 'mega' || (initialSol && initialSol >= 5)) {
		return {
			emote: { trigger: 'curiosity', weight: 0.55 },
			gesture: { name: 'wave', duration: 1500 },
			priority: 25,
		};
	}
	if (ev.tier === 'influencer' || (initialSol && initialSol >= 1)) {
		return {
			emote: { trigger: 'curiosity', weight: 0.35 },
			priority: 10,
		};
	}
	return null;
}

/**
 * Stateful dispatcher: dedupes reactions per (kind,mint), enforces a global
 * cooldown so a flood of claims doesn't lock the avatar into a 5s loop, and
 * lets a higher-priority reaction (graduation > first-claim > tier) preempt
 * a lower one already in flight.
 *
 * @param {{ now?: () => number, cooldownMs?: number }} [opts]
 */
export function createReactionDispatcher(opts = {}) {
	const now = opts.now || (() => Date.now());
	const cooldownMs = opts.cooldownMs ?? 2200;
	const dedupeWindowMs = 30_000;
	/** @type {Map<string, number>} */
	const seen = new Map();
	let activeUntil = 0;
	let activePriority = 0;

	return {
		/**
		 * @param {string} kind
		 * @param {object} ev
		 * @param {(reaction: Reaction) => void} run
		 * @returns {boolean} whether the reaction was dispatched
		 */
		dispatch(kind, ev, run) {
			const reaction = reactionFor(kind, ev);
			if (!reaction) return false;

			const t = now();
			const key = dedupeKey(kind, ev);
			if (key) {
				const last = seen.get(key);
				if (last != null && t - last < dedupeWindowMs) return false;
				seen.set(key, t);
				// Prune: keep map bounded.
				if (seen.size > 200) {
					for (const [k, v] of seen) {
						if (t - v > dedupeWindowMs) seen.delete(k);
					}
				}
			}

			const priority = reaction.priority ?? 0;
			if (t < activeUntil && priority <= activePriority) return false;

			const dur = reaction.gesture?.duration ?? cooldownMs;
			activeUntil = t + Math.max(cooldownMs, dur);
			activePriority = priority;
			run(reaction);
			return true;
		},
		_state() {
			return { activeUntil, activePriority, seen };
		},
	};
}

/**
 * Apply a Reaction by emitting protocol actions. Caller controls which
 * channels are live via `flags` so a muted host can still drive gestures.
 *
 * @param {{ emit: (a: any) => void } | null} protocol
 * @param {Reaction} reaction
 * @param {{ emote?: boolean, gesture?: boolean, speak?: boolean }} [flags]
 */
export function applyReaction(protocol, reaction, flags = {}) {
	if (!protocol || !reaction) return;
	const want = { emote: true, gesture: true, speak: true, ...flags };
	if (want.emote && reaction.emote) {
		protocol.emit({ type: 'emote', payload: reaction.emote });
	}
	if (want.gesture && reaction.gesture) {
		protocol.emit({ type: 'gesture', payload: reaction.gesture });
	}
	if (want.speak && reaction.speak) {
		protocol.emit({ type: 'speak', payload: reaction.speak });
	}
}

function dedupeKey(kind, ev) {
	const mint = ev?.mint || ev?.token_mint;
	if (!mint) return null;
	if (kind === 'claim') return `claim:${mint}:${ev?.tx_signature || ev?.signature || ev?.claim_number || ''}`;
	return `${kind}:${mint}`;
}

function num(x) {
	if (x == null) return 0;
	const n = Number(x);
	return Number.isFinite(n) ? n : 0;
}

function clamp(v, lo, hi) {
	return Math.max(lo, Math.min(hi, v));
}

function shortAddr(s) {
	const str = String(s || '');
	if (!str) return 'unknown';
	if (str.length <= 12) return str;
	return `${str.slice(0, 4)}…${str.slice(-4)}`;
}
