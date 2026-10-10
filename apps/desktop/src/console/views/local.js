// Local agents: agents that run on this machine, with signing keys in the OS
// keychain. Paper agents trade real launch data with simulated fills. Live
// agents sign with the local key, and every live action waits in the approval
// list until the owner reviews it in a native dialog that shows recipient,
// amount, asset, chain and the payload hash.
//
// This view can create, pause, resume, kill and deny. It cannot approve: the
// Review button asks the main process to open the native dialog, which is built
// from the stored approval and never from anything this window sends.

import { html, raw, mount, onAction, emptyState, errorState, skeletonLines } from '../lib/dom.js';
import { relativeTime, shortAddress } from '../../shared/normalize.js';

const STATUS = {
	idle: ['chip', 'Idle'],
	working: ['chip chip-info', 'Working'],
	waiting_approval: ['chip chip-warn', 'Needs approval'],
	paused: ['chip', 'Paused'],
	error: ['chip chip-bad', 'Error'],
	killed: ['chip', 'Killed'],
};

const chip = (status) => {
	const [cls, label] = STATUS[status] || STATUS.idle;
	return html`<span class="${cls}">${label}</span>`;
};

export function mountLocal(root, ctx) {
	const { bridge, toast } = ctx;
	let phase = 'loading';
	let error = null;
	let data = { agents: [], face: null, keychain: false };
	let approvals = [];
	let receipts = [];
	let busy = null;

	async function load() {
		try {
			[data, approvals, receipts] = await Promise.all([bridge.runtime.list(), bridge.runtime.approvals({ status: 'pending' }), bridge.runtime.receipts({})]);
			phase = 'ready';
		} catch (err) {
			error = err;
			phase = 'error';
		}
		render();
	}

	function createForm() {
		return html`<form class="card" id="new-local" style="margin-bottom:16px">
			<div class="row">
				<div class="field"><label for="l-name">Name</label><input class="input" id="l-name" maxlength="60" placeholder="Launch scout" required /></div>
				<div class="field"><label for="l-mode">Mode</label>
					<select class="input" id="l-mode"><option value="paper">Paper (simulated fills)</option><option value="live" ${data.keychain ? '' : raw('disabled')}>Live (signs with this machine)</option></select></div>
				<div class="field"><label for="l-net">Network</label>
					<select class="input" id="l-net"><option value="mainnet">Mainnet</option><option value="devnet">Devnet</option></select></div>
			</div>
			<div class="row" style="margin-top:10px">
				<div class="field"><label for="l-size">Buy size (SOL)</label><input class="input" id="l-size" type="number" min="0.0001" step="0.01" value="0.05" /></div>
				<div class="field"><label for="l-tp">Take profit (%)</label><input class="input" id="l-tp" type="number" min="1" value="100" /></div>
				<div class="field"><label for="l-sl">Stop loss (%)</label><input class="input" id="l-sl" type="number" min="1" max="99" value="40" /></div>
				<div class="field"><label for="l-age">Max launch age (min)</label><input class="input" id="l-age" type="number" min="1" value="60" /></div>
			</div>
			<div class="row" style="margin-top:10px">
				<div class="field"><label for="l-ask">Live buys</label>
					<select class="input" id="l-ask"><option value="ask">Ask me first (recommended)</option><option value="auto">Buy within caps automatically</option></select></div>
				<button type="submit" class="btn btn-primary" ${busy === 'create' ? raw('disabled') : ''}>${busy === 'create' ? raw('<span class="spin" aria-hidden="true"></span>Creating') : 'Create local agent'}</button>
			</div>
		</form>`;
	}

	function agentCard(a) {
		const pending = approvals.filter((ap) => ap.agent_id === a.id);
		return html`<article class="card agent-card" data-agent="${a.id}">
			<div class="agent-top">
				<div class="meta">
					<h3 title="${a.name}">${a.name}</h3>
					<div class="sub">${chip(a.status)}<span class="chip">${a.mode === 'paper' ? 'Paper' : 'Live'}</span><span class="mono" title="${a.address}">${shortAddress(a.address)}</span></div>
				</div>
			</div>
			<p class="agent-desc">${a.detail || `${a.open_positions} open position${a.open_positions === 1 ? '' : 's'} on ${a.network}. Buys ${a.strategy.sizing.amount_sol} SOL per launch, take profit ${a.strategy.exits.take_profit_pct ?? 'off'}%, stop loss ${a.strategy.exits.stop_loss_pct}%.`}</p>
			${pending.map((ap) => html`<div class="banner" style="margin:8px 0"><div>${ap.text.split('\n').map((l) => html`<div>${l}</div>`)}<div class="mono" style="font-size:11px;color:var(--dim)">hash ${ap.hash.slice(0, 16)}...</div></div>
				<button type="button" class="btn btn-sm btn-primary" data-action="review" data-id="${ap.id}">Review</button>
				<button type="button" class="btn btn-sm" data-action="deny" data-id="${ap.id}">Deny</button></div>`)}
			<div class="agent-actions">
				${a.status === 'paused'
					? html`<button type="button" class="btn btn-sm btn-primary" data-action="resume" data-id="${a.id}">Resume</button>`
					: html`<button type="button" class="btn btn-sm" data-action="pause" data-id="${a.id}" ${a.status === 'killed' ? raw('disabled') : ''}>Pause</button>`}
				<button type="button" class="btn btn-sm btn-danger" data-action="kill" data-id="${a.id}" ${a.status === 'killed' ? raw('disabled') : ''}>Kill</button>
				${a.status === 'killed' ? html`<button type="button" class="btn btn-sm btn-ghost" data-action="remove" data-id="${a.id}">Remove</button>` : ''}
			</div>
			<div class="sub" style="font-size:11.5px;color:var(--dim)">${a.last_sweep_at ? `Last checked ${relativeTime(new Date(a.last_sweep_at).toISOString())}` : 'Not checked yet'}</div>
		</article>`;
	}

	function receiptTable() {
		if (!receipts.length) return emptyState({ icon: 'runs', title: 'No receipts yet', message: 'Every fill, simulated or signed, is recorded here with the approval hash it ran under.' });
		return html`<div class="card"><table class="table"><thead><tr><th>When</th><th>Action</th><th>Coin</th><th>SOL</th><th>Mode</th><th>Proof</th></tr></thead><tbody>
			${receipts.slice(0, 50).map((r) => html`<tr>
				<td>${relativeTime(new Date(r.at).toISOString())}</td>
				<td>${r.kind}${r.reason ? ` (${r.reason})` : ''}</td>
				<td>${r.symbol ? `$${r.symbol}` : shortAddress(r.mint)}</td>
				<td>${Number(r.sol).toFixed(4)}</td>
				<td>${r.mode}</td>
				<td class="mono">${r.signature ? shortAddress(r.signature) : r.payload_hash ? r.payload_hash.slice(0, 10) : 'paper'}</td>
			</tr>`)}</tbody></table></div>`;
	}

	function body() {
		if (phase === 'loading') return html`<div class="split"><div>${skeletonLines(5)}</div><div class="sk sk-block"></div></div>`;
		if (phase === 'error') return errorState(error, { title: 'Local agents could not load' });
		return html`
			${data.keychain ? '' : html`<div class="banner bad"><span class="ico ico-alert" aria-hidden="true"></span><div>The OS keychain is not available on this machine, so live agents are disabled and new keys would sit in a file readable only by you. Paper agents work normally. On Linux, install a keyring (gnome-keyring or kwallet) and restart.</div></div>`}
			${createForm()}
			${data.agents.length
				? html`<div class="grid">${data.agents.map(agentCard)}</div>`
				: emptyState({ icon: 'agents', title: 'No local agents yet', message: 'Create a paper agent above to watch a strategy trade real launches with simulated fills. Nothing is signed and no funds move.' })}
			<h2 style="margin-top:20px">Receipts</h2>
			${receiptTable()}`;
	}

	function render() {
		mount(root, html`<div class="view">
			<header class="head">
				<div><h1>Local agents</h1><p>Run agents on this machine. Keys stay in your keychain and nothing is signed without your yes.</p></div>
				<div class="head-actions"><button type="button" class="btn" data-action="tick" ${busy === 'tick' ? raw('disabled') : ''}>Check launches now</button></div>
			</header>
			${body()}
		</div>`);
	}

	async function run(key, fn, success) {
		busy = key;
		render();
		try {
			await fn();
			if (success) toast(success);
		} catch (err) {
			toast(err.message, 'bad');
		}
		busy = null;
		await load();
	}

	const off = onAction(root, {
		retry: load,
		tick: () => run('tick', () => bridge.runtime.tick()),
		pause: (el) => run('pause', () => bridge.runtime.pause(el.dataset.id)),
		resume: (el) => run('resume', () => bridge.runtime.resume(el.dataset.id)),
		kill: (el) => run('kill', () => bridge.runtime.kill(el.dataset.id), 'Agent killed'),
		remove: (el) => run('remove', () => bridge.runtime.remove(el.dataset.id), 'Agent removed'),
		deny: (el) => run('deny', () => bridge.runtime.deny(el.dataset.id), 'Denied'),
		review: (el) => run('review', async () => {
			const res = await bridge.runtime.review(el.dataset.id);
			if (res.status === 'executed') toast('Approved and executed');
			else if (res.status === 'denied') toast('Denied');
		}),
	});

	const onSubmit = (event) => {
		if (event.target.id !== 'new-local') return;
		event.preventDefault();
		const num = (id) => Number(root.querySelector(id).value);
		const input = {
			name: root.querySelector('#l-name').value,
			mode: root.querySelector('#l-mode').value,
			network: root.querySelector('#l-net').value,
			strategy: {
				mode: root.querySelector('#l-ask').value,
				entry: { max_age_minutes: num('#l-age') },
				sizing: { amount_sol: num('#l-size') },
				exits: { take_profit_pct: num('#l-tp'), stop_loss_pct: num('#l-sl') },
			},
		};
		run('create', () => bridge.runtime.create(input), 'Local agent created');
	};
	root.addEventListener('submit', onSubmit);
	const offEvents = bridge.runtime.onEvent(() => load());

	load();
	return () => {
		off();
		offEvents();
		root.removeEventListener('submit', onSubmit);
	};
}
