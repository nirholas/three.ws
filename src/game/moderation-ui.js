// Player-facing moderation UI for /play: the Report dialog and the "you are
// muted" state. The server (multiplayer/src/rooms/WalkRoom.js) is the authority;
// this only collects a reason, shows the real answer, and offers Retry when the
// report did not land.

import { t } from './i18n-play.js';

export const REPORT_REASONS = [
	{ id: 'harassment', key: 'play.report_reason_harassment', fallback: 'Harassment or abuse' },
	{ id: 'hate', key: 'play.report_reason_hate', fallback: 'Hate speech' },
	{ id: 'spam', key: 'play.report_reason_spam', fallback: 'Spam or scams' },
	{ id: 'cheating', key: 'play.report_reason_cheating', fallback: 'Cheating or exploiting' },
	{ id: 'other', key: 'play.report_reason_other', fallback: 'Something else' },
];

const ERROR_COPY = {
	rate_limited: ['play.report_err_rate', 'You just sent a report. Wait a few seconds and try again.'],
	invalid_target: ['play.report_err_gone', 'That player is no longer in the world.'],
	offline: ['play.report_err_offline', 'You are not connected to the world. Reconnect and try again.'],
	timeout: ['play.report_err_timeout', 'The world did not answer. Check your connection and try again.'],
};

function errorText(code) {
	const [key, fallback] = ERROR_COPY[code] || ['play.report_err_generic', 'The report could not be sent. Try again.'];
	return t(key, fallback);
}

function h(tag, attrs = {}, children = []) {
	const node = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		if (v === undefined || v === null || v === false) continue;
		if (k === 'text') node.textContent = v;
		else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
		else node.setAttribute(k, v === true ? '' : String(v));
	}
	for (const c of [].concat(children)) if (c) node.append(c);
	return node;
}

let openDialog = null;

/**
 * Open the Report dialog for one player.
 * @param {{ targetName: string, send: (reason: string) => Promise<{ok: boolean, error?: string}>, trigger?: HTMLElement|null }} opts
 * @returns {() => void} close function
 */
export function openReportDialog({ targetName, send, trigger = null }) {
	openDialog?.();
	const prevFocus = trigger || document.activeElement;
	let busy = false;

	const status = h('p', { class: 'cc-report-status', role: 'status', 'aria-live': 'polite' });
	const radios = REPORT_REASONS.map((r, i) =>
		h('label', { class: 'cc-report-reason' }, [
			h('input', { type: 'radio', name: 'cc-report-reason', value: r.id, ...(i === 0 ? { checked: true } : {}) }),
			h('span', { text: t(r.key, r.fallback) }),
		]),
	);
	const cancel = h('button', { type: 'button', class: 'cc-report-btn', text: t('play.report_cancel', 'Cancel'), onclick: () => close() });
	const submit = h('button', { type: 'button', class: 'cc-report-btn cc-report-primary', text: t('play.report_send', 'Send report') });
	const form = h('div', { class: 'cc-report-reasons', role: 'radiogroup', 'aria-label': t('play.report_reason_aria', 'Reason for the report') }, radios);
	const actions = h('div', { class: 'cc-report-actions' }, [cancel, submit]);
	const title = h('h2', { class: 'cc-report-title', id: 'cc-report-title', text: t('play.report_title', 'Report {{name}}', { name: targetName }) });
	const intro = h('p', { class: 'cc-report-intro', text: t('play.report_intro', 'Moderators are told, and several reports in a few minutes mute a player automatically. Pick the closest reason.') });
	const card = h('div', { class: 'cc-report-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'cc-report-title' }, [title, intro, form, status, actions]);
	const overlay = h('div', { class: 'cc-report-overlay' }, [card]);

	function close() {
		overlay.remove();
		document.removeEventListener('keydown', onKey, true);
		if (openDialog === close) openDialog = null;
		try { prevFocus?.focus?.(); } catch { /* element gone */ }
	}

	function onKey(e) {
		if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
		if (e.key !== 'Tab') return;
		const items = [...card.querySelectorAll('input, button:not([disabled])')];
		if (items.length === 0) return;
		const first = items[0];
		const last = items[items.length - 1];
		if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
		else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
	}

	async function run() {
		if (busy) return;
		busy = true;
		submit.disabled = true;
		submit.textContent = t('play.report_sending', 'Sending…');
		status.textContent = '';
		status.className = 'cc-report-status';
		const reason = card.querySelector('input[name="cc-report-reason"]:checked')?.value || 'other';
		let res;
		try { res = await send(reason); } catch { res = { ok: false, error: 'network' }; }
		busy = false;
		if (res?.ok) {
			form.hidden = true;
			intro.hidden = true;
			cancel.remove();
			submit.remove();
			status.className = 'cc-report-status cc-report-ok';
			status.textContent = t('play.report_done', 'Thanks. Moderators have been told.');
			const done = h('button', { type: 'button', class: 'cc-report-btn cc-report-primary', text: t('play.report_close', 'Close'), onclick: () => close() });
			actions.append(done);
			done.focus();
			return;
		}
		submit.disabled = false;
		submit.textContent = t('play.report_retry', 'Retry');
		status.className = 'cc-report-status cc-report-error';
		status.textContent = errorText(res?.error);
	}

	submit.addEventListener('click', run);
	overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
	document.addEventListener('keydown', onKey, true);
	document.body.append(overlay);
	radios[0].querySelector('input').focus();
	openDialog = close;
	return close;
}

/**
 * The persistent "you are muted" strip above the chat box. `mutedUntil` is the
 * server's epoch ms (0 clears it). Counts down on a real clock and clears itself
 * when the mute ends, so a player is never told they are muted after it expired.
 */
export function createMuteState({ strip, input, onChange }) {
	let timer = 0;
	function render(until) {
		const left = Math.ceil((until - Date.now()) / 60_000);
		if (!(until > Date.now())) {
			strip.hidden = true;
			strip.textContent = '';
			input.disabled = false;
			input.placeholder = t('play.chat_placeholder', 'Say something…');
			clearTimeout(timer);
			onChange?.(false);
			return;
		}
		strip.hidden = false;
		strip.textContent = left <= 1
			? t('play.muted_one', 'You are muted for about a minute. Others cannot see your messages or hear you.')
			: t('play.muted_many', 'You are muted for about {{n}} more minutes. Others cannot see your messages or hear you.', { n: left });
		input.disabled = true;
		input.placeholder = t('play.muted_placeholder', 'You are muted');
		clearTimeout(timer);
		timer = setTimeout(() => render(until), Math.min(30_000, Math.max(1000, until - Date.now())));
		onChange?.(true);
	}
	return { set: (until) => render(Number(until) || 0), dispose: () => clearTimeout(timer) };
}
