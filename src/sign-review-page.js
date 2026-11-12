// /sign-review: where fluent signers review signs in a pack that is not native.
//
// A granted reviewer gets the queue of signs waiting for their verdict, watches
// each one on the avatar (0.5x or 1x, right or left dominant hand), reads the
// gloss, and records approve / needs change / reject with a note. Every verdict
// is sent with the content hash of the exact sign that was played, so the
// server refuses it if the sign changed while the page was open.
//
// The page never decides what is served. Approvals go live only when exported
// into the pack's committed ledger (scripts/export-sign-reviews.mjs).

import { apiFetch } from './api.js';
import { PoseStage } from './avatar-pose.js';
import { SignSpeaker } from './sign-speech.js';
import { buildClipForSign } from './sign-dictionary.js';
import { loadSignPrefs, resolveRig, saveSignPrefs } from './sign-avatars.js';
import { log } from './shared/log.js';

const $ = (sel) => document.querySelector(sel);
const VERDICT_WORDS = { approve: 'Approved', needs_change: 'Asked for a change on', reject: 'Rejected' };
const STATE_WORDS = {
	unreviewed: 'not reviewed yet',
	in_review: 'in review',
	needs_change: 'a reviewer asked for a change',
	rejected: 'a reviewer rejected it',
};

const view = $('#sr-view');
const workspace = $('#sr-workspace');

/** @type {{ packs: any[], granted: string[], is_admin: boolean, signed_in: boolean } | null} */
let directory = null;
let packId = null;
let items = [];
let index = 0;
let busy = false;

const prefs = loadSignPrefs();
let rate = prefs.rate === 0.5 ? 0.5 : 1;
let dominant = prefs.dominant === 'Left' ? 'Left' : 'Right';
let stage = null;
let speaker = null;
let stageReady = false;

function el(tag, attrs = {}, ...children) {
	const node = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		if (k === 'class') node.className = v;
		else if (k === 'text') node.textContent = v;
		else node.setAttribute(k, v);
	}
	for (const child of children) node.append(child);
	return node;
}

/** Replace the status area with one panel (an empty, error or access state). */
function showPanel(title, paragraphs, actions = []) {
	workspace.hidden = true;
	const panel = el('section', { class: 'sr-panel' }, el('h2', { text: title }));
	for (const p of paragraphs) {
		const para = el('p');
		if (typeof p === 'string') para.textContent = p;
		else para.append(...p);
		panel.append(para);
	}
	if (actions.length) panel.append(el('p', {}, ...actions));
	view.replaceChildren(panel);
	view.hidden = false;
}

function showError(message, retry) {
	const button = el('button', { class: 'sr-btn', type: 'button', text: 'Try again' });
	button.addEventListener('click', retry);
	showPanel('Something went wrong', [message], [button]);
}

async function readError(res) {
	const body = await res.json().catch(() => null);
	return body?.message || body?.error || `The server answered ${res.status}.`;
}

// ── Stage ──────────────────────────────────────────────────────────────────

function setStageState(state, message = '') {
	$('#sr-stage-wrap').dataset.state = state;
	$('#sr-stage-error').hidden = state !== 'error';
	$('#sr-stage-msg').textContent = message;
}

async function mountStage() {
	stage?.dispose();
	stageReady = false;
	speaker = null;
	setStageState('loading', 'Loading the avatar…');
	const avatar = resolveRig(prefs);
	stage = new PoseStage($('#sr-stage'), { glbUrl: avatar.url, label: 'A 3D avatar performing the sign under review' });
	try {
		const { supported } = await stage.mount();
		stage.start();
		if (!supported) {
			setStageState('error', '');
			$('#sr-stage-error p').textContent = `${avatar.label} has no usable skeleton, so it cannot sign. Choose another avatar on /sign-language, then come back.`;
			return;
		}
		stageReady = true;
		setStageState('ready', '');
		rebuildSpeaker();
		play();
	} catch (err) {
		log.warn('[sign-review] stage mount failed', err?.message);
		setStageState('error', '');
	}
}

function rebuildSpeaker() {
	if (!stageReady) return;
	speaker?.cancel();
	const current = () => items[index];
	speaker = new SignSpeaker({
		manager: stage.anim,
		dominant,
		// Perform the reviewed content only, never the ASL entry of the same name.
		signs: (word, position = {}) => {
			const item = current();
			if (!item || word !== item.key) return null;
			return buildClipForSign(item.key, item.sign, {
				dominant,
				rate,
				packId,
				lead: position.first !== false,
				settle: position.last !== false,
			});
		},
	});
}

async function play() {
	const item = items[index];
	if (!speaker || !item) return;
	$('#sr-stage-msg').textContent = `Signing ${item.key} at ${rate}×, ${dominant.toLowerCase()} hand`;
	try {
		const result = await speaker.speak(item.key, { spell: false });
		if (!result.superseded) $('#sr-stage-msg').textContent = '';
	} catch (err) {
		log.warn('[sign-review] could not perform sign', err?.message);
		$('#sr-stage-msg').textContent = `This sign could not be performed: ${err?.message || 'unknown error'}. Reject it with that note.`;
	}
}

// ── Queue ──────────────────────────────────────────────────────────────────

function renderQueue() {
	const list = $('#sr-queue');
	list.replaceChildren(
		...items.map((item, i) => {
			const button = el('button', { class: 'sr-qitem', type: 'button', 'data-state': item.state, text: item.key });
			if (i === index) button.setAttribute('aria-current', 'true');
			button.setAttribute('aria-label', `${item.key}, ${STATE_WORDS[item.state] ?? item.state}`);
			button.addEventListener('click', () => select(i));
			return el('li', {}, button);
		}),
	);
	$('#sr-queue-title').textContent = `Waiting for you (${items.length})`;
}

function renderCard() {
	const item = items[index];
	$('#sr-key').textContent = item.key;
	$('#sr-meta').textContent = `${STATE_WORDS[item.state] ?? item.state} · ${item.approvals} of ${item.required} approvals`;
	$('#sr-gloss').textContent = item.gloss || 'No gloss was written for this sign. Ask for a change so the author adds one.';
	$('#sr-note').value = '';
	setFeedback('');
}

function setFeedback(text, tone = '') {
	const node = $('#sr-feedback');
	node.textContent = text;
	node.dataset.tone = tone;
}

function select(i) {
	if (!items.length) return;
	index = (i + items.length) % items.length;
	renderQueue();
	renderCard();
	play();
}

function showQueueEmpty(pack) {
	workspace.hidden = true;
	const link = el('a', { href: '/sign-language', text: 'Back to the signing avatars' });
	link.className = 'sr-btn';
	showPanel(
		'Nothing waiting for review in this language',
		[
			`You have given a verdict on every sign in ${pack.name} that still needs one. New or edited signs appear here as soon as they are added.`,
		],
		[link],
	);
	renderPackPicker(view);
}

async function loadQueue() {
	busy = true;
	try {
		const res = await apiFetch(`/api/sign-review/queue?pack=${encodeURIComponent(packId)}`);
		if (!res.ok) return showError(await readError(res), loadQueue);
		const body = await res.json();
		items = body.items;
		index = 0;
		updateCoverage(body.pack);
		if (!items.length) return showQueueEmpty(body.pack);
		view.hidden = true;
		workspace.hidden = false;
		renderQueue();
		renderCard();
		if (!stage) mountStage();
		else play();
	} catch (err) {
		if (!err?.redirected) showError('The review queue could not be reached. Check your connection.', loadQueue);
	} finally {
		busy = false;
	}
}

function updateCoverage(pack) {
	$('#sr-coverage').textContent = `${pack.served} of ${pack.total} signs live · ${pack.required_approvals} approvals needed per sign`;
	$('#sr-rule strong').textContent = `A sign never goes live without ${pack.required_approvals} approvals.`;
}

async function submit(verdict) {
	const item = items[index];
	if (!item || busy) return;
	const note = $('#sr-note').value.trim();
	if (verdict !== 'approve' && !note) {
		setFeedback('Write a note first: say what is wrong so the sign can be fixed.', 'error');
		$('#sr-note').focus();
		return;
	}
	busy = true;
	for (const b of document.querySelectorAll('[data-verdict]')) b.disabled = true;
	setFeedback('Saving…');
	try {
		const res = await apiFetch('/api/sign-review/review', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ pack: packId, sign: item.key, hash: item.hash, verdict, note }),
		});
		if (res.status === 409) {
			setFeedback('This sign was edited since the queue loaded. Reloading the current version…', 'error');
			busy = false;
			return loadQueue();
		}
		if (!res.ok) return setFeedback(await readError(res), 'error');
		const result = await res.json();
		items.splice(index, 1);
		const done = `${VERDICT_WORDS[verdict]} ${item.key}. It now has ${result.approvals} of ${result.required} approvals (${result.state.replace('_', ' ')}).`;
		if (!items.length) {
			busy = false;
			return loadQueue();
		}
		if (index >= items.length) index = 0;
		renderQueue();
		renderCard();
		setFeedback(done, 'ok');
		play();
	} catch (err) {
		if (!err?.redirected) setFeedback('Your verdict was not saved: the network failed. Try again.', 'error');
	} finally {
		busy = false;
		for (const b of document.querySelectorAll('[data-verdict]')) b.disabled = false;
	}
}

// ── Packs and access ───────────────────────────────────────────────────────

function renderPackPicker(host) {
	const granted = directory.packs.filter((p) => directory.granted?.includes(p.id));
	if (granted.length < 2) return;
	const select = el('select', { class: 'sr-select', 'aria-label': 'Language' });
	for (const p of granted) select.append(el('option', { value: p.id, text: p.name }));
	select.value = packId;
	select.addEventListener('change', () => switchPack(select.value));
	host.querySelector('.sr-panel')?.append(el('p', {}, el('label', { text: 'Review another language: ' }), select));
}

function fillPackSelect() {
	const select = $('#sr-pack');
	const granted = directory.packs.filter((p) => directory.granted?.includes(p.id));
	select.replaceChildren(...granted.map((p) => el('option', { value: p.id, text: p.name })));
	select.value = packId;
	select.disabled = granted.length < 2;
}

function switchPack(id) {
	packId = id;
	const url = new URL(location.href);
	url.searchParams.set('pack', id);
	history.replaceState(null, '', url);
	fillPackSelect();
	loadQueue();
}

function accessExplainer() {
	const docs = el('a', { href: '/docs/sign-language#languages-and-review', text: 'how review works' });
	const mail = el('a', { href: 'mailto:support@three.ws?subject=Sign%20review%20access', text: 'support@three.ws' });
	return [
		'Review access is granted per language to fluent signers, ideally Deaf native signers or certified interpreters, so that no sign goes live on the word of someone who does not sign.',
		['To request access, write to ', mail, ' (support@three.ws) with the sign language you sign, your background with it, and the email of your three.ws account. Read ', docs, ' first.'],
	];
}

async function boot() {
	try {
		const res = await apiFetch('/api/sign-review/packs', { allowAnonymous: true });
		if (!res.ok) return showError(await readError(res), boot);
		directory = await res.json();
	} catch {
		return showError('The review service could not be reached. Check your connection.', boot);
	}

	if (directory.is_admin) setupAdmin();

	if (!directory.packs.length) {
		return showPanel('No sign language is under review yet', [
			'three.ws signs American Sign Language today. A second sign language is added only as a pack that fluent signers review sign by sign, and none is open for review right now.',
			...accessExplainer().slice(1),
		]);
	}
	if (!directory.signed_in) {
		const login = el('a', { href: `/login?next=${encodeURIComponent(location.pathname + location.search)}`, text: 'Sign in to review' });
		login.className = 'sr-btn';
		return showPanel('Sign in to review signs', [
			`Under review now: ${directory.packs.map((p) => `${p.name} (${p.served} of ${p.total} signs live)`).join(', ')}.`,
			...accessExplainer(),
		], [login]);
	}
	const granted = directory.packs.filter((p) => directory.granted?.includes(p.id));
	if (!granted.length) {
		return showPanel("You aren't a reviewer yet", [
			`Under review now: ${directory.packs.map((p) => `${p.name} (${p.served} of ${p.total} signs live)`).join(', ')}.`,
			...accessExplainer(),
		]);
	}
	const asked = new URLSearchParams(location.search).get('pack');
	packId = granted.some((p) => p.id === asked) ? asked : granted[0].id;
	fillPackSelect();
	loadQueue();
}

// ── Admin: grant and revoke reviewers ──────────────────────────────────────

function setupAdmin() {
	const section = $('#sr-admin');
	const select = $('#sr-admin-pack');
	select.replaceChildren(...directory.packs.map((p) => el('option', { value: p.id, text: p.name })));
	section.hidden = !directory.packs.length;
	const form = $('#sr-admin-form');
	const feedback = $('#sr-admin-feedback');
	form.addEventListener('submit', async (event) => {
		event.preventDefault();
		const data = new FormData(form);
		const revoke = data.get('revoke') === 'on';
		if (!revoke && !String(data.get('display_name') || '').trim()) {
			feedback.dataset.tone = 'error';
			feedback.textContent = 'A display name is required to grant access.';
			return;
		}
		feedback.dataset.tone = '';
		feedback.textContent = 'Saving…';
		try {
			const res = await apiFetch('/api/sign-review/reviewer', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					pack: data.get('pack'),
					email: data.get('email'),
					display_name: data.get('display_name'),
					credential_note: data.get('credential_note'),
					revoke,
				}),
			});
			if (!res.ok) {
				feedback.dataset.tone = 'error';
				feedback.textContent = await readError(res);
				return;
			}
			const body = await res.json();
			feedback.dataset.tone = 'ok';
			feedback.textContent = body.revoked
				? `Revoked ${body.reviewer.display_name}. Their verdicts no longer count.`
				: `${body.reviewer.display_name} can now review ${data.get('pack')}.`;
			form.reset();
		} catch (err) {
			if (!err?.redirected) {
				feedback.dataset.tone = 'error';
				feedback.textContent = 'Not saved: the network failed. Try again.';
			}
		}
	});
}

// ── Controls ───────────────────────────────────────────────────────────────

function setPressed(attr, value) {
	for (const b of document.querySelectorAll(`[data-${attr}]`)) {
		b.setAttribute('aria-pressed', String(b.dataset[attr] === String(value)));
	}
}

for (const b of document.querySelectorAll('[data-rate]')) {
	b.addEventListener('click', () => {
		rate = Number(b.dataset.rate);
		setPressed('rate', rate);
		saveSignPrefs({ rate });
		rebuildSpeaker();
		play();
	});
}
for (const b of document.querySelectorAll('[data-hand]')) {
	b.addEventListener('click', () => {
		dominant = b.dataset.hand;
		setPressed('hand', dominant);
		saveSignPrefs({ dominant });
		rebuildSpeaker();
		play();
	});
}
for (const b of document.querySelectorAll('[data-verdict]')) {
	b.addEventListener('click', () => submit(b.dataset.verdict));
}
$('#sr-replay').addEventListener('click', play);
$('#sr-stage-retry').addEventListener('click', mountStage);
$('#sr-pack').addEventListener('change', (e) => switchPack(e.target.value));
setPressed('rate', rate);
setPressed('hand', dominant);

document.addEventListener('keydown', (event) => {
	if (workspace.hidden || event.metaKey || event.ctrlKey || event.altKey) return;
	const target = event.target;
	if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
	const key = event.key.toLowerCase();
	const actions = {
		a: () => submit('approve'),
		c: () => submit('needs_change'),
		r: () => submit('reject'),
		' ': () => play(),
		j: () => select(index + 1),
		k: () => select(index - 1),
	};
	if (!actions[key]) return;
	if (key === ' ' && target instanceof HTMLButtonElement) return;
	event.preventDefault();
	actions[key]();
});

boot();
