// The conversation panel: walk up to an agent, press E, and talk to the real
// agent through its own /api/chat brain. Replies stream in, can be spoken out
// loud through /api/tts/speak, and the footer opens the agent's profile as a
// desktop window or hands over the one-tag embed that puts this exact agent on
// any web page: the "3D agent layer of the internet", demonstrated in place.

import { icon } from '../icons.js';
import { pageAppId } from '../layout.js';
import { embedSnippet } from './cast.js';

const VOICE_KEY = 'tws:world-voice';
const HISTORY_CAP = 20;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '"': '&quot;', "'": '&#39;', '>': '&gt;' })[c]);

function readVoicePref() {
	try { return localStorage.getItem(VOICE_KEY) === '1'; } catch { return false; }
}
function writeVoicePref(on) {
	try { localStorage.setItem(VOICE_KEY, on ? '1' : '0'); } catch { /* private mode */ }
}

/**
 * @param {{
 *   host: HTMLElement,
 *   shell: { launchId(id:string, o?:object): void, toast(msg:string): void },
 *   agents: { streamReply: Function, hold: Function, gesture: Function, say: Function },
 *   onOpen: () => void,
 *   onClose: () => void,
 * }} o
 */
export function createTalkPanel({ host, shell, agents, onOpen, onClose }) {
	const el = document.createElement('section');
	el.className = 'wd-talk';
	el.hidden = true;
	el.setAttribute('role', 'dialog');
	el.setAttribute('aria-modal', 'false');
	el.innerHTML = `
		<header>
			<div class="wd-talk-who">
				<span class="wd-talk-thumb" aria-hidden="true"></span>
				<div><b class="wd-talk-name"></b><small class="wd-talk-meta"></small></div>
			</div>
			<div class="wd-talk-head-actions">
				<button type="button" class="wd-x wd-talk-voice" aria-pressed="false" title="Read replies aloud">${icon('pulse', 16)}</button>
				<button type="button" class="wd-x wd-talk-close" aria-label="Stop talking">${icon('close', 16)}</button>
			</div>
		</header>
		<p class="wd-talk-about"></p>
		<ol class="wd-talk-log" aria-live="polite" aria-label="Conversation"></ol>
		<form class="wd-talk-form">
			<input type="text" class="wd-talk-input" maxlength="4000" autocomplete="off" placeholder="Say something" aria-label="Your message" />
			<button type="submit" class="wd-talk-send" aria-label="Send">${icon('chevron', 16)}</button>
		</form>
		<footer class="wd-talk-foot">
			<button type="button" class="wd-talk-btn wd-talk-profile">${icon('user', 14)}<span>Profile</span></button>
			<button type="button" class="wd-talk-btn wd-talk-embed" aria-expanded="false">${icon('external', 14)}<span>Put this agent on your site</span></button>
		</footer>
		<div class="wd-talk-snippet" hidden>
			<p>One tag embeds this exact agent, 3D body and brain, on any web page. That is the agent layer of the internet.</p>
			<pre tabindex="0"></pre>
			<button type="button" class="wd-talk-btn wd-talk-copy">Copy snippet</button>
		</div>`;
	host.append(el);

	const $ = (sel) => el.querySelector(sel);
	const nameEl = $('.wd-talk-name');
	const metaEl = $('.wd-talk-meta');
	const thumbEl = $('.wd-talk-thumb');
	const aboutEl = $('.wd-talk-about');
	const logEl = $('.wd-talk-log');
	const form = $('.wd-talk-form');
	const input = $('.wd-talk-input');
	const send = $('.wd-talk-send');
	const voiceBtn = $('.wd-talk-voice');
	const snippet = $('.wd-talk-snippet');
	const snippetPre = snippet.querySelector('pre');
	const embedBtn = $('.wd-talk-embed');

	let member = null;
	let place = 'the campus';
	let history = [];
	let streaming = null; // AbortController
	let voice = readVoicePref();
	let audio = null;
	paintVoice();

	function paintVoice() {
		voiceBtn.setAttribute('aria-pressed', String(voice));
		voiceBtn.title = voice ? 'Replies are read aloud. Click to mute.' : 'Read replies aloud';
		voiceBtn.classList.toggle('is-on', voice);
	}
	voiceBtn.addEventListener('click', () => {
		voice = !voice;
		writeVoicePref(voice);
		paintVoice();
		if (!voice) stopAudio();
	});

	function stopAudio() {
		if (!audio) return;
		audio.pause();
		URL.revokeObjectURL(audio.src);
		audio = null;
	}
	/** Speak a reply through the platform's TTS; a failure is a quiet toast, never a broken turn. */
	async function speak(text) {
		if (!voice || !text) return;
		try {
			const r = await fetch('/api/tts/speak', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: text.slice(0, 1200), format: 'mp3' }) });
			if (r.status === 429) return shell.toast('Voice is rate limited for now. Replies stay in text.');
			if (!r.ok) throw new Error(`tts ${r.status}`);
			const blob = await r.blob();
			stopAudio();
			audio = new Audio(URL.createObjectURL(blob));
			audio.addEventListener('ended', stopAudio, { once: true });
			await audio.play();
		} catch {
			shell.toast('Voice is unavailable right now. Replies stay in text.');
		}
	}

	// ---- log ----
	function line(role, text, cls = '') {
		const li = document.createElement('li');
		li.className = `wd-talk-${role} ${cls}`.trim();
		li.textContent = text;
		logEl.append(li);
		logEl.scrollTop = logEl.scrollHeight;
		return li;
	}
	function errorLine(message, retry) {
		const li = line('note', '', 'is-error');
		li.innerHTML = `<span>${esc(message)}</span>`;
		if (retry) {
			const b = document.createElement('button');
			b.type = 'button';
			b.className = 'wd-talk-btn';
			b.textContent = 'Try again';
			b.addEventListener('click', () => { li.remove(); ask(retry); });
			li.append(b);
		}
	}

	async function ask(text) {
		if (!member || streaming) return;
		const msg = text.trim();
		if (!msg) return;
		line('you', msg);
		const li = line('them', '', 'is-thinking');
		li.setAttribute('aria-busy', 'true');
		streaming = new AbortController();
		send.disabled = true;
		agents.gesture(member.id, 'think');
		let reply = '';
		try {
			reply = await agents.streamReply(member, msg, history, {
				place,
				signal: streaming.signal,
				onChunk: (t) => {
					li.classList.remove('is-thinking');
					li.textContent = t;
					logEl.scrollTop = logEl.scrollHeight;
				},
			});
			li.classList.remove('is-thinking');
			li.removeAttribute('aria-busy');
			if (!reply) {
				li.remove();
				errorLine(`${member.name} had nothing to say. Try asking another way.`, msg);
			} else {
				li.textContent = reply;
				history.push({ role: 'user', content: msg }, { role: 'assistant', content: reply });
				while (history.length > HISTORY_CAP) history.shift();
				if (history[0]?.role === 'assistant') history.shift();
				agents.say(member.id, reply.length > 140 ? `${reply.slice(0, 137)}...` : reply);
				agents.gesture(member.id, 'nod');
				speak(reply);
			}
		} catch (err) {
			li.remove();
			if (err?.name !== 'AbortError') errorLine(err?.message || `${member.name} could not answer.`, msg);
		} finally {
			streaming = null;
			send.disabled = false;
			if (!el.hidden) input.focus();
		}
	}

	form.addEventListener('submit', (e) => {
		e.preventDefault();
		const v = input.value;
		input.value = '';
		ask(v);
	});

	// ---- footer ----
	$('.wd-talk-profile').addEventListener('click', () => {
		if (!member) return;
		close();
		shell.launchId(pageAppId(member.home), { title: member.name });
	});
	embedBtn.addEventListener('click', () => {
		const open = snippet.hidden;
		snippet.hidden = !open;
		embedBtn.setAttribute('aria-expanded', String(open));
		if (open) snippetPre.focus();
	});
	$('.wd-talk-copy').addEventListener('click', async (e) => {
		try {
			await navigator.clipboard.writeText(snippetPre.textContent);
			e.currentTarget.textContent = 'Copied';
			e.currentTarget.addEventListener('blur', () => { e.target.textContent = 'Copy snippet'; }, { once: true });
		} catch {
			shell.toast('Copy failed. Select the snippet and copy it by hand.');
		}
	});
	$('.wd-talk-close').addEventListener('click', () => close());

	// ---- open / close ----
	function open(m, { place: where = 'the campus', thumbOf } = {}) {
		if (!m) return;
		if (member?.id !== m.id) {
			history = [];
			logEl.replaceChildren();
		}
		member = m;
		place = where;
		nameEl.textContent = m.name;
		const bits = [m.registered ? 'Registered on-chain' : 'three.ws agent', m.chats ? `${m.chats} conversation${m.chats === 1 ? '' : 's'}` : null, m.skills.length ? `${m.skills.length} skill${m.skills.length === 1 ? '' : 's'}` : null].filter(Boolean);
		metaEl.textContent = bits.join(' / ');
		const thumb = thumbOf?.(m) || m.thumb;
		thumbEl.style.backgroundImage = thumb ? `url("${thumb}")` : '';
		thumbEl.classList.toggle('is-blank', !thumb);
		aboutEl.textContent = m.description || `${m.name} has not written a description yet. Ask what they do.`;
		snippetPre.textContent = embedSnippet(m);
		snippet.hidden = true;
		embedBtn.setAttribute('aria-expanded', 'false');
		input.placeholder = `Say something to ${m.name}`;
		el.hidden = false;
		agents.hold(m.id, true);
		onOpen?.();
		input.focus();
	}
	function close() {
		if (el.hidden) return;
		streaming?.abort();
		stopAudio();
		if (member) agents.hold(member.id, false);
		// Hand the keyboard back to the world: controls ignore keys while a field has focus.
		input.blur();
		el.hidden = true;
		onClose?.();
	}
	addEventListener('keydown', (e) => {
		if (e.key === 'Escape' && !el.hidden) close();
	});

	return {
		el,
		open,
		close,
		get isOpen() { return !el.hidden; },
		get member() { return member; },
		dispose() { close(); el.remove(); },
	};
}
