/**
 * Rich agent detail page.
 *
 * Loads via /api/agents/:id (UUID) and /api/avatars/:id for the image.
 * Falls back to a 404 view when the id is unknown or fetch fails.
 *
 * Owner-private fields (chain_id, wallet_address, erc8004_*) only appear when
 * the requester is the agent's owner — render() tolerates them being absent.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SERVICE_TYPES = {
	web: { tag: 'WEB' },
	a2a: { tag: 'A2A' },
	mcp: { tag: 'MCP' },
	token: { tag: 'TOKEN' },
	dbc: { tag: 'DBC' },
	chart: { tag: 'CHART' },
};

const TRUST_ACCENT = {
	reputation: 'amber',
	'crypto-economic': 'violet',
	tee: 'green',
};

const GRADIENTS = [
	['#7c3aed', '#4f46e5'],
	['#0ea5e9', '#6366f1'],
	['#10b981', '#0ea5e9'],
	['#f59e0b', '#ef4444'],
	['#ec4899', '#8b5cf6'],
	['#14b8a6', '#3b82f6'],
];

function avatarDataUri(name) {
	const [c1, c2] = GRADIENTS[(name?.charCodeAt(0) || 0) % GRADIENTS.length];
	const letter = (name || '?')[0].toUpperCase();
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="168" height="168" viewBox="0 0 168 168"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="168" height="168" rx="24" fill="url(#g)"/><text x="50%" y="55%" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="80" font-weight="600" fill="white">${letter}</text></svg>`;
	return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function shortAddr(s, head = 4, tail = 4) {
	if (!s) return '—';
	const str = String(s);
	if (str.length <= head + tail + 1) return str;
	return `${str.slice(0, head)}…${str.slice(-tail)}`;
}

function el(tag, props = {}, children = []) {
	const node = document.createElement(tag);
	for (const [k, v] of Object.entries(props)) {
		if (v == null || v === false) continue;
		if (k === 'class') node.className = v;
		else if (k === 'text') node.textContent = v;
		else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
		else node.setAttribute(k, v);
	}
	for (const c of [].concat(children || [])) {
		if (c == null) continue;
		node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
	}
	return node;
}

function pill(text, accent = '') {
	return el('span', { class: `ad-pill ${accent ? `ad-pill-${accent}` : ''}`, text });
}

function renderService(svc) {
	const meta = SERVICE_TYPES[svc.type] || { tag: (svc.type || '').toUpperCase() };
	const head = el('div', { class: 'ad-svc-head' }, [
		el('span', { class: 'ad-svc-tag', text: meta.tag }),
		svc.version ? el('span', { class: 'ad-svc-version', text: svc.version }) : null,
		svc.label ? el('span', { class: 'ad-svc-version', text: svc.label }) : null,
	]);

	const card = el('div', { class: 'ad-svc' }, [head]);

	if (svc.url) {
		card.appendChild(
			el('div', { class: 'ad-svc-link' }, [
				el('span', { text: '🔗' }),
				el('span', { text: svc.url }),
				el('button', {
					class: 'ad-copy',
					'aria-label': 'Copy',
					onclick: () => navigator.clipboard?.writeText(svc.url),
				}, '⧉'),
			]),
		);
	}

	const metaItems = [];
	if (svc.skills?.length) {
		metaItems.push(el('span', { class: 'ad-svc-meta-label', text: 'SKILLS' }));
		svc.skills.forEach((s) => metaItems.push(el('span', { class: 'ad-chip', text: s })));
	}
	if (svc.domains?.length) {
		metaItems.push(el('span', { class: 'ad-svc-meta-label', text: 'DOMAINS' }));
		svc.domains.forEach((s) => metaItems.push(el('span', { class: 'ad-chip', text: s })));
	}
	if (metaItems.length) card.appendChild(el('div', { class: 'ad-svc-meta' }, metaItems));

	return card;
}

function render(agent) {
	document.title = `${agent.name} — three.ws`;

	const $ = (id) => document.getElementById(id);

	$('ad-avatar').src = agent.avatar || avatarDataUri(agent.name);
	$('ad-avatar').alt = agent.name;
	$('ad-avatar').onerror = () => { $('ad-avatar').src = avatarDataUri(agent.name); };
	$('ad-name').textContent = agent.name;

	const status = $('ad-status');
	status.textContent = agent.active ? 'Active' : 'Inactive';
	status.classList.toggle('ad-status-inactive', !agent.active);

	$('ad-id-short').textContent = shortAddr(agent.id);
	$('ad-id-short').dataset.full = agent.id;
	$('ad-asset-kind').textContent = agent.assetKind || 'Core Asset';
	$('ad-desc').textContent = agent.description || '';

	const trustPills = $('ad-trust-pills');
	trustPills.innerHTML = '';
	(agent.trust || []).forEach((t) =>
		trustPills.appendChild(pill(t, TRUST_ACCENT[t.toLowerCase()] || '')),
	);

	const services = $('ad-services');
	services.innerHTML = '';
	(agent.services || []).forEach((s) => services.appendChild(renderService(s)));
	$('ad-svc-count').textContent = `${agent.services?.length || 0} configured`;
	$('ad-svc-count2').textContent = String(agent.services?.length || 0);

	$('ad-holdings-addr').textContent = shortAddr(agent.wallet);
	$('ad-holdings-addr').dataset.full = agent.wallet;
	$('ad-holdings-sol').textContent = String(agent.solBalance ?? 0);

	if (agent.token) {
		$('ad-token-body').classList.remove('ad-muted');
		$('ad-token-body').textContent = '';
		$('ad-token-body').appendChild(
			el('div', { class: 'ad-row ad-row-split' }, [
				el('span', { text: agent.token.symbol || 'TOKEN' }),
				el('span', { class: 'ad-mono', text: shortAddr(agent.token.mint) }),
			]),
		);
	}

	$('ad-rewards').textContent = String(agent.creatorRewards ?? 0);

	const mechs = $('ad-trust-mechs');
	mechs.innerHTML = '';
	(agent.trust || []).forEach((t) =>
		mechs.appendChild(pill(t, TRUST_ACCENT[t.toLowerCase()] || '')),
	);

	const pay = $('ad-payment');
	pay.innerHTML = '';
	pay.appendChild(pill(agent.x402 ? 'x402 Supported' : 'x402 Not Supported', agent.x402 ? 'green' : ''));

	$('ad-agent-id').textContent = shortAddr(agent.id);
	const regs = $('ad-registries');
	regs.innerHTML = '';
	(agent.registries || []).forEach((r) => regs.appendChild(pill(r)));

	$('ad-raw').textContent = JSON.stringify(agent.rawMetadata || agent, null, 2);

	const onchain = $('ad-onchain');
	onchain.innerHTML = '';
	[
		['Agent UUID', shortAddr(agent.id)],
		['Agent Wallet', shortAddr(agent.wallet)],
		['Owner', shortAddr(agent.owner)],
		['Authority', shortAddr(agent.authority)],
	].forEach(([k, v]) => {
		onchain.appendChild(
			el('div', { class: 'ad-row ad-row-split' }, [
				el('span', { class: 'ad-muted', text: k }),
				el('span', { class: 'ad-mono', text: v }),
			]),
		);
	});

	$('ad-active').textContent = agent.active ? 'true' : 'false';
	$('ad-x402').textContent = agent.x402 ? 'Yes' : 'No';

	const supportedTrust = $('ad-supported-trust');
	supportedTrust.innerHTML = '';
	(agent.trust || []).forEach((t) =>
		supportedTrust.appendChild(pill(t, TRUST_ACCENT[t.toLowerCase()] || '')),
	);

	const protos = $('ad-protocols');
	protos.innerHTML = '';
	(agent.protocols || []).forEach((p) => protos.appendChild(pill(p)));

	if (agent.explorerUrl && agent.explorerUrl !== '#') $('ad-explorer').href = agent.explorerUrl;
	else $('ad-explorer').style.display = 'none';
	if (agent.tradeUrl && agent.tradeUrl !== '#') $('ad-trade').href = agent.tradeUrl;
	else $('ad-trade').style.display = 'none';
}

function renderNotFound(id, reason) {
	document.title = 'Agent not found — three.ws';
	const main = document.querySelector('.ad-main');
	main.innerHTML = `
		<div class="ad-banner"><span>S1 Powered by Torque · $250K rewards</span></div>
		<div style="padding:60px 24px;text-align:center;">
			<h1 style="margin:0 0 8px;font-size:22px;font-weight:600;">Agent not found</h1>
			<p style="color:rgba(231,233,238,0.55);font-size:14px;margin:0 0 22px;">
				${reason || 'No agent registered with id'} <code style="font-family:ui-monospace,monospace;color:#e7e9ee;">${id || '(none)'}</code>.
			</p>
			<a class="ad-cta" style="display:inline-block;padding:10px 22px;" href="/agents">← Back to Registry</a>
		</div>
	`;
}

document.addEventListener('click', (e) => {
	const btn = e.target.closest('.ad-copy[data-copy-target]');
	if (!btn) return;
	const id = btn.getAttribute('data-copy-target');
	const node = document.getElementById(id);
	const value = node?.dataset?.full || node?.textContent || '';
	if (value && value !== '—') navigator.clipboard?.writeText(value);
});

async function fetchJson(url) {
	const res = await fetch(url, { credentials: 'include' });
	if (!res.ok) {
		const err = new Error(`${url} → HTTP ${res.status}`);
		err.status = res.status;
		throw err;
	}
	return res.json();
}

/**
 * Inflate the /api/agents/:id record into the detail-page shape.
 * `meta.onchain`, `rec.token`, and `rec.payments` are surfaced when present.
 */
function normalize(rec, avatar) {
	const meta = rec.meta || {};
	const onchain = rec.onchain || meta.onchain || {};

	const trust = [];
	if (rec.payments || rec.is_registered) trust.push('Reputation');
	if (rec.token) trust.push('Crypto-Economic');

	const services = [];
	if (rec.home_url) {
		services.push({
			type: 'web',
			url: new URL(rec.home_url, location.origin).href,
		});
	}
	if (rec.skills?.length) {
		services.push({
			type: 'a2a',
			version: meta.a2a_version || '0.3.0',
			url: `${location.origin}/agent/${rec.id}`,
			skills: rec.skills.map((s) => (typeof s === 'string' ? s : s.name || s.id)).filter(Boolean),
			domains: meta.domains || undefined,
		});
	}
	if (rec.token?.mint) {
		services.push({
			type: 'token',
			label: rec.token.symbol || rec.token.name,
			url: `https://birdeye.so/token/${rec.token.mint}?chain=solana`,
		});
		services.push({
			type: 'chart',
			url: `https://dexscreener.com/solana/${rec.token.mint}`,
		});
	}

	const protocols = [];
	if (rec.home_url) protocols.push('WEB');
	if (rec.skills?.length) protocols.push(`A2A ${meta.a2a_version || '0.3.0'}`);
	if (rec.token?.symbol) protocols.push(`TOKEN ${rec.token.symbol}`);
	if (onchain?.chain_id || rec.chain_id) protocols.push(`CHAIN ${onchain?.chain_id ?? rec.chain_id}`);

	const wallet = rec.wallet_address || onchain.wallet || meta.solana_wallet || '';

	const explorerUrl =
		(rec.token?.mint && `https://solscan.io/token/${rec.token.mint}`) ||
		(wallet && `https://solscan.io/account/${wallet}`) ||
		'#';

	const registries = [];
	if (rec.erc8004_registry) {
		registries.push(`ERC-8004 #${rec.erc8004_agent_id ?? '?'}`);
	}
	if (rec.is_registered) registries.push('three.ws');

	return {
		id: rec.id,
		name: rec.name || 'Unnamed agent',
		assetKind: rec.is_registered ? 'Core Asset' : 'Off-chain',
		active: !!rec.is_registered,
		avatar: avatar?.image_url || avatar?.thumbnail_url || avatar?.preview_url || null,
		description: rec.description || '',
		trust,
		wallet,
		owner: rec.user_id || onchain.owner || '',
		authority: onchain.authority || rec.erc8004_registry || '',
		solBalance: meta.sol_balance ?? 0,
		creatorRewards: meta.creator_rewards ?? 0,
		x402: !!(rec.payments?.accepted_tokens?.length),
		registries,
		protocols,
		explorerUrl,
		tradeUrl: rec.token?.mint ? `https://magiceden.io/marketplace/${rec.token.mint}` : '#',
		token: rec.token || null,
		services,
		rawMetadata: rec,
	};
}

async function loadAgent(id) {
	if (!id) return { error: 'missing id', agent: null };
	if (!UUID_RE.test(id)) return { error: 'invalid id (expected UUID)', agent: null };

	let rec;
	try {
		const json = await fetchJson(`/api/agents/${encodeURIComponent(id)}`);
		rec = json.agent;
	} catch (e) {
		return { error: e.status === 404 ? 'No agent with id' : `Fetch failed: ${e.message}`, agent: null };
	}
	if (!rec) return { error: 'No agent with id', agent: null };

	let avatar = null;
	if (rec.avatar_id) {
		try {
			const json = await fetchJson(`/api/avatars/${encodeURIComponent(rec.avatar_id)}`);
			avatar = json.avatar || null;
		} catch (e) {
			console.warn('[agent-detail] avatar fetch failed:', e.message);
		}
	}

	return { agent: normalize(rec, avatar), error: null };
}

const id = new URLSearchParams(location.search).get('id') || location.pathname.match(/\/agents\/([^/]+)/)?.[1];
loadAgent(id)
	.then(({ agent, error }) => {
		if (!agent) return renderNotFound(id, error);
		render(agent);
	})
	.catch((e) => {
		console.error('[agent-detail] load failed', e);
		renderNotFound(id, 'Unexpected error loading');
	});
