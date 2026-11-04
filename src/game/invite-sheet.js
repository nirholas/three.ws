// The /play invite sheet: pull one more person into this world.
//
// Opened from the HUD Invite button or a lobby card's Invite action, it shows three ways to hand the world to someone else, in the order people
// actually use them at an event:
//
//   1. A QR code of the canonical world link, big and high-contrast, so one
//      phone can be held up to another (or a projector) and scanned. It encodes
//      the short qrUrl(), error correction Q, so it still reads from the back
//      of a room and through a cracked screen.
//   2. The full invite link (coin, name, symbol, image) with a Copy button. The
//      field is a real, selectable input, so when the browser refuses clipboard
//      access the player is told to select it and the text is already selected.
//   3. Share: the OS share sheet where navigator.share exists (phones), and
//      X / Telegram intent links everywhere else.
//
// Inside an event's window, for the world the event is held in, the sheet leads
// with the event's name and a live countdown read from /event.json, so the
// share reads as an invitation to a happening rather than a bare link.
//
// Imported lazily with its CSS on the first press: a player who never invites
// downloads none of it. The link and copy logic is pure and lives in
// invite-link.js (tests/play-invite.test.js).

import './invite-sheet.css';
import { inviteSheetModel } from './invite-link.js';
import { loadEventConfig } from '../shared/event-config.js';
import { openModal } from './a11y.js';
import { t } from './i18n-play.js';
import { log } from '../shared/log.js';

const QR_PX = 216;

let sheet = null;

function el(tag, props = {}, kids = []) {
	const n = document.createElement(tag);
	for (const [k, v] of Object.entries(props)) {
		if (v == null || v === false) continue;
		if (k === 'class') n.className = v;
		else if (k === 'text') n.textContent = v;
		else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
		else n.setAttribute(k, v === true ? '' : String(v));
	}
	for (const c of [].concat(kids)) {
		if (c == null || c === false) continue;
		n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
	}
	return n;
}

function reducedMotion() {
	return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** True while the invite sheet is on screen. */
export function inviteSheetOpen() {
	return !!sheet;
}

/** Close the sheet, if one is open. Safe to call at any time. */
export function closeInviteSheet() {
	if (!sheet) return;
	const { root, release, timer, onClose } = sheet;
	sheet = null;
	clearInterval(timer);
	release();
	root.classList.remove('cc-on');
	if (reducedMotion()) root.remove();
	else setTimeout(() => root.remove(), 220);
	onClose?.();
}

function headingFor(model) {
	return model.event
		? t('play.invite_heading_event', 'Invite a friend to {{name}}', { name: model.event.name })
		: t('play.invite_heading', 'Invite a friend to {{label}}', { label: model.label });
}

function countdownFor(event) {
	return event.state === 'live'
		? t('play.invite_live_ends', 'Live now, ends in {{time}}', { time: event.clock })
		: t('play.invite_starts_in', 'Starts in {{time}}', { time: event.clock });
}

function shareTextFor(model) {
	if (!model.event) return t('play.invite_share_text', 'Come walk around {{label}} with me in 3D on three.ws', { label: model.label });
	return model.event.state === 'live'
		? t('play.invite_share_live', '{{name}} is live right now in {{label}}. Come join me on three.ws', { name: model.event.name, label: model.label })
		: t('play.invite_share_event', 'Join me at {{name}} in {{label}} on three.ws', { name: model.event.name, label: model.label });
}

/**
 * Render the QR into `box`. The box starts as a skeleton; it becomes the code,
 * or a designed error that points at the link, which works the same.
 */
async function renderQr(box, url) {
	try {
		const mod = await import('qrcode');
		const QRCode = mod.default ?? mod;
		const canvas = document.createElement('canvas');
		await QRCode.toCanvas(canvas, url, {
			width: QR_PX,
			margin: 2,
			// Q recovers from 25% damage: enough for glare on a projector or a
			// cracked phone screen, while the short canonical link keeps the
			// module count low enough to scan from across a room.
			errorCorrectionLevel: 'Q',
			color: { dark: '#08080aff', light: '#ffffffff' },
		});
		canvas.className = 'cc-invite-qr-canvas';
		canvas.setAttribute('role', 'img');
		canvas.setAttribute('aria-label', t('play.invite_qr_aria', 'QR code for {{url}}', { url }));
		box.replaceChildren(canvas);
		box.removeAttribute('aria-busy');
		box.dataset.state = 'ready';
	} catch (err) {
		log.warn('[invite-sheet] QR render failed:', err?.message);
		box.removeAttribute('aria-busy');
		box.dataset.state = 'error';
		box.replaceChildren(
			el('span', { class: 'cc-invite-qr-err-ico', 'aria-hidden': 'true', text: '!' }),
			el('p', { class: 'cc-invite-qr-err', text: t('play.invite_qr_error', 'Couldn’t draw the QR code here. The link below opens the same world.') }),
		);
	}
}

/**
 * Open the invite sheet for a coin world.
 *
 * @param {object} opts
 * @param {{ mint: string, name?: string, symbol?: string, image?: string }} opts.coin
 * @param {(msg: string, kind?: string) => void} [opts.toast]
 * @param {() => void} [opts.onClose]
 * @returns {boolean} whether a sheet opened (false without a mint)
 */
export function openInviteSheet({ coin, toast, onClose }) {
	if (sheet) closeInviteSheet();
	const origin = location.origin;
	let model = inviteSheetModel({ coin, origin });
	if (!model.link) return false;

	const status = el('p', { class: 'cc-invite-status', role: 'status', 'aria-live': 'polite' });
	const setStatus = (msg, kind) => {
		status.textContent = msg || '';
		if (kind) status.setAttribute('data-kind', kind);
		else status.removeAttribute('data-kind');
	};

	const kicker = el('span', { class: 'cc-invite-kicker', text: t('play.invite_kicker', 'Invite') });
	const heading = el('h3', { class: 'cc-invite-h', id: 'cc-invite-h', text: headingFor(model) });
	const eventLine = el('p', { class: 'cc-invite-event', hidden: true }, [
		el('span', { class: 'cc-invite-event-dot', 'aria-hidden': 'true' }),
		el('span', { class: 'cc-invite-event-text' }),
	]);

	const qrBox = el('div', { class: 'cc-invite-qr', 'data-state': 'loading', 'aria-busy': 'true' }, [
		el('span', { class: 'cc-invite-qr-skel', 'aria-hidden': 'true' }),
	]);

	const linkField = el('input', {
		class: 'cc-invite-link', type: 'text', readonly: true, value: model.link,
		spellcheck: 'false', 'aria-label': t('play.invite_link_aria', 'Invite link'),
		onfocus: (e) => e.target.select(),
	});
	const copyBtn = el('button', { class: 'cc-invite-btn cc-invite-primary', type: 'button' }, [
		el('span', { 'aria-hidden': 'true', text: '⧉' }),
		el('span', { text: t('play.invite_copy', 'Copy link') }),
	]);
	copyBtn.addEventListener('click', async () => {
		try {
			await navigator.clipboard.writeText(model.link);
			setStatus(t('play.invite_copied', 'Link copied. Paste it anywhere.'), 'ok');
			toast?.(t('play.invite_copied_toast', 'Invite link copied'), 'success');
		} catch (err) {
			// Clipboard refused (permissions, an insecure context, an embedded
			// frame): hand the player the text already selected instead.
			log.info('[invite-sheet] clipboard write refused:', err?.message);
			linkField.focus();
			linkField.select();
			setStatus(t('play.invite_copy_manual', 'Your browser blocked copying. The link is selected, copy it with Ctrl+C or long-press.'), 'warn');
		}
	});

	const actions = [copyBtn];
	const canShare = typeof navigator.share === 'function';
	if (canShare) {
		const shareBtn = el('button', { class: 'cc-invite-btn', type: 'button' }, [
			el('span', { 'aria-hidden': 'true', text: '↗' }),
			el('span', { text: t('play.invite_share', 'Share') }),
		]);
		shareBtn.addEventListener('click', async () => {
			try {
				await navigator.share({ title: headingFor(model), text: shareTextFor(model), url: model.link });
				setStatus(t('play.invite_shared', 'Shared.'), 'ok');
			} catch (err) {
				// AbortError is the player closing the OS sheet: not a failure.
				if (err?.name === 'AbortError') return;
				log.info('[invite-sheet] navigator.share failed:', err?.message);
				setStatus(t('play.invite_share_failed', 'Sharing isn’t available here. Copy the link instead.'), 'warn');
			}
		});
		actions.push(shareBtn);
	}

	// Without an OS share sheet (most desktops), the two places people actually
	// paste a world link: an X post and a Telegram chat. Plain links the player
	// clicks, opened in a new tab; nothing is posted on their behalf.
	const xLink = el('a', { class: 'cc-invite-intent', target: '_blank', rel: 'noopener noreferrer' },
		[el('span', { 'aria-hidden': 'true', text: '𝕏' }), el('span', { text: t('play.invite_post_x', 'Post on X') })]);
	const tgLink = el('a', { class: 'cc-invite-intent', target: '_blank', rel: 'noopener noreferrer' },
		[el('span', { 'aria-hidden': 'true', text: '✈' }), el('span', { text: t('play.invite_send_tg', 'Send on Telegram') })]);
	const paintIntents = () => {
		const text = shareTextFor(model);
		xLink.href = 'https://x.com/intent/post?' + new URLSearchParams({ text, url: model.link });
		tgLink.href = 'https://t.me/share/url?' + new URLSearchParams({ url: model.link, text });
	};
	paintIntents();
	const intentRow = canShare ? null : el('div', { class: 'cc-invite-intents' }, [xLink, tgLink]);

	const closeBtn = el('button', {
		class: 'cc-invite-close', type: 'button',
		'aria-label': t('play.invite_close', 'Close invite'), title: t('play.invite_close_title', 'Close (Esc)'),
		onclick: () => closeInviteSheet(),
	}, ['✕']);

	const card = el('div', {
		class: 'cc-invite-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'cc-invite-h',
		onclick: (e) => e.stopPropagation(),
		// /play drives the avatar from window keydown in the bubble phase: keys
		// typed or pressed inside the sheet stay inside it. Escape is handled by
		// the overlay stack in the capture phase, before this runs.
		onkeydown: (e) => { if (e.key !== 'Escape') e.stopPropagation(); },
	}, [
		closeBtn,
		kicker,
		heading,
		eventLine,
		el('div', { class: 'cc-invite-body' }, [
			qrBox,
			el('div', { class: 'cc-invite-side' }, [
				el('p', { class: 'cc-invite-sub', text: t('play.invite_sub', 'Scan to walk straight into this world. No download, no sign-up to look around.') }),
				el('label', { class: 'cc-invite-label', text: t('play.invite_link_label', 'Invite link') }),
				linkField,
				el('div', { class: 'cc-invite-actions' }, actions),
				intentRow,
			]),
		]),
		status,
	]);

	const root = el('div', { id: 'cc-invite', onclick: () => closeInviteSheet() }, [card]);
	document.body.appendChild(root);
	if (reducedMotion()) root.classList.add('cc-on');
	else requestAnimationFrame(() => root.classList.add('cc-on'));

	const release = openModal(card, { close: () => closeInviteSheet(), initialFocus: copyBtn });
	sheet = { root, release, timer: 0, onClose };

	renderQr(qrBox, model.qr);

	// The event framing arrives a beat later: /event.json is normally already in
	// the HTTP cache (the countdown pill reads it on boot), and the sheet is
	// fully usable without it. Once known, the countdown ticks every second.
	const paintEvent = (event) => {
		model = inviteSheetModel({ coin, origin, event, now: Date.now() });
		heading.textContent = headingFor(model);
		if (!model.event) {
			eventLine.hidden = true;
			return false;
		}
		eventLine.hidden = false;
		eventLine.dataset.state = model.event.state;
		eventLine.querySelector('.cc-invite-event-text').textContent = countdownFor(model.event);
		return true;
	};
	const mine = sheet;
	loadEventConfig()
		.then((event) => {
			if (sheet !== mine || !event) return;
			if (!paintEvent(event)) return;
			paintIntents();
			kicker.textContent = t('play.invite_kicker_event', 'Event invite');
			mine.timer = setInterval(() => {
				if (sheet !== mine) return;
				if (!paintEvent(event)) {
					clearInterval(mine.timer);
					kicker.textContent = t('play.invite_kicker', 'Invite');
				}
			}, 1000);
		})
		.catch((err) => log.info('[invite-sheet] event config unavailable:', err?.message));

	return true;
}
