// /l/:id: the permanent showcase of a coin launched from the multichain
// launchpad. It plays what the coin is about (the agent, the avatar, or the
// avatar performing the animation) and links to the coin on its venue and on
// the chain explorer. Data: GET /api/multichain-launch/subject?id=.
//
// Coin names, tickers and descriptions are creator-supplied text, so every
// value is escaped and links only render when they are https.

import { esc, explainLoad, getJson, short } from '../paired/common.js';

const $ = (s, r = document) => r.querySelector(s);
const CHAIN_NAMES = { solana: 'Solana', bsc: 'BNB Chain', base: 'Base', robinhood: 'Robinhood Chain' };
const VENUE_NAMES = { pump: 'pump.fun', flap: 'flap.sh', four_meme: 'four.meme' };
const KIND_NAMES = { agent: 'A 3D agent', avatar: 'An avatar', animation: 'An animation', bundle: 'Agent, avatar and animation' };
const STATUS_TEXT = {
	draft: 'This launch has not been sent yet.',
	prepared: 'This launch is ready but has not been sent yet.',
	submitted: 'The launch transaction is on its way. This page updates when it confirms.',
	failed: 'This launch did not go through. No coin was created.',
};

const safeUrl = (u) => (typeof u === 'string' && /^https:\/\//.test(u) ? u : null);

function idFromPath() {
	const m = location.pathname.match(/^\/l\/([a-z0-9]{6,16})\/?$/);
	return m ? m[1] : new URL(location.href).searchParams.get('id') || '';
}

function skeleton() {
	return `<div class="ml-subject-grid"><div class="cv-skel" style="aspect-ratio:1/1;border-radius:14px"></div><div class="pc-panel"><div class="cv-skel" style="height:2rem;width:60%"></div><div class="cv-skel" style="height:1rem"></div><div class="cv-skel" style="height:1rem;width:80%"></div><div class="cv-skel" style="height:2.5rem;width:50%"></div></div></div>`;
}

function setMeta(s) {
	const title = s.coin ? `$${s.coin.symbol} · ${s.coin.name}` : s.title;
	document.title = `${title} · three.ws`;
	const desc = s.coin?.description || `${s.title}, launched on three.ws.`;
	document.querySelector('meta[name="description"]')?.setAttribute('content', desc.slice(0, 300));
	document.querySelector('meta[property="og:title"]')?.setAttribute('content', title);
	document.querySelector('meta[property="og:description"]')?.setAttribute('content', desc.slice(0, 300));
	let canon = document.querySelector('link[rel="canonical"]');
	if (!canon) {
		canon = document.createElement('link');
		canon.rel = 'canonical';
		document.head.appendChild(canon);
	}
	canon.href = s.url;
}

function view(s) {
	const live = s.status === 'live';
	const chain = CHAIN_NAMES[s.chain] || s.chain;
	const venue = VENUE_NAMES[s.venue] || s.venue;
	const links = s.links || {};
	const venueUrl = safeUrl(links.venue);
	const txUrl = safeUrl(links.explorer_tx);
	const tokenUrl = safeUrl(links.explorer_token);
	const image = safeUrl(s.coin?.image_url);
	const about = [
		s.agent ? `<dt>Agent</dt><dd><a href="${esc(s.agent.url)}">${esc(s.agent.name)}</a></dd>` : '',
		s.avatar ? `<dt>Avatar</dt><dd><a href="/avatars/${esc(s.avatar.id)}">${esc(s.avatar.name || 'Avatar')}</a></dd>` : '',
		s.animation ? `<dt>Animation</dt><dd>${esc(s.animation.label || s.animation.id)}</dd>` : '',
	].join('');
	const poseHref = s.avatar ? `/pose?avatar=${encodeURIComponent(s.avatar.id)}${s.animation ? `&anim=${encodeURIComponent(s.animation.id)}` : ''}` : null;
	return `
	<div class="ml-subject-grid">
		<section class="pc-panel ml-preview">
			<div id="ls-stage" class="ml-stage" aria-label="3D preview of ${esc(s.title)}"></div>
			<p class="pc-fine" style="margin:0">${esc(KIND_NAMES[s.kind] || s.kind)}${s.animation ? ` · ${esc(s.animation.label)}` : ''}</p>
		</section>
		<section class="pc-panel">
			<p class="cv-sub" style="margin:0">${live ? `Live on ${esc(chain)} · ${esc(venue)}` : s.chain ? `${esc(chain)} · ${esc(venue)}` : 'Not launched yet'} <span class="ml-badge is-${esc(s.status)}">${esc(s.status)}</span></p>
			<h1 class="ch-title" style="margin:0.25rem 0;display:flex;gap:0.6rem;align-items:center;flex-wrap:wrap">
				${image ? `<img src="${esc(image)}" alt="" width="48" height="48" style="border-radius:50%;object-fit:cover" loading="lazy" />` : ''}
				${s.coin ? `$${esc(s.coin.symbol)} <span style="font-weight:400;color:var(--cv-text-2)">${esc(s.coin.name)}</span>` : esc(s.title)}
			</h1>
			${s.coin?.description ? `<p style="margin:0;color:var(--cv-text-2);white-space:pre-line">${esc(s.coin.description)}</p>` : ''}
			${live ? '' : `<p class="pc-status${s.status === 'failed' ? ' is-error' : ''}" role="status">${esc(STATUS_TEXT[s.status] || '')}</p>`}
			<dl class="pc-out">
				<dt>About</dt><dd>${esc(s.title)}</dd>
				${about}
				${s.token ? `<dt>Token</dt><dd><code title="${esc(s.token)}">${esc(short(s.token))}</code> <button type="button" class="pc-btn" id="ls-copy" style="padding:0.15rem 0.5rem;font-size:0.8rem">Copy</button></dd>` : ''}
				${s.creator_address ? `<dt>Creator</dt><dd><code title="${esc(s.creator_address)}">${esc(short(s.creator_address))}</code></dd>` : ''}
				${s.launched_at ? `<dt>Launched</dt><dd>${esc(new Date(s.launched_at).toLocaleString())}</dd>` : ''}
			</dl>
			<div class="ml-links">
				${venueUrl ? `<a class="pc-btn pc-btn-primary" href="${esc(venueUrl)}" target="_blank" rel="noopener noreferrer">Trade on ${esc(venue)} ↗</a>` : ''}
				${tokenUrl ? `<a class="pc-btn" href="${esc(tokenUrl)}" target="_blank" rel="noopener noreferrer">Token on the explorer ↗</a>` : ''}
				${txUrl ? `<a class="pc-btn" href="${esc(txUrl)}" target="_blank" rel="noopener noreferrer">Launch transaction ↗</a>` : ''}
				${poseHref ? `<a class="pc-btn" href="${esc(poseHref)}">Open in Pose Studio</a>` : ''}
				<a class="pc-btn" href="/launch/multichain${s.avatar ? `?avatar=${encodeURIComponent(s.avatar.id)}${s.animation ? `&anim=${encodeURIComponent(s.animation.id)}` : ''}` : ''}">Launch your own</a>
			</div>
			<p class="pc-fine">Coins are created by their creators, not by three.ws. Anyone can trade them; prices can go to zero.</p>
		</section>
	</div>`;
}

async function mountStage(s) {
	const stage = $('#ls-stage');
	const avatarId = s.avatar?.id || '';
	const agentId = s.agent?.id || '';
	if (!avatarId && !agentId) {
		stage.innerHTML = '<p class="ml-stage-empty">This coin\'s avatar is private, so there is nothing to show here.</p>';
		return;
	}
	try {
		await import('../element.js');
	} catch {
		stage.innerHTML = '<p class="ml-stage-empty">The 3D preview could not load.</p>';
		return;
	}
	const el = document.createElement('agent-3d');
	if (avatarId) el.setAttribute('avatar-id', avatarId);
	else el.setAttribute('agent-id', agentId);
	if (s.animation) el.setAttribute('clip', s.animation.id);
	el.setAttribute('mode', 'inline');
	el.setAttribute('controls', 'orbit');
	el.setAttribute('width', '100%');
	el.setAttribute('height', '100%');
	stage.replaceChildren(el);
}

let mountedKey = '';
let timer = null;

async function load() {
	const root = $('#ls-app');
	const id = idFromPath();
	if (!id) {
		root.innerHTML = `<section class="pc-empty"><h2>No launch picked</h2><p>This link is missing its launch id.</p><div><a class="pc-btn pc-btn-primary" href="/launch/multichain">Open the launchpad</a></div></section>`;
		return;
	}
	let s;
	try {
		s = await getJson(`/api/multichain-launch/subject?id=${encodeURIComponent(id)}`);
	} catch (err) {
		const missing = err.status === 404;
		root.innerHTML = `<section class="pc-empty"><h2>${missing ? 'This launch does not exist' : 'This launch could not load'}</h2><p>${esc(missing ? 'Check the link, or start your own launch.' : explainLoad(err))}</p><div>${missing ? '<a class="pc-btn pc-btn-primary" href="/launch/multichain">Open the launchpad</a>' : '<button type="button" class="pc-btn pc-btn-primary" id="ls-retry">Try again</button>'}</div></section>`;
		$('#ls-retry')?.addEventListener('click', () => {
			root.innerHTML = skeleton();
			load();
		});
		return;
	}
	setMeta(s);
	const key = `${s.avatar?.id}|${s.agent?.id}|${s.animation?.id}`;
	const stage = $('#ls-stage');
	const keepStage = stage && mountedKey === key ? stage.firstElementChild : null;
	root.innerHTML = view(s);
	if (keepStage) $('#ls-stage').replaceChildren(keepStage);
	else {
		mountedKey = key;
		mountStage(s);
	}
	$('#ls-copy')?.addEventListener('click', async (e) => {
		try {
			await navigator.clipboard.writeText(s.token);
			e.currentTarget.textContent = 'Copied';
		} catch {
			e.currentTarget.textContent = 'Select and copy';
		}
	});
	clearTimeout(timer);
	if (s.status === 'submitted') timer = setTimeout(load, 5000);
}

$('#ls-app').innerHTML = skeleton();
load();
