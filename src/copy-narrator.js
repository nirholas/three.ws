/**
 * Copy-trade narration: the followed agent explains each copied trade itself.
 *
 * While a viewer follows an agent and the agent's page is visible, this reads
 * the follower's real copy intents (GET /api/copy/executions?status=all) on a
 * steady cadence. Every intent for this leader created after the page opened is
 * dispatched once as a `three:copy-trade` CustomEvent on window, so any surface
 * can react to it. The default listener narrates it:
 *
 *   - with a hero avatar mounted (src/shared/idle-avatar.js handle): the avatar
 *     plays a fitting gesture, a caption bubble shows the line, and the browser's
 *     speech synthesis reads it aloud when the reader allows audio;
 *   - with no avatar (WebGL unavailable, still image): a toast carries the line.
 *
 * Lines are built only from the real execution row: coin, side, the SOL the
 * follower's own rules sized, and, for a skip, the engine's own reason.
 */

import { apiFetch } from './api.js';
import { toast } from './shared/toast.js';

export const COPY_TRADE_EVENT = 'three:copy-trade';
const POLL_MS = 20_000;

const sol = (v) => {
	const n = Number(v) || 0;
	return `${n >= 1 ? n.toFixed(2) : n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')} SOL`;
};

/**
 * The spoken line and gesture for one execution row. Pure.
 * @param {object} row  copy_executions row (as returned by /api/copy/executions)
 * @param {string} leaderName
 * @returns {{ text: string, gestures: string[], variant: 'info'|'success'|'error' }}
 */
export function narrationFor(row, leaderName = 'I') {
	const coin = row.symbol ? `$${String(row.symbol).toUpperCase()}` : 'a new coin';
	const net = row.network === 'devnet' ? ' on devnet' : '';
	if (row.locked) {
		return { text: `I just made a move${net}. Your copy unlocks in ${Math.max(1, Math.ceil((row.unlocks_in_sec || 0) / 60))} minutes.`, gestures: ['think', 'nod'], variant: 'info' };
	}
	if (row.status === 'skipped') {
		const why = row.skip_reason === 'spend_cap_exceeded' || row.skip_reason === 'spend_cap_reached'
			? 'your spend cap does not cover it, so I left your SOL alone'
			: row.skip_reason === 'daily_budget_spent'
				? 'your daily budget is already used'
				: 'it did not pass your rules';
		return { text: `I bought ${coin}${net}, but I skipped your copy: ${why}.`, gestures: ['shrug', 'think'], variant: 'info' };
	}
	if (row.direction === 'sell') {
		return { text: `I am selling ${coin}${net}. Exit your copy from your inbox when you are ready.`, gestures: ['point', 'nod'], variant: 'success' };
	}
	const entry = row.leader_entry_sol != null && Number(row.leader_entry_sol) > 0 ? ` with ${sol(row.leader_entry_sol)}` : '';
	const yours = row.planned_sol != null ? ` Your copy is sized at ${sol(row.planned_sol)}.` : '';
	return { text: `I just bought ${coin}${entry}${net}.${yours} Sign it from your copy inbox.`, gestures: ['point', 'celebrate', 'nod'], variant: 'success' };
}

function captionHost() {
	return document.getElementById('ad-avatar-3d') || null;
}

function showCaption(text) {
	const host = captionHost();
	if (!host) return false;
	host.querySelector('.af-caption')?.remove();
	const bubble = document.createElement('div');
	bubble.className = 'af-caption';
	bubble.setAttribute('role', 'status');
	bubble.setAttribute('aria-live', 'polite');
	bubble.textContent = text;
	host.append(bubble);
	const ms = Math.min(12_000, 2500 + text.split(' ').length * 320);
	setTimeout(() => {
		bubble.classList.add('is-leaving');
		bubble.addEventListener('transitionend', () => bubble.remove(), { once: true });
		setTimeout(() => bubble.remove(), 600);
	}, ms);
	return true;
}

function speakAloud(text) {
	const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
	if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return;
	try {
		synth.cancel();
		const u = new SpeechSynthesisUtterance(text);
		u.rate = 1.02;
		synth.speak(u);
	} catch {
		// Speech is an enhancement; the caption already carries the line.
	}
}

/** Narrate one event: avatar (gesture + caption + voice) or toast fallback. */
export async function narrate({ text, gestures, variant }, avatar) {
	if (avatar && typeof avatar.playGesture === 'function' && showCaption(text)) {
		speakAloud(text);
		await avatar.playGesture(gestures).catch(() => null);
		return 'avatar';
	}
	toast(text, { variant, duration: 7000 });
	return 'toast';
}

/**
 * Start watching the follower's copy intents for one leader.
 *
 * @param {object} p
 * @param {string} p.leaderAgentId
 * @param {string} p.leaderName
 * @param {() => object|null} p.getAvatar   current hero avatar handle, or null.
 * @param {() => void} [p.onSpend]          called after a new intent, so the cap meter can refresh.
 * @returns {{ stop(): void }}
 */
export function startCopyNarration({ leaderAgentId, leaderName, getAvatar, onSpend }) {
	const seen = new Set();
	const since = Date.now() - 60_000; // a trade that fired the minute before the tap still counts
	let primed = false;
	let timer = 0;
	let stopped = false;
	let inflight = false;

	const onEvent = (e) => {
		if (e.detail?.leaderAgentId !== leaderAgentId) return;
		narrate(narrationFor(e.detail.row, leaderName), getAvatar());
	};
	window.addEventListener(COPY_TRADE_EVENT, onEvent);

	async function poll() {
		if (stopped || inflight || document.hidden) return;
		inflight = true;
		try {
			const res = await apiFetch('/api/copy/executions?status=all&limit=25', { allowAnonymous: true, headers: { accept: 'application/json' } });
			if (!res.ok) return;
			const { executions = [] } = await res.json();
			const fresh = executions
				.filter((r) => r.leader_agent_id === leaderAgentId && !seen.has(r.id))
				.filter((r) => new Date(r.created_at).getTime() >= since)
				.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
			// The first read marks history as seen without narrating it, except
			// the rows inside the grace window above.
			if (!primed) {
				for (const r of executions) if (new Date(r.created_at).getTime() < since) seen.add(r.id);
				primed = true;
			}
			for (const row of fresh) {
				// A dripped intent is narrated once as "locked", then again when revealed.
				const key = row.locked ? `${row.id}:locked` : row.id;
				if (seen.has(key)) continue;
				seen.add(key);
				if (!row.locked) seen.add(row.id);
				window.dispatchEvent(new CustomEvent(COPY_TRADE_EVENT, { detail: { leaderAgentId, row } }));
			}
			if (fresh.length) onSpend?.();
		} catch {
			// Transient network failure: the next tick retries. Nothing is lost,
			// because rows are read from the server, not pushed.
		} finally {
			inflight = false;
		}
	}

	const onVisible = () => { if (!document.hidden) poll(); };
	document.addEventListener('visibilitychange', onVisible);
	poll();
	timer = setInterval(poll, POLL_MS);

	return {
		stop() {
			stopped = true;
			clearInterval(timer);
			document.removeEventListener('visibilitychange', onVisible);
			window.removeEventListener(COPY_TRADE_EVENT, onEvent);
		},
	};
}
