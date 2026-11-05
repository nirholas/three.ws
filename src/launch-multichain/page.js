// /launch/multichain: launch a coin off a 3D agent, an avatar, one animation,
// or all three linked, on Solana (pump.fun), BNB Chain (four.meme, flap.sh),
// Base (flap.sh) or Robinhood Chain (flap.sh). The coin's subject and its
// signer are independent: a public avatar's dance can launch from one of your
// agent wallets, and your own agent can launch from your own wallet.
//
// Data flow
//   GET  /api/multichain-launch/venues   chains, venues, curated animations
//   GET  /api/agents, /api/avatars       the signed-in owner's agents and avatars
//   POST /api/multichain-launch/subject  the launch row and its /l/:id showcase
//   EVM:    quote -> confirmation table -> launch (agent, Idempotency-Key,
//           follows GET /api/launches/:id) or prepare -> wallet send -> confirm
//   four.meme: the four.meme half (sign-in, logo upload, signed createArg) runs
//           here in the browser, the way four.meme's own site runs it
//   Solana: the existing pump.fun endpoints, then solana-link ties the mint to
//           the subject
// Nothing is signed or sent before the creator presses Launch in the
// confirmation table.

import { ensureRiskAck } from '../shared/risk-ack.js';
import { amount, esc, explainLoad, getJson, short, usd } from '../paired/common.js';
import { connectLaunchWallet, signAndBroadcast, waitForConfirmation, walletInstalled } from '../launch/launch-wallet.js';
import { friendlyLaunchError, normalizeSymbol } from '../launch/launch-model.js';

const $ = (s, r = document) => r.querySelector(s);
const API = '/api/multichain-launch';

const KINDS = [
	{ id: 'animation', label: 'An animation', note: 'One dance or move, played on an avatar. The coin is the move.' },
	{ id: 'avatar', label: 'An avatar', note: 'A 3D character: yours or any public one.' },
	{ id: 'agent', label: 'A 3D agent', note: 'One of your agents, with its body.' },
	{ id: 'bundle', label: 'All linked', note: 'Your agent, an avatar and an animation together.' },
];

const STAGES = [
	['accepted', 'Request accepted'],
	['policy_checked', 'Spend policy checked'],
	['reserved', 'Spend reserved'],
	['submitted', 'Transaction sent'],
	['confirmed', 'Confirmed on chain'],
	['finalized', 'Launch recorded'],
];

const state = {
	user: undefined,
	venues: null,
	venuesError: '',
	agents: [],
	avatars: [],
	extraAvatar: null,
	agentsError: '',
	avatarsError: '',
	subject: { kind: 'animation', agentId: '', avatarId: '', animation: '' },
	subjectRow: null,
	subjectKey: '',
	chain: 'solana',
	venue: 'pump',
	signer: 'agent',
	signerAgentId: '',
	evm: null,
	sol: null,
	form: { name: '', symbol: '', symbolTouched: false, description: '', image: '', website: '', twitter: '', telegram: '', openingBuy: '', taxBps: 100, label: 'Meme' },
	quote: null,
	quoteError: '',
	quoting: false,
	running: false,
	record: null,
	result: null,
	mine: null,
	attempt: null,
};

// ── helpers ────────────────────────────────────────────────────────────────

function chainInfo(id = state.chain) {
	return state.venues?.chains.find((c) => c.id === id) || null;
}
function venueInfo() {
	return chainInfo()?.venues.find((v) => v.id === state.venue) || null;
}
const isSolana = () => state.chain === 'solana';
const agentById = (id) => state.agents.find((a) => a.id === id) || null;
const allAvatars = () => (state.extraAvatar && !state.avatars.some((a) => a.id === state.extraAvatar.id) ? [state.extraAvatar, ...state.avatars] : state.avatars);
const avatarById = (id) => allAvatars().find((a) => a.id === id) || null;
const clipById = (id) => state.venues?.animations.find((c) => c.id === id) || null;

async function post(path, body, headers = {}) {
	return getJson(path, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', ...headers }, body: JSON.stringify(body) });
}

function subjectPayload() {
	const s = state.subject;
	const out = { kind: s.kind };
	if (s.kind === 'agent' || s.kind === 'bundle') out.agent_id = s.agentId || undefined;
	if (s.kind !== 'agent' || s.avatarId) out.avatar_id = s.avatarId || undefined;
	if (s.kind === 'animation' || s.kind === 'bundle') out.animation = s.animation || undefined;
	return out;
}

function subjectProblem() {
	const s = state.subject;
	if ((s.kind === 'agent' || s.kind === 'bundle') && !s.agentId) return 'Pick the agent this coin is linked to.';
	if ((s.kind === 'avatar' || s.kind === 'animation') && !s.avatarId) return 'Pick the avatar this coin is about.';
	if ((s.kind === 'animation' || s.kind === 'bundle') && !s.animation) return 'Pick the animation.';
	return '';
}

/** Default coin name for a subject, so the form starts filled in. */
function suggestedName() {
	const s = state.subject;
	const av = avatarById(s.avatarId);
	const ag = agentById(s.agentId);
	const clip = clipById(s.animation);
	if (s.kind === 'animation' && clip) return `${av?.name || 'Avatar'} ${clip.label}`.slice(0, 32);
	if (s.kind === 'bundle') return `${ag?.name || ''} ${clip?.label || ''}`.trim().slice(0, 32);
	if (s.kind === 'agent') return (ag?.name || '').slice(0, 32);
	return (av?.name || '').slice(0, 32);
}

/** One subject row per distinct subject: re-quoting the same pick reuses it. */
async function ensureSubject() {
	const payload = subjectPayload();
	const key = JSON.stringify(payload);
	if (state.subjectRow && state.subjectKey === key && state.subjectRow.status !== 'live') return state.subjectRow;
	state.subjectRow = await post(`${API}/subject`, payload);
	state.subjectKey = key;
	return state.subjectRow;
}

function coinBody(subject) {
	const f = state.form;
	const body = { subject_id: subject.id, venue: state.venue, chain: state.chain, name: f.name.trim(), symbol: normalizeSymbol(f.symbol) };
	if (f.description.trim()) body.description = f.description.trim();
	if (f.image.trim()) body.image_url = f.image.trim();
	const socials = {};
	if (f.website.trim()) socials.website = f.website.trim();
	if (f.twitter.trim()) socials.twitter = f.twitter.trim();
	if (f.telegram.trim()) socials.telegram = f.telegram.trim();
	if (Object.keys(socials).length) body.socials = socials;
	if (f.openingBuy.trim() && Number(f.openingBuy) > 0) body.opening_buy = f.openingBuy.trim();
	if (state.venue === 'flap') body.tax_bps = Number(f.taxBps);
	if (state.venue === 'four_meme') body.label = f.label;
	if (state.signer === 'agent') body.agent_id = state.signerAgentId;
	else if (state.evm) body.wallet = state.evm.address;
	return body;
}

// ── EVM wallet (injected EIP-1193) ─────────────────────────────────────────

function ethProvider() {
	return typeof window !== 'undefined' ? window.ethereum || null : null;
}

async function connectEvm() {
	const p = ethProvider();
	if (!p) throw Object.assign(new Error('No EVM wallet found in this browser. Install MetaMask, Rabby or another EVM wallet, then reload.'), { code: 'NO_PROVIDER' });
	const [address] = await p.request({ method: 'eth_requestAccounts' });
	if (!address) throw new Error('The wallet did not share an address.');
	state.evm = { address };
	return state.evm;
}

async function ensureEvmChain() {
	const p = ethProvider();
	const c = chainInfo();
	const hex = `0x${Number(c.chain_id).toString(16)}`;
	const current = await p.request({ method: 'eth_chainId' });
	if (String(current).toLowerCase() === hex) return;
	try {
		await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] });
	} catch (err) {
		if (err?.code !== 4902 || !c.wallet_params) throw err;
		await p.request({ method: 'wallet_addEthereumChain', params: [{ chainId: hex, ...c.wallet_params }] });
		await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] });
	}
}

async function personalSign(message, address) {
	return ethProvider().request({ method: 'personal_sign', params: [message, address] });
}

// ── four.meme (runs in this browser, exactly like four.meme's own site) ─────

async function fourMeme(path, init) {
	const base = chainInfo('bsc').venues.find((v) => v.id === 'four_meme').api;
	let res;
	try {
		res = await fetch(`${base}${path}`, init);
	} catch {
		throw new Error('four.meme could not be reached from this browser. It blocks some regions; try again from a supported region or with flap.sh instead.');
	}
	const body = await res.json().catch(() => null);
	if (!res.ok || !body || (body.code !== '0' && body.code !== 0)) {
		throw new Error(`four.meme refused the request${body?.msg ? `: ${body.msg}` : ` (${res.status})`}.`);
	}
	return body.data;
}

/**
 * Get four.meme's signed launch for this coin. `sign(message)` signs the
 * four.meme sign-in text with the wallet that will send the launch.
 */
async function fourMemeCreateArg({ address, sign, subject }) {
	const nonce = await fourMeme('/private/user/nonce/generate', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ accountAddress: address, verifyType: 'LOGIN', networkCode: 'BSC' }),
	});
	const signature = await sign(`You are sign in Meme ${nonce}`);
	const token = await fourMeme('/private/user/login/dex', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ region: 'WEB', langType: 'EN', loginIp: '', inviteCode: '', verifyInfo: { address, networkCode: 'BSC', signature, verifyType: 'LOGIN' }, walletName: 'MetaMask' }),
	});
	const custom = state.form.image.trim();
	const logoRes = await fetch(`${API}/logo?subject=${encodeURIComponent(subject.id)}${custom ? `&url=${encodeURIComponent(custom)}` : ''}`, { credentials: 'include' });
	if (!logoRes.ok) throw new Error('The coin logo could not be loaded. Add a logo link (PNG, JPEG, WebP or GIF).');
	const blob = await logoRes.blob();
	const form = new FormData();
	form.append('file', blob, `logo.${(blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`);
	const imgUrl = await fourMeme('/private/token/upload', { method: 'POST', headers: { 'meme-web-access': token }, body: form });
	const config = await fourMeme('/public/config', {});
	const published = (Array.isArray(config) ? config : []).filter((c) => c.status === 'PUBLISH');
	const raisedToken = published.find((c) => c.symbol === 'BNB') || published[0];
	if (!raisedToken) throw new Error('four.meme is not accepting BNB launches right now.');
	const f = state.form;
	const body = {
		name: f.name.trim(),
		shortName: normalizeSymbol(f.symbol),
		desc: f.description.trim() || subject.title,
		totalSupply: Number(raisedToken.totalAmount ?? 1_000_000_000),
		raisedAmount: Number(raisedToken.totalBAmount ?? 24),
		saleRate: Number(raisedToken.saleRate ?? 0.8),
		reserveRate: 0,
		imgUrl,
		raisedToken,
		launchTime: Date.now(),
		funGroup: false,
		label: f.label,
		lpTradingFee: 0.0025,
		preSale: f.openingBuy.trim() && Number(f.openingBuy) > 0 ? f.openingBuy.trim() : '0',
		clickFun: false,
		symbol: raisedToken.symbol,
		dexType: 'PANCAKE_SWAP',
		rushMode: false,
		onlyMPC: false,
		feePlan: false,
		webUrl: f.website.trim() || subject.url,
	};
	if (f.twitter.trim()) body.twitterUrl = f.twitter.trim();
	if (f.telegram.trim()) body.telegramUrl = f.telegram.trim();
	const created = await fourMeme('/private/token/create', { method: 'POST', headers: { 'content-type': 'application/json', 'meme-web-access': token }, body: JSON.stringify(body) });
	if (!created?.createArg || !created?.signature) throw new Error('four.meme did not return a signed launch.');
	return { create_arg: created.createArg, signature: created.signature };
}

// ── boot ───────────────────────────────────────────────────────────────────

async function boot() {
	const params = new URL(location.href).searchParams;
	render();
	const venuesP = getJson(`${API}/venues`).then((v) => (state.venues = v)).catch((err) => (state.venuesError = explainLoad(err)));
	const meP = fetch('/api/auth/me', { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
	const [, me] = await Promise.all([venuesP, meP]);
	state.user = me?.user || null;
	if (state.user) {
		await loadLists();
		loadMine();
	}
	const wantAvatar = params.get('avatar');
	if (wantAvatar && !state.avatars.some((a) => a.id === wantAvatar)) {
		try {
			const { avatar } = await getJson(`/api/avatars/${encodeURIComponent(wantAvatar)}`);
			if (avatar) state.extraAvatar = { id: avatar.id, name: avatar.name || 'Avatar', thumbnail_url: avatar.thumbnail_url || null, public: true };
		} catch {
			/* a private or removed avatar simply is not offered */
		}
	}
	const s = state.subject;
	s.avatarId = (wantAvatar && avatarById(wantAvatar)?.id) || state.avatars[0]?.id || state.extraAvatar?.id || '';
	s.agentId = (params.get('agent') && agentById(params.get('agent'))?.id) || state.agents[0]?.id || '';
	const anim = params.get('anim');
	s.animation = (anim && clipById(anim)?.id) || '';
	if (params.get('kind') && KINDS.some((k) => k.id === params.get('kind'))) s.kind = params.get('kind');
	else if (anim) s.kind = params.get('agent') ? 'bundle' : 'animation';
	else if (params.get('agent')) s.kind = 'agent';
	else if (wantAvatar) s.kind = 'avatar';
	state.signerAgentId = s.agentId || state.agents[0]?.id || '';
	if (!state.agents.length) state.signer = 'wallet';
	if (params.get('chain') && chainInfo(params.get('chain'))) selectChain(params.get('chain'), false);
	state.form.name = suggestedName();
	state.form.symbol = normalizeSymbol(state.form.name);
	render();
}

// Agents and avatars load independently: a failure in one is an inline notice
// with a retry, never a dead page, because a wallet-signed avatar or animation
// launch needs neither list.
async function loadLists() {
	const [ag, av] = await Promise.allSettled([getJson('/api/agents'), getJson('/api/avatars?limit=100')]);
	state.agents = ag.status === 'fulfilled' ? ag.value.agents || [] : state.agents;
	state.agentsError = ag.status === 'rejected' ? explainLoad(ag.reason) : '';
	state.avatars = av.status === 'fulfilled' ? av.value.avatars || [] : state.avatars;
	state.avatarsError = av.status === 'rejected' ? explainLoad(av.reason) : '';
}

function listNotice(what, message) {
	return `<p class="pc-status is-error" role="status">Your ${what} could not load: ${esc(message)} <button type="button" class="pc-btn" data-reload-lists>Try again</button></p>`;
}

async function loadMine() {
	try {
		state.mine = await getJson(`${API}/mine?limit=8`);
	} catch {
		state.mine = [];
	}
	const box = $('#ml-mine');
	if (box) box.outerHTML = mineCard();
}

function selectChain(id, rerender = true) {
	state.chain = id;
	state.venue = chainInfo(id)?.venues[0]?.id || '';
	state.quote = null;
	state.quoteError = '';
	if (rerender) render();
}

// ── render ─────────────────────────────────────────────────────────────────

function emptyCard(title, text, action) {
	return `<section class="pc-empty"><h2>${esc(title)}</h2><p>${text}</p><div>${action}</div></section>`;
}

function render() {
	const root = $('#ml-app');
	if (state.user === undefined || (!state.venues && !state.venuesError)) {
		root.innerHTML = `<div class="pc-launch"><div class="cv-skel" style="height:640px;border-radius:14px"></div><div class="cv-skel" style="height:420px;border-radius:14px"></div></div>`;
		return;
	}
	if (state.venuesError) {
		root.innerHTML = emptyCard('The launchpad could not load', esc(state.venuesError), '<button type="button" class="pc-btn" id="ml-retry">Try again</button>');
		$('#ml-retry').addEventListener('click', () => location.reload());
		return;
	}
	if (!state.user) {
		const next = encodeURIComponent(location.pathname + location.search);
		root.innerHTML = emptyCard('Sign in to launch', 'Every coin is linked to a three.ws showcase page and, when you pick one, to your agent. Sign in to start.', `<a class="pc-btn pc-btn-primary" href="/login?next=${next}">Sign in</a>`);
		return;
	}
	if (state.record || state.result) {
		root.innerHTML = trackerCard();
		wireTracker();
		return;
	}
	root.innerHTML = `<div class="pc-launch"><div class="ml-col">${subjectCard()}${chainCard()}${signerCard()}${coinCard()}</div><aside id="ml-side" class="ml-side">${previewCard()}${summaryCard()}</aside></div>${mineCard()}`;
	wireAll();
	mountPreview();
}

function subjectCard() {
	const s = state.subject;
	const needAgent = s.kind === 'agent' || s.kind === 'bundle';
	const needAnim = s.kind === 'animation' || s.kind === 'bundle';
	const avatars = allAvatars();
	const avatarOptions = avatars.map((a) => `<option value="${esc(a.id)}" ${a.id === s.avatarId ? 'selected' : ''}>${esc(a.name || 'Avatar')}${a.public ? ' (public)' : ''}</option>`).join('');
	const agentOptions = state.agents.map((a) => `<option value="${esc(a.id)}" ${a.id === s.agentId ? 'selected' : ''}>${esc(a.name || 'Agent')}</option>`).join('');
	const clipOptions = (state.venues.animations || []).map((c) => `<option value="${esc(c.id)}" ${c.id === s.animation ? 'selected' : ''}>${esc(c.label)}</option>`).join('');
	return `
	<section class="pc-panel">
		<h2 class="cv-h2"><span class="ml-step">1</span> What is the coin about?</h2>
		<div class="ml-options" role="radiogroup" aria-label="Coin subject">
			${KINDS.map((k) => `<button type="button" class="ml-option" role="radio" data-kind="${k.id}" aria-checked="${k.id === s.kind}"><strong>${esc(k.label)}</strong><small>${esc(k.note)}</small></button>`).join('')}
		</div>
		${needAgent && state.agentsError && !state.agents.length ? listNotice('agents', state.agentsError) : needAgent ? (state.agents.length ? `<label class="pc-field"><span>Agent</span><select class="pc-input" id="s-agent">${agentOptions}</select></label>` : `<p class="pc-fine">You have no agents yet. <a href="/create">Create one</a> or launch off an avatar or animation instead.</p>`) : ''}
		${state.avatarsError && !state.avatars.length ? listNotice('avatars', state.avatarsError) : ''}
		${avatars.length || needAgent
			? `<label class="pc-field"><span>Avatar${s.kind === 'agent' ? ' <em>optional, defaults to the agent\'s body</em>' : ''}</span><select class="pc-input" id="s-avatar">${s.kind === 'agent' ? '<option value="">The agent\'s own body</option>' : ''}${avatarOptions}</select></label>`
			: `<p class="pc-fine">No avatars yet. <a href="/avatars">Find a public avatar</a> and open it with “Launch a coin”, or <a href="/create">make your own</a>.</p>`}
		<label class="pc-field"><span>Or paste a public avatar link</span>
			<input class="pc-input" id="s-avatar-link" autocomplete="off" placeholder="https://three.ws/pose?avatar=…" />
		</label>
		${needAnim ? `<label class="pc-field"><span>Animation</span><select class="pc-input" id="s-anim"><option value="">Pick an animation</option>${clipOptions}</select></label>` : ''}
	</section>`;
}

function chainCard() {
	const chains = state.venues.chains;
	const c = chainInfo();
	const also = [...(c?.also || []), ...(c?.paired ? [c.paired] : [])];
	return `
	<section class="pc-panel">
		<h2 class="cv-h2"><span class="ml-step">2</span> Chain and launchpad</h2>
		<div class="ml-options ml-chains" role="radiogroup" aria-label="Chain">
			${chains.map((ch) => `<button type="button" class="ml-option" role="radio" data-chain="${esc(ch.id)}" aria-checked="${ch.id === state.chain}"><strong>${esc(ch.name)}${ch.home ? ' <span class="ml-badge">home</span>' : ''}</strong><small>${esc(ch.venues.map((v) => v.label).join(' · '))}</small></button>`).join('')}
		</div>
		<div class="ml-options" role="radiogroup" aria-label="Launchpad">
			${(c?.venues || []).map((v) => `<button type="button" class="ml-option" role="radio" data-venue="${esc(v.id)}" aria-checked="${v.id === state.venue}"><strong>${esc(v.label)}</strong><small>${esc(venueNote(v.id))}</small></button>`).join('')}
		</div>
		${also.length ? `<p class="pc-fine">Also on ${esc(c.name)}: ${also.map((a) => `<a href="${esc(a.href)}">${esc(a.label)}</a>`).join(' · ')}</p>` : ''}
	</section>`;
}

function venueNote(id) {
	if (id === 'pump') return 'Bonding curve on Solana, graduates to PumpSwap.';
	if (id === 'flap') return 'Bonding curve with a buy and sell tax paid to the creator.';
	if (id === 'four_meme') return 'Bonding curve on BNB Chain, graduates to PancakeSwap.';
	return '';
}

function signerCard() {
	const solana = isSolana();
	const agentOptions = state.agents.map((a) => `<option value="${esc(a.id)}" ${a.id === state.signerAgentId ? 'selected' : ''}>${esc(a.name || 'Agent')}</option>`).join('');
	const wallet = solana ? state.sol : state.evm;
	return `
	<section class="pc-panel">
		<h2 class="cv-h2"><span class="ml-step">3</span> Who signs</h2>
		<div class="ml-options" role="radiogroup" aria-label="Signer">
			<button type="button" class="ml-option" role="radio" data-signer="agent" aria-checked="${state.signer === 'agent'}" ${state.agents.length ? '' : 'disabled'}><strong>An agent wallet</strong><small>One of your agents signs from its own ${solana ? 'Solana' : 'EVM'} wallet, inside its spend policy.</small></button>
			<button type="button" class="ml-option" role="radio" data-signer="wallet" aria-checked="${state.signer === 'wallet'}"><strong>Your wallet</strong><small>${solana ? 'Phantom, Backpack or Solflare.' : 'MetaMask, Rabby or any EVM wallet.'} You approve the transaction.</small></button>
		</div>
		${state.signer === 'agent' || solana
			? state.agentsError && !state.agents.length
				? listNotice('agents', state.agentsError)
				: state.agents.length
				? `<label class="pc-field"><span>${state.signer === 'agent' ? 'Signing agent' : 'Home agent on three.ws'}</span><select class="pc-input" id="g-agent">${agentOptions}</select>${solana && state.signer === 'wallet' ? '<small>pump.fun coins on three.ws are listed under one of your agents.</small>' : ''}</label>`
				: `<p class="pc-fine">${solana ? 'Solana launches are listed under one of your agents.' : 'An agent wallet needs an agent.'} <a href="/create">Create an agent</a>${solana ? '' : ' or sign with your own wallet'}.</p>`
			: ''}
		${state.signer === 'wallet'
			? wallet
				? `<p class="pc-fine">Connected: <code title="${esc(wallet.address)}">${esc(short(wallet.address))}</code></p>`
				: `<button type="button" class="pc-btn" id="g-connect">Connect ${solana ? 'a Solana' : 'an EVM'} wallet</button>`
			: ''}
	</section>`;
}

function coinCard() {
	const f = state.form;
	const c = chainInfo();
	const v = venueInfo();
	const gas = c?.gas || 'SOL';
	return `
	<form class="pc-panel" id="ml-form" novalidate>
		<h2 class="cv-h2"><span class="ml-step">4</span> The coin</h2>
		<div class="pc-row">
			<label class="pc-field"><span>Coin name</span><input class="pc-input" id="f-name" maxlength="32" autocomplete="off" value="${esc(f.name)}" required /></label>
			<label class="pc-field pc-ticker"><span>Ticker</span><input class="pc-input mono" id="f-symbol" maxlength="10" autocomplete="off" placeholder="TICKER" value="${esc(f.symbol)}" required /></label>
		</div>
		<label class="pc-field"><span>Description ${state.venue === 'four_meme' ? '' : '<em>optional</em>'}</span>
			<textarea class="pc-input" id="f-description" maxlength="480" rows="3" placeholder="What is this coin about?">${esc(f.description)}</textarea>
		</label>
		<label class="pc-field"><span>Opening buy <em>optional</em></span>
			<div class="pc-unit"><input class="pc-input mono" id="f-buy" inputmode="decimal" autocomplete="off" placeholder="0" value="${esc(f.openingBuy)}" /><span>${esc(gas)}</span></div>
			<small>Buys the first coins off the curve into the signing wallet.</small>
		</label>
		${state.venue === 'flap' ? `<div class="pc-field"><span>Trading tax to the creator</span><div class="ml-options ml-compact" role="radiogroup" aria-label="Trading tax">${(v?.tax_options_bps || [100]).map((b) => `<button type="button" class="ml-option" role="radio" data-tax="${b}" aria-checked="${Number(f.taxBps) === b}"><strong>${b / 100}%</strong></button>`).join('')}</div><small>Charged on every buy and sell and paid to the signing wallet.</small></div>` : ''}
		${state.venue === 'four_meme' ? `<label class="pc-field"><span>Category</span><select class="pc-input" id="f-label">${(v?.labels || ['Meme']).map((l) => `<option ${l === f.label ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>` : ''}
		<label class="pc-field"><span>Logo URL <em>optional</em></span>
			<input class="pc-input" id="f-image" type="url" inputmode="url" maxlength="512" placeholder="Defaults to the avatar thumbnail" value="${esc(f.image)}" />
		</label>
		<fieldset class="pc-field" style="border:0;padding:0;margin:0"><legend style="padding:0;margin-bottom:0.35rem">Links <em>optional; the website defaults to the coin's three.ws showcase</em></legend>
			<div class="pc-row">
				<input class="pc-input" id="f-website" type="url" maxlength="200" placeholder="https://" aria-label="Website" value="${esc(f.website)}" />
				<input class="pc-input" id="f-twitter" type="url" maxlength="200" placeholder="https://x.com/…" aria-label="X link" value="${esc(f.twitter)}" />
				<input class="pc-input" id="f-telegram" type="url" maxlength="200" placeholder="https://t.me/…" aria-label="Telegram link" value="${esc(f.telegram)}" />
			</div>
		</fieldset>
	</form>`;
}

function previewCard() {
	const s = state.subject;
	const av = avatarById(s.avatarId);
	const ag = agentById(s.agentId);
	const clip = clipById(s.animation);
	const caption = [s.kind === 'agent' || s.kind === 'bundle' ? ag?.name : av?.name, clip?.label].filter(Boolean).join(' · ') || 'Pick a subject';
	return `<section class="pc-panel ml-preview"><div id="ml-stage" class="ml-stage" aria-label="3D preview of ${esc(caption)}"></div><p class="pc-fine" style="margin:0">${esc(caption)}</p></section>`;
}

let previewKey = '';
async function mountPreview() {
	const stage = $('#ml-stage');
	if (!stage) return;
	const s = state.subject;
	const agentId = s.kind === 'agent' || s.kind === 'bundle' ? s.agentId : '';
	const avatarId = s.avatarId || (agentId ? agentById(agentId)?.avatar_id : '');
	const clip = s.kind === 'animation' || s.kind === 'bundle' ? s.animation : '';
	const key = `${avatarId}|${agentId}|${clip}`;
	if (!avatarId && !agentId) {
		stage.innerHTML = '<p class="ml-stage-empty">Pick an avatar or agent to see it here.</p>';
		previewKey = '';
		return;
	}
	if (stage.firstElementChild?.tagName === 'AGENT-3D' && previewKey === key) return;
	previewKey = key;
	try {
		await import('../element.js');
	} catch {
		stage.innerHTML = '<p class="ml-stage-empty">The 3D preview could not load. The launch still works.</p>';
		return;
	}
	const el = document.createElement('agent-3d');
	if (avatarId) el.setAttribute('avatar-id', avatarId);
	else el.setAttribute('agent-id', agentId);
	if (clip) el.setAttribute('clip', clip);
	el.setAttribute('mode', 'inline');
	el.setAttribute('controls', 'orbit');
	el.setAttribute('width', '100%');
	el.setAttribute('height', '100%');
	stage.replaceChildren(el);
}

function feeRows(q) {
	return q.fees
		.map((fee) => {
			if (fee.native != null) {
				const usdPart = fee.usd != null ? ` (${usd(fee.usd, { compact: false })})` : '';
				return `<dt>${esc(fee.label)}${fee.estimated === false ? ' (approximate)' : ''}</dt><dd>${esc(amount(fee.native))} ${esc(q.cost.symbol)}${esc(usdPart)}</dd>`;
			}
			return `<dt>${esc(fee.label)}</dt><dd>${esc(+(fee.bps / 100).toFixed(2))}%${fee.note ? `<br /><small>${esc(fee.note)}</small>` : ''}</dd>`;
		})
		.join('');
}

function summaryCard() {
	const q = state.quote;
	const problem = subjectProblem() || (!state.form.name.trim() ? 'Name the coin.' : normalizeSymbol(state.form.symbol).length < 2 ? 'The ticker needs two letters or digits.' : '') || signerProblem();
	if (state.quoteError) {
		return `<section class="pc-panel" id="ml-summary"><h2 class="cv-h2">Cost</h2><p class="pc-status is-error" role="alert">${esc(state.quoteError)}</p><button type="button" class="pc-btn" id="ml-quote">Try again</button></section>`;
	}
	if (state.quoting) {
		return `<section class="pc-panel" id="ml-summary"><h2 class="cv-h2">Cost</h2><div class="cv-skel" style="height:1.1rem"></div><div class="cv-skel" style="height:1.1rem"></div><div class="cv-skel" style="height:1.1rem"></div></section>`;
	}
	if (!q) {
		return `<section class="pc-panel" id="ml-summary"><h2 class="cv-h2">Cost</h2><p class="pc-fine">${esc(problem || 'Get a quote to see every fee before anything is signed.')}</p>
			<button type="button" class="pc-btn pc-btn-primary" id="ml-quote" ${problem ? 'disabled' : ''}>Get a quote</button></section>`;
	}
	const blockers = q.blockers.length ? `<ul class="pc-blockers" role="alert">${q.blockers.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : '';
	return `
	<section class="pc-panel" id="ml-summary">
		<h2 class="cv-h2">$${esc(q.coin.symbol)} on ${esc(q.venue_label)}</h2>
		<dl class="pc-out">
			<dt>Chain</dt><dd>${esc(q.chain_name)}</dd>
			<dt>Supply</dt><dd>${esc(Number(q.coin.total_supply).toLocaleString('en-US'))}</dd>
			<dt>Graduation</dt><dd>${esc(q.curve.graduation)}</dd>
			<dt>Signer</dt><dd>${q.agent ? esc(q.agent.name) : 'Your wallet'} · <code title="${esc(q.wallet.address)}">${esc(short(q.wallet.address))}</code></dd>
			<dt>Balance</dt><dd>${esc(amount(q.wallet.balance))} ${esc(q.wallet.symbol)}</dd>
		</dl>
		<h2 class="cv-h2">Every fee</h2>
		<dl class="pc-out">${feeRows(q)}
			<dt><strong>Total</strong></dt><dd><strong>${esc(amount(q.cost.total))} ${esc(q.cost.symbol)}</strong>${q.cost.total_usd != null ? `<br /><small>about ${esc(usd(q.cost.total_usd, { compact: false }))}</small>` : ''}</dd>
		</dl>
		${blockers}
		<div class="pc-hero-actions">
			<button type="button" class="pc-btn" id="ml-quote">Refresh quote</button>
			<button type="button" class="pc-btn pc-btn-primary" id="ml-launch" ${q.ready && !state.running ? '' : 'disabled'}>Review and launch</button>
		</div>
		<p class="pc-fine">Nothing is signed until you confirm the table that follows.</p>
	</section>`;
}

function signerProblem() {
	if (state.signer === 'agent' && !state.signerAgentId) return 'Pick the agent that signs.';
	if (isSolana() && !state.signerAgentId) return 'Pick the agent this coin is listed under.';
	if (state.signer === 'wallet' && !(isSolana() ? state.sol : state.evm)) return 'Connect your wallet.';
	return '';
}

function mineCard() {
	if (state.mine === null) return '<section class="pc-panel" id="ml-mine" style="margin-top:1.25rem"><h2 class="cv-h2">Your launches</h2><div class="cv-skel" style="height:3rem"></div></section>';
	if (!state.mine.length) {
		return '<section class="pc-panel" id="ml-mine" style="margin-top:1.25rem"><h2 class="cv-h2">Your launches</h2><p class="pc-fine">Launches you start here show up with their showcase page, chain and status. Pick a subject above to make your first.</p></section>';
	}
	return `<section class="pc-panel" id="ml-mine" style="margin-top:1.25rem"><h2 class="cv-h2">Your launches</h2><ul class="ml-mine">${state.mine
		.map((s) => `<li><a href="/l/${esc(s.id)}">${esc(s.coin ? `$${s.coin.symbol} · ${s.coin.name}` : s.title)}</a><span class="ml-badge is-${esc(s.status)}">${esc(s.status)}</span><small>${esc(s.chain || 'no chain yet')}${s.venue ? ` · ${esc(s.venue)}` : ''}</small></li>`)
		.join('')}</ul></section>`;
}

// ── wiring ─────────────────────────────────────────────────────────────────

function invalidateQuote() {
	state.quote = null;
	state.quoteError = '';
	const side = $('#ml-summary');
	if (side) {
		side.outerHTML = summaryCard();
		wireSummary();
	}
}

function rerenderKeepScroll() {
	const y = window.scrollY;
	render();
	window.scrollTo({ top: y });
}

function wireAll() {
	const s = state.subject;
	const f = state.form;
	const root = $('#ml-app');
	root.querySelectorAll('[data-reload-lists]').forEach((b) => b.addEventListener('click', async () => {
		b.disabled = true;
		b.textContent = 'Loading…';
		await loadLists();
		if (!s.agentId) s.agentId = state.agents[0]?.id || '';
		if (!state.signerAgentId) state.signerAgentId = s.agentId || state.agents[0]?.id || '';
		if (!s.avatarId && s.kind !== 'agent') s.avatarId = allAvatars()[0]?.id || '';
		render();
	}));
	root.querySelectorAll('[data-kind]').forEach((b) => b.addEventListener('click', () => {
		s.kind = b.dataset.kind;
		if ((s.kind === 'agent' || s.kind === 'bundle') && !s.agentId) s.agentId = state.agents[0]?.id || '';
		if (s.kind === 'agent') s.avatarId = '';
		else if (!s.avatarId) s.avatarId = allAvatars()[0]?.id || '';
		if (!f.symbolTouched) {
			f.name = suggestedName();
			f.symbol = normalizeSymbol(f.name);
		}
		state.quote = null;
		rerenderKeepScroll();
	}));
	const onSubjectChange = () => {
		if (!f.symbolTouched) {
			f.name = suggestedName();
			f.symbol = normalizeSymbol(f.name);
		}
		state.quote = null;
		rerenderKeepScroll();
	};
	$('#s-agent')?.addEventListener('change', (e) => {
		s.agentId = e.target.value;
		if (state.signer === 'agent' || isSolana()) state.signerAgentId = s.agentId;
		onSubjectChange();
	});
	$('#s-avatar')?.addEventListener('change', (e) => {
		s.avatarId = e.target.value;
		onSubjectChange();
	});
	$('#s-anim')?.addEventListener('change', (e) => {
		s.animation = e.target.value;
		onSubjectChange();
	});
	$('#s-avatar-link')?.addEventListener('change', async (e) => {
		const raw = e.target.value.trim();
		const id = (raw.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i) || [])[0];
		const anim = (() => {
			try {
				return new URL(raw).searchParams.get('anim');
			} catch {
				return null;
			}
		})();
		if (!id) {
			e.target.setCustomValidity('Paste a three.ws avatar link or id.');
			e.target.reportValidity();
			return;
		}
		try {
			const { avatar } = await getJson(`/api/avatars/${encodeURIComponent(id)}`);
			state.extraAvatar = { id: avatar.id, name: avatar.name || 'Avatar', public: true };
			s.avatarId = avatar.id;
			if (anim && clipById(anim)) {
				s.animation = anim;
				if (s.kind !== 'bundle') s.kind = 'animation';
			} else if (s.kind === 'agent') s.kind = 'avatar';
			onSubjectChange();
		} catch (err) {
			e.target.setCustomValidity(err.status === 404 || err.status === 403 ? 'That avatar is private or does not exist.' : explainLoad(err));
			e.target.reportValidity();
		}
	});
	root.querySelectorAll('[data-chain]').forEach((b) => b.addEventListener('click', () => {
		selectChain(b.dataset.chain, false);
		rerenderKeepScroll();
	}));
	root.querySelectorAll('[data-venue]').forEach((b) => b.addEventListener('click', () => {
		state.venue = b.dataset.venue;
		state.quote = null;
		rerenderKeepScroll();
	}));
	root.querySelectorAll('[data-signer]').forEach((b) => b.addEventListener('click', () => {
		state.signer = b.dataset.signer;
		state.quote = null;
		rerenderKeepScroll();
	}));
	$('#g-agent')?.addEventListener('change', (e) => {
		state.signerAgentId = e.target.value;
		invalidateQuote();
	});
	$('#g-connect')?.addEventListener('click', async (e) => {
		const btn = e.currentTarget;
		btn.disabled = true;
		btn.textContent = 'Check your wallet';
		try {
			if (isSolana()) {
				if (!walletInstalled()) {
					window.open('https://phantom.app/', '_blank', 'noopener');
					throw new Error('Install a Solana wallet, then reload this page.');
				}
				state.sol = await connectLaunchWallet();
			} else {
				await connectEvm();
			}
			state.quote = null;
			rerenderKeepScroll();
		} catch (err) {
			btn.disabled = false;
			btn.textContent = friendlyLaunchError(err);
		}
	});
	const bind = (sel, key, clean) => {
		const input = $(sel);
		input?.addEventListener('input', () => {
			if (clean) {
				const v = clean(input.value);
				if (v !== input.value) input.value = v;
			}
			f[key] = input.value;
			if (key === 'name' && !f.symbolTouched) {
				f.symbol = normalizeSymbol(f.name);
				$('#f-symbol').value = f.symbol;
			}
			if (key === 'symbol') f.symbolTouched = true;
			invalidateQuote();
		});
	};
	bind('#f-name', 'name');
	bind('#f-symbol', 'symbol', (v) => v.toUpperCase().replace(/[^A-Z0-9]/g, ''));
	bind('#f-description', 'description');
	bind('#f-buy', 'openingBuy', (v) => v.replace(/[^0-9.]/g, ''));
	bind('#f-image', 'image');
	bind('#f-website', 'website');
	bind('#f-twitter', 'twitter');
	bind('#f-telegram', 'telegram');
	$('#f-label')?.addEventListener('change', (e) => {
		f.label = e.target.value;
		invalidateQuote();
	});
	root.querySelectorAll('[data-tax]').forEach((b) => b.addEventListener('click', () => {
		f.taxBps = Number(b.dataset.tax);
		root.querySelectorAll('[data-tax]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
		invalidateQuote();
	}));
	$('#ml-form').addEventListener('submit', (e) => e.preventDefault());
	wireSummary();
}

function wireSummary() {
	$('#ml-quote')?.addEventListener('click', runQuote);
	$('#ml-launch')?.addEventListener('click', confirmLaunch);
}

function paintSummary() {
	const el = $('#ml-summary');
	if (!el) return;
	el.outerHTML = summaryCard();
	wireSummary();
}

// ── quote ──────────────────────────────────────────────────────────────────

async function pumpConfig() {
	const res = await fetch('/api/pump/launch-config', { credentials: 'include' });
	const body = await res.json().catch(() => ({}));
	return body?.data || { launch_fee_bps: 0, create_cost_sol_estimate: 0.022 };
}

async function solanaQuote(subject) {
	const cfg = await pumpConfig();
	const buy = Number(state.form.openingBuy) > 0 ? Number(state.form.openingBuy) : 0;
	const fee = (buy * (cfg.launch_fee_bps || 0)) / 10_000;
	const create = cfg.create_cost_sol_estimate ?? 0.022;
	const agent = agentById(state.signerAgentId);
	const address = state.signer === 'agent' ? agent?.meta?.solana_address || agent?.solana_address : state.sol?.address;
	return {
		venue: 'pump', venue_label: 'pump.fun', chain: 'solana', chain_name: 'Solana', subject_id: subject.id,
		agent: state.signer === 'agent' ? { id: agent?.id, name: agent?.name } : null,
		wallet: { address: address || '', balance: null, symbol: 'SOL' },
		coin: { name: state.form.name.trim(), symbol: normalizeSymbol(state.form.symbol), total_supply: '1000000000' },
		curve: { graduation: 'Bonding curve, then PumpSwap' },
		fees: [
			{ id: 'opening_buy', label: 'Opening buy', native: String(buy) },
			{ id: 'platform', label: `three.ws launch fee (${(cfg.launch_fee_bps || 0) / 100}% of the buy)`, native: String(fee) },
			{ id: 'create', label: 'Network and account rent', native: String(create), estimated: false },
		],
		cost: { total: String(buy + fee + create), symbol: 'SOL', total_usd: null },
		blockers: address ? [] : ['The signing wallet has no Solana address yet. Open the agent and set up its wallet.'],
		ready: Boolean(address),
	};
}

async function runQuote() {
	state.quoting = true;
	state.quoteError = '';
	paintSummary();
	try {
		const subject = await ensureSubject();
		if (isSolana()) {
			state.quote = await solanaQuote(subject);
		} else {
			state.quote = await post(`${API}/quote`, coinBody(subject));
		}
	} catch (err) {
		state.quote = null;
		state.quoteError = explainLoad(err);
	} finally {
		state.quoting = false;
		paintSummary();
	}
}

// ── confirm + run ──────────────────────────────────────────────────────────

/** The table the creator approves. Nothing is signed before "Launch" is pressed. */
function confirmLaunch() {
	const q = state.quote;
	if (!q?.ready || state.running) return;
	const dialog = document.createElement('dialog');
	dialog.className = 'pc-dialog';
	dialog.setAttribute('aria-labelledby', 'ml-dialog-title');
	dialog.innerHTML = `
		<h2 id="ml-dialog-title" class="cv-h2">Launch $${esc(q.coin.symbol)}?</h2>
		<p class="pc-fine" style="font-size:0.875rem;color:var(--cv-text-2)">This spends real funds and creates a coin anyone can trade. It cannot be undone.</p>
		<dl class="pc-out">
			<dt>From</dt><dd>${q.agent ? `${esc(q.agent.name || 'Agent')} · ` : 'Your wallet · '}<code>${esc(short(q.wallet.address))}</code></dd>
			<dt>To</dt><dd>${esc(q.venue_label)}${q.contract ? ` contract <code>${esc(short(q.contract))}</code>` : ''}</dd>
			<dt>Chain</dt><dd>${esc(q.chain_name)}${q.chain_id ? ` (${esc(q.chain_id)})` : ''}</dd>
			<dt>Coin</dt><dd>${esc(q.coin.name)} ($${esc(q.coin.symbol)})</dd>
			${feeRows(q)}
			<dt><strong>Amount</strong></dt><dd><strong>${esc(amount(q.cost.total))} ${esc(q.cost.symbol)}</strong></dd>
		</dl>
		<div class="pc-dialog-actions">
			<button type="button" class="pc-btn" id="ml-cancel">Cancel</button>
			<button type="button" class="pc-btn pc-btn-primary" id="ml-go">Launch</button>
		</div>`;
	document.body.appendChild(dialog);
	const close = () => {
		dialog.close();
		dialog.remove();
	};
	dialog.addEventListener('cancel', close);
	$('#ml-cancel', dialog).addEventListener('click', close);
	$('#ml-go', dialog).addEventListener('click', async () => {
		close();
		await launch();
	});
	dialog.showModal();
	$('#ml-cancel', dialog).focus();
}

function progressDialog(title, steps) {
	const dialog = document.createElement('dialog');
	dialog.className = 'pc-dialog';
	dialog.setAttribute('aria-labelledby', 'ml-run-title');
	dialog.innerHTML = `<h2 id="ml-run-title" class="cv-h2">${esc(title)}</h2><p class="pc-fine">Keep this window open.</p>
		<ol class="ml-stages">${steps.map(([k, label]) => `<li class="is-todo" data-step="${k}"><span class="dot" aria-hidden="true"></span><span>${esc(label)} <small></small></span></li>`).join('')}</ol>
		<div id="ml-run-extra"></div>`;
	dialog.addEventListener('cancel', (e) => {
		if (state.running) e.preventDefault();
	});
	document.body.appendChild(dialog);
	dialog.showModal();
	const step = (key, st, note = '') => {
		const li = $(`[data-step="${key}"]`, dialog);
		if (!li) return;
		li.className = st === 'done' ? 'is-done' : st === 'active' ? 'is-live' : st === 'error' ? 'is-failed' : 'is-todo';
		li.querySelector('small').textContent = note;
	};
	const fail = (err) => {
		$('#ml-run-extra', dialog).innerHTML = `<p class="pc-status is-error" role="alert">${esc(friendlyLaunchError(err))}</p><div class="pc-dialog-actions"><button type="button" class="pc-btn" id="ml-run-close">Close</button></div>`;
		$('#ml-run-close', dialog).addEventListener('click', () => {
			dialog.close();
			dialog.remove();
		});
		$('#ml-run-close', dialog).focus();
	};
	const done = () => {
		dialog.close();
		dialog.remove();
	};
	return { step, fail, done };
}

async function launch() {
	if (!(await ensureRiskAck({ context: 'multichain-launch' }))) return;
	state.running = true;
	paintSummary();
	try {
		if (isSolana()) await runSolana();
		else if (state.signer === 'agent') await runEvmAgent();
		else await runEvmWallet();
	} finally {
		state.running = false;
		if (!state.record && !state.result) paintSummary();
	}
}

async function dataUrlFor(subject) {
	const custom = state.form.image.trim();
	const res = await fetch(`${API}/logo?subject=${encodeURIComponent(subject.id)}${custom ? `&url=${encodeURIComponent(custom)}` : ''}`, { credentials: 'include' });
	if (!res.ok) return null;
	const blob = await res.blob();
	return new Promise((resolve) => {
		const r = new FileReader();
		r.onload = () => resolve(r.result);
		r.onerror = () => resolve(null);
		r.readAsDataURL(blob);
	});
}

async function pumpApi(path, body) {
	const res = await fetch(path, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
	const data = await res.json().catch(() => ({}));
	if (!res.ok) throw Object.assign(new Error(data?.error_description || data?.error || `Request failed (${res.status})`), { code: data?.error, status: res.status });
	return data;
}

async function runSolana() {
	const subject = state.subjectRow;
	const f = state.form;
	const agent = agentById(state.signerAgentId);
	const wallet = state.signer === 'wallet';
	const steps = [['metadata', 'Coin metadata'], ...(wallet ? [['prepare', 'Build the transaction'], ['sign', 'Approve in your wallet'], ['confirm', 'Confirm on Solana']] : [['launch', `${agent?.name || 'Agent'} signs and sends`]]), ['link', 'Link to the showcase']];
	const ui = progressDialog(`Launching $${normalizeSymbol(f.symbol)} on pump.fun`, steps);
	let current = 'metadata';
	try {
		ui.step('metadata', 'active');
		const image = await dataUrlFor(subject);
		const meta = await pumpApi('/api/pump/build-metadata', {
			name: f.name.trim(), symbol: normalizeSymbol(f.symbol), description: f.description.trim() || subject.title,
			agent_id: agent.id, website: f.website.trim() || subject.url,
			...(f.twitter.trim() ? { twitter: f.twitter.trim() } : {}), ...(f.telegram.trim() ? { telegram: f.telegram.trim() } : {}),
			...(image ? { image_data_url: image } : {}),
		});
		ui.step('metadata', 'done', meta.on_ipfs ? 'Pinned to IPFS' : 'Stored on three.ws');
		const buy = Number(f.openingBuy) > 0 ? Number(f.openingBuy) : 0;
		const coin = { agent_id: agent.id, name: f.name.trim(), symbol: normalizeSymbol(f.symbol), uri: meta.metadata_url, coin_type: 'regular', holder_reward: false, network: 'mainnet', quote_currency: 'sol', sol_buy_in: buy };
		let mint;
		let signature;
		if (wallet) {
			current = 'prepare';
			ui.step('prepare', 'active');
			const prep = await pumpApi('/api/pump/launch-prep', { ...coin, wallet_address: state.sol.address, v1_capable: !!state.sol.v1 });
			ui.step('prepare', 'done');
			current = 'sign';
			ui.step('sign', 'active', 'Check your wallet');
			signature = await signAndBroadcast({ txBase64: prep.tx_base64, version: prep.transaction_version, address: state.sol.address });
			ui.step('sign', 'done');
			current = 'confirm';
			ui.step('confirm', 'active');
			if (!(await waitForConfirmation(signature))) throw new Error(`Solana has not confirmed the launch yet. It may still land: https://solscan.io/tx/${signature}`);
			let recorded = null;
			for (let i = 0; i < 5 && !recorded; i++) {
				try {
					recorded = await pumpApi('/api/pump/launch-confirm', { prep_id: prep.prep_id, tx_signature: signature });
				} catch (err) {
					if (err.code !== 'tx_not_found' || i === 4) throw err;
					await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
				}
			}
			mint = recorded?.pump_agent_mint?.mint || prep.mint;
			ui.step('confirm', 'done');
		} else {
			current = 'launch';
			ui.step('launch', 'active', 'Signing, sending and confirming');
			const out = await pumpApi('/api/pump/launch-agent', coin);
			mint = out.mint;
			signature = out.signature;
			ui.step('launch', 'done');
		}
		current = 'link';
		ui.step('link', 'active');
		const linked = await post(`${API}/solana-link`, { subject_id: subject.id, mint, signer: state.signer });
		ui.step('link', 'done');
		ui.done();
		state.result = { chain: 'solana', venue: 'pump', token: mint, symbol: linked.coin?.symbol || coin.symbol, name: coin.name, tx_hash: signature, subject: linked, urls: { venue: `https://pump.fun/coin/${mint}`, explorer: `https://solscan.io/tx/${signature}`, showcase: subject.url } };
		render();
	} catch (err) {
		ui.step(current, 'error');
		ui.fail(err);
	}
}

/** One key per distinct launch body: a retry reuses it, an edit gets a new one. */
function attemptFor(bodyJson) {
	if (!state.attempt || state.attempt.bodyJson !== bodyJson) state.attempt = { key: crypto.randomUUID(), bodyJson };
	return state.attempt;
}

async function runEvmAgent() {
	const subject = state.subjectRow;
	const body = coinBody(subject);
	const steps = [...(state.venue === 'four_meme' ? [['fourmeme', 'Get four.meme\'s signed launch']] : []), ['send', 'Agent signs and sends']];
	const ui = progressDialog(`Launching $${body.symbol} on ${venueInfo().label}`, steps);
	let current = steps[0][0];
	try {
		if (state.venue === 'four_meme') {
			ui.step('fourmeme', 'active', 'Signing in as the agent wallet');
			body.four_meme = await fourMemeCreateArg({
				address: state.quote.wallet.address,
				subject,
				sign: async (message) => (await post(`${API}/four-meme-sign`, { agent_id: state.signerAgentId, message })).signature,
			});
			ui.step('fourmeme', 'done');
		}
		current = 'send';
		ui.step('send', 'active');
		const bodyJson = JSON.stringify(body);
		const attempt = attemptFor(state.venue === 'four_meme' ? JSON.stringify({ ...body, four_meme: undefined }) : bodyJson);
		const data = await getJson(`${API}/launch`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', 'idempotency-key': attempt.key }, body: bodyJson });
		ui.step('send', 'done');
		ui.done();
		state.record = data.launch;
		render();
		follow();
	} catch (err) {
		if (err.status === 409 || err.code === 'idempotency_key_reused') state.attempt = null;
		ui.step(current, 'error');
		ui.fail(err);
	}
}

async function runEvmWallet() {
	const subject = state.subjectRow;
	const body = coinBody(subject);
	const label = venueInfo().label;
	const steps = [['prove', 'Prove this wallet is yours'], ...(state.venue === 'four_meme' ? [['fourmeme', 'Get four.meme\'s signed launch']] : []), ['prepare', 'Build the transaction'], ['sign', 'Approve in your wallet'], ['confirm', 'Confirm and list']];
	const ui = progressDialog(`Launching $${body.symbol} on ${label}`, steps);
	let current = 'prove';
	try {
		ui.step('prove', 'active', 'Check your wallet');
		await ensureEvmChain();
		body.ownership_signature = await personalSign(state.quote.ownership_message, state.evm.address);
		ui.step('prove', 'done');
		if (state.venue === 'four_meme') {
			current = 'fourmeme';
			ui.step('fourmeme', 'active', 'Approve the four.meme sign-in');
			body.four_meme = await fourMemeCreateArg({ address: state.evm.address, subject, sign: (message) => personalSign(message, state.evm.address) });
			ui.step('fourmeme', 'done');
		}
		current = 'prepare';
		ui.step('prepare', 'active', state.venue === 'flap' ? 'Pinning metadata and grinding the token address' : 'Simulating');
		const prep = await post(`${API}/prepare`, body);
		ui.step('prepare', 'done');
		current = 'sign';
		ui.step('sign', 'active', 'Check your wallet');
		const txHash = await ethProvider().request({ method: 'eth_sendTransaction', params: [{ from: state.evm.address, to: prep.tx.to, data: prep.tx.data, value: prep.tx.value, gas: prep.tx.gas }] });
		ui.step('sign', 'done', short(txHash));
		current = 'confirm';
		ui.step('confirm', 'active', 'Waiting for the block');
		let result = null;
		for (let i = 0; i < 30 && !result; i++) {
			try {
				result = await post(`${API}/confirm`, { subject_id: subject.id, tx_hash: txHash });
			} catch (err) {
				if (err.code !== 'tx_not_found' && err.status !== 404) throw err;
				await new Promise((r) => setTimeout(r, 3000));
			}
		}
		if (!result) throw new Error(`The transaction has not been mined yet. It is ${txHash}; reopen your launch from “Your launches” to confirm it.`);
		ui.step('confirm', 'done');
		ui.done();
		state.result = result;
		render();
	} catch (err) {
		ui.step(current, 'error');
		ui.fail(err);
	}
}

let pollTimer = null;
async function follow() {
	clearTimeout(pollTimer);
	const rec = state.record;
	if (!rec || rec.status === 'finalized' || rec.status === 'failed') return;
	try {
		state.record = await getJson(`/api/launches/${encodeURIComponent(rec.id)}`);
	} catch {
		/* keep the last known state; the next tick retries */
	}
	render();
	pollTimer = setTimeout(follow, 3000);
}

function stageList(rec) {
	const seen = new Set((rec.stages || []).map((s) => s.stage));
	const failed = rec.status === 'failed';
	const firstTodo = STAGES.findIndex(([id]) => !seen.has(id));
	return `<ol class="ml-stages" aria-label="Launch progress">${STAGES.map(([id, label], i) => {
		const cls = seen.has(id) ? 'is-done' : i === firstTodo ? (failed ? 'is-failed' : 'is-live') : 'is-todo';
		return `<li class="${cls}"><span class="dot" aria-hidden="true"></span>${esc(label)}</li>`;
	}).join('')}</ol>`;
}

function successCard(r) {
	const chainName = chainInfo(r.chain)?.name || r.chain;
	return `
	<section class="pc-panel" style="max-width:720px">
		<p class="cv-sub" style="margin:0">Live on ${esc(chainName)}</p>
		<h2 class="cv-h2" style="font-size:1.5rem">$${esc(r.symbol)} is trading</h2>
		<p style="margin:0;color:var(--cv-text-2)">${esc(r.name)} is listed on three.ws with its showcase page, linked to what it is about.</p>
		<code>${esc(r.token)}</code>
		<div class="pc-hero-actions">
			<a class="pc-btn pc-btn-primary" href="${esc(r.urls.showcase || `/l/${state.subjectRow?.id}`)}">Showcase page</a>
			<a class="pc-btn" href="${esc(r.urls.venue)}" target="_blank" rel="noopener noreferrer">${esc(r.venue === 'pump' ? 'pump.fun' : r.venue === 'flap' ? 'flap.sh' : 'four.meme')} ↗</a>
			<a class="pc-btn" href="${esc(r.urls.explorer)}" target="_blank" rel="noopener noreferrer">Transaction ↗</a>
			<button type="button" class="pc-btn" id="ml-again">Launch another</button>
		</div>
	</section>`;
}

function trackerCard() {
	if (state.result) return successCard(state.result);
	const rec = state.record;
	if (rec.status === 'finalized') return `${successCard(rec.result)}<section class="pc-panel" style="max-width:720px;margin-top:1rem">${stageList(rec)}</section>`;
	if (rec.status === 'failed') {
		return `
		<section class="pc-panel" style="max-width:720px">
			<h2 class="cv-h2">The launch did not go through</h2>
			<p class="pc-status is-error" role="alert">${esc(rec.error?.message || 'The launch failed.')}</p>
			${stageList(rec)}
			<div class="pc-hero-actions"><button type="button" class="pc-btn pc-btn-primary" id="ml-back">Back to the form</button></div>
		</section>`;
	}
	return `
	<section class="pc-panel" style="max-width:720px">
		<h2 class="cv-h2">Launching…</h2>
		<p class="pc-fine">You can leave this page. The launch continues and is saved under <code>${esc(rec.id)}</code>.</p>
		${stageList(rec)}
		${rec.tx_hash ? `<code title="${esc(rec.tx_hash)}">${esc(short(rec.tx_hash))}</code>` : ''}
	</section>`;
}

function wireTracker() {
	const reset = () => {
		state.record = null;
		state.result = null;
		state.attempt = null;
		state.quote = null;
		state.subjectRow = null;
		state.subjectKey = '';
		previewKey = '';
		render();
		loadMine();
	};
	$('#ml-again')?.addEventListener('click', () => {
		Object.assign(state.form, { symbolTouched: false, description: '', openingBuy: '' });
		state.form.name = suggestedName();
		state.form.symbol = normalizeSymbol(state.form.name);
		reset();
	});
	$('#ml-back')?.addEventListener('click', reset);
}

boot();
