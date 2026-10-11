// Account linking panels for /dashboard/account: linked devices (link codes)
// and payout wallets proved by a signed message.
//
//   Linked devices   mint a one-time code for a phone, desktop app, CLI or
//                    Telegram chat; confirm or reject what a device claimed
//                    (the request shows exactly what will be linked before the
//                    signed-in session confirms it); list every linked device
//                    with last use; one-click revoke, which kills the
//                    credential behind it. api/auth/link-codes/[action].js.
//   Payout wallets   attach a Solana or EVM wallet as the payout wallet for the
//                    account or one agent by signing a server-issued message.
//                    Replacing a live wallet needs step-up (password) and
//                    lands after a cooldown; the row shows which state it is
//                    in. api/auth/external-wallet/[action].js.

import { get, post, esc, relTime } from '../api.js';
import { errorStateHTML } from '../../shared/state-kit.js';
import { toast } from '../../shared/toast.js';
import { withPayoutStepUp, cooldownNotice } from '../../payout-step-up.js';

const POLL_MS = 3000;

function truncMid(s, head = 6, tail = 4) {
	const str = String(s || '');
	return str.length <= head + tail + 1 ? str : `${str.slice(0, head)}…${str.slice(-tail)}`;
}

function btn(label, { kind = '', action, attrs = '' } = {}) {
	return `<button class="dn-btn ${kind}" type="button" data-action="${action}" ${attrs} style="padding:5px 10px;font-size:12px">${label}</button>`;
}

const KIND_ICON = { phone: '📱', desktop: '🖥', cli: '⌨', telegram: '✈' };

const KIND_HINT = {
	phone: 'Open three.ws/link-device on the phone and type the code. The phone gets a session of its own.',
	desktop: 'Enter the code in the desktop app, or on three.ws/link-device on that machine. It gets an API key you can narrow before confirming.',
	cli: 'Run the command below in the terminal to link it. It gets an API key you can narrow before confirming.',
	telegram: 'Send the command below to the three.ws bot from the chat you want linked. Replies in that chat then come from this account.',
};

// ── Linked devices ────────────────────────────────────────────────────────────

export async function loadLinkedDevices(host) {
	try {
		const [devices, pending] = await Promise.all([get('/api/auth/link-codes/devices'), get('/api/auth/link-codes/pending')]);
		renderLinkedDevices(host, devices, pending);
	} catch (err) {
		host.innerHTML = errorStateHTML({ title: 'Couldn’t load linked devices', body: esc(err?.message || 'Check your connection and try again.') });
		const retry = document.createElement('button');
		retry.className = 'dn-btn';
		retry.type = 'button';
		retry.textContent = 'Try again';
		retry.style.marginTop = '10px';
		retry.addEventListener('click', () => loadLinkedDevices(host));
		host.appendChild(retry);
	}
}

function renderLinkedDevices(host, devices, pending) {
	const kinds = pending.kinds || devices.kinds || {};
	const scopes = pending.scopes || [];
	const defaults = pending.defaults || {};
	const list = devices.devices || [];
	const waiting = pending.pending || [];

	const mintRow = `
		<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px">
			<span style="font-size:12.5px;color:var(--nxt-ink-fade)">Link a new</span>
			${Object.entries(kinds).map(([k, label]) => btn(`${KIND_ICON[k] || ''} ${esc(label)}`, { action: 'mint', attrs: `data-kind="${esc(k)}"` })).join('')}
		</div>
		<div data-slot="code"></div>`;

	const pendingRows = waiting.map((p) => {
		const c = p.claim || {};
		const scopeList = (p.requested_scope || '').split(' ').filter(Boolean);
		const boxes = scopeList.length ? `
			<div style="display:flex;flex-wrap:wrap;gap:6px 14px;margin:8px 0 4px">
				${scopeList.map((s) => `<label style="font-size:12px;display:inline-flex;gap:5px;align-items:center;cursor:pointer"><input type="checkbox" name="scope" value="${esc(s)}" checked> ${esc(s)}</label>`).join('')}
			</div>
			<div style="font-size:11.5px;color:var(--nxt-ink-fade)">Untick anything this device should not be able to do. You can narrow the request, never widen it.</div>` : '';
		const where = [c.platform, c.client].filter(Boolean).join(' · ');
		const tgLine = c.telegram ? `Telegram ${c.telegram.chat_type === 'private' ? 'private chat' : esc(c.telegram.chat_title || c.telegram.chat_type || 'chat')}${c.telegram.username ? ` with @${esc(c.telegram.username)}` : ''}` : null;
		return `
			<div data-pending="${esc(p.id)}" style="padding:12px;border:1px solid var(--nxt-stroke);border-left:3px solid var(--nxt-accent, #8ab4f8);border-radius:var(--nxt-radius-sm);margin-bottom:10px">
				<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:start">
					<div style="min-width:220px;flex:1">
						<div style="font-size:13.5px;color:var(--nxt-ink);font-weight:500">${KIND_ICON[p.device_kind] || ''} ${esc(c.name || p.label || p.device_label)} wants to link as a ${esc(p.device_label.toLowerCase())}</div>
						<div style="font-size:12px;color:var(--nxt-ink-fade);margin-top:3px">
							${tgLine ? esc(tgLine) + ' · ' : ''}${where ? esc(where) + ' · ' : ''}${c.ip ? `from ${esc(c.ip)} · ` : ''}claimed ${esc(relTime(p.claimed_at))} · code ends ${esc(relTime(p.expires_at))}
						</div>
						${c.user_agent ? `<div style="font-size:11.5px;color:var(--nxt-ink-fade);margin-top:2px;overflow-wrap:anywhere">${esc(c.user_agent)}</div>` : ''}
						${boxes}
					</div>
					<div style="display:flex;gap:6px">
						${btn('Reject', { action: 'reject', attrs: `data-id="${esc(p.id)}"` })}
						${btn('Confirm link', { kind: 'primary', action: 'confirm', attrs: `data-id="${esc(p.id)}"` })}
					</div>
				</div>
			</div>`;
	}).join('');

	const deviceRows = list.map((d) => {
		const live = d.credential_live !== false && !d.revoked_at;
		const meta = d.meta || {};
		const sub = [
			d.kind_label,
			meta.platform ? meta.platform : null,
			meta.telegram?.username ? `@${meta.telegram.username}` : null,
			d.last_used_at ? `used ${relTime(d.last_used_at)}` : 'never used',
			`linked ${relTime(d.linked_at)}`,
		].filter(Boolean).join(' · ');
		return `
			<div style="display:flex;align-items:center;gap:12px;padding:11px 0;border-bottom:1px solid var(--nxt-stroke);flex-wrap:wrap">
				<div style="width:28px;text-align:center;font-size:16px" aria-hidden="true">${KIND_ICON[d.kind] || '•'}</div>
				<div style="flex:1;min-width:200px">
					<div style="font-size:13.5px;color:var(--nxt-ink);font-weight:500">${esc(d.label || d.kind_label)} ${live ? '' : '<span class="dn-tag" style="margin-left:6px">revoked</span>'}</div>
					<div style="font-size:12px;color:var(--nxt-ink-fade);margin-top:3px">${esc(sub)}</div>
				</div>
				${live ? btn('Revoke', { kind: 'danger', action: 'revoke', attrs: `data-id="${esc(d.id)}" data-label="${esc(d.label || d.kind_label)}"` }) : ''}
			</div>`;
	}).join('');

	host.innerHTML = `
		${mintRow}
		${pendingRows ? `<div style="margin-bottom:14px"><div style="font-size:11.5px;color:var(--nxt-ink-fade);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:8px">Waiting for your confirmation</div>${pendingRows}</div>` : ''}
		${deviceRows || `
			<div class="dn-empty" style="padding:18px">
				<h3>No devices linked yet</h3>
				<p>Pick a device type above to get a one-time code. Codes work once and expire in ten minutes; every link shows you what it will do before you confirm it.</p>
			</div>`}
	`;

	host.querySelectorAll('[data-action="mint"]').forEach((b) => b.addEventListener('click', () => mintCode(host, b.dataset.kind, kinds, scopes, defaults)));
	host.querySelectorAll('[data-action="confirm"], [data-action="reject"]').forEach((b) => b.addEventListener('click', () => decide(host, b)));
	host.querySelectorAll('[data-action="revoke"]').forEach((b) => b.addEventListener('click', () => revoke(host, b)));
	if (waiting.length === 0) watchForClaims(host);
}

let watchTimer = null;
function watchForClaims(host) {
	if (watchTimer) clearTimeout(watchTimer);
	// A device that claims the code while this page is open should show up
	// without a reload; stop once the page is gone or a claim is in view.
	const tick = async () => {
		if (!host.isConnected || host.querySelector('[data-pending]')) return;
		if (!host.querySelector('[data-slot="code"] [data-minted]')) return;
		try {
			const pending = await get('/api/auth/link-codes/pending');
			if (pending.pending?.length) return loadLinkedDevices(host);
		} catch {
			// transient; keep watching
		}
		watchTimer = setTimeout(tick, POLL_MS);
	};
	watchTimer = setTimeout(tick, POLL_MS);
}

async function mintCode(host, kind, kinds, scopes, defaults) {
	const slot = host.querySelector('[data-slot="code"]');
	slot.innerHTML = `<div style="padding:12px;border:1px solid var(--nxt-stroke);border-radius:var(--nxt-radius-sm);margin-bottom:14px;color:var(--nxt-ink-fade);font-size:12.5px">Minting a code…</div>`;
	let minted;
	try {
		minted = await post('/api/auth/link-codes/mint', { device_kind: kind, scopes: defaults[kind] ? defaults[kind].join(' ') : undefined });
	} catch (err) {
		slot.innerHTML = '';
		toast(err?.code === 'rate_limited' ? 'Too many codes. Wait a few minutes.' : (err?.message || 'Could not mint a code'));
		return;
	}
	const command = kind === 'cli'
		? `npx three-ws link ${minted.code}`
		: kind === 'telegram' ? `/link ${minted.code}` : null;
	const link = kind === 'phone' || kind === 'desktop' ? `${location.origin}/link-device?code=${encodeURIComponent(minted.code)}` : null;
	slot.innerHTML = `
		<div data-minted="${esc(minted.id)}" style="padding:14px;border:1px solid var(--nxt-stroke);border-radius:var(--nxt-radius-sm);margin-bottom:14px">
			<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center">
				<div>
					<div style="font-size:12px;color:var(--nxt-ink-fade)">${KIND_ICON[kind] || ''} ${esc(kinds[kind] || kind)} link code · expires in ${Math.round((minted.expires_in || 600) / 60)} minutes · works once</div>
					<div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:26px;letter-spacing:0.18em;margin:6px 0 4px;user-select:all">${esc(minted.code)}</div>
					<div style="font-size:12px;color:var(--nxt-ink-fade)">${esc(KIND_HINT[kind] || '')}</div>
					${command ? `<code style="display:inline-block;margin-top:8px;padding:4px 8px;border-radius:6px;background:rgba(255,255,255,0.05);font-size:12.5px;user-select:all">${esc(command)}</code>` : ''}
					${link ? `<div style="margin-top:8px;font-size:12px;overflow-wrap:anywhere"><a href="${esc(link)}" target="_blank" rel="noopener">${esc(link)}</a></div>` : ''}
				</div>
				<div style="display:flex;gap:6px;flex-direction:column">
					${btn('Copy code', { action: 'copy-code', attrs: `data-copy="${esc(command || minted.code)}"` })}
					<canvas data-slot="qr" width="120" height="120" aria-label="QR code with the link" hidden style="border-radius:8px;background:rgba(255,255,255,0.04);padding:4px"></canvas>
				</div>
			</div>
			<div style="font-size:12px;color:var(--nxt-ink-fade);margin-top:10px" data-slot="wait">Waiting for the device. Once it enters the code, its request appears here for you to confirm.</div>
		</div>`;
	slot.querySelector('[data-action="copy-code"]').addEventListener('click', async (e) => {
		try { await navigator.clipboard.writeText(e.currentTarget.dataset.copy); toast('Copied'); } catch { toast('Copy failed'); }
	});
	if (link) {
		try {
			const mod = await import('qrcode');
			const canvas = slot.querySelector('[data-slot="qr"]');
			await (mod.default || mod).toCanvas(canvas, link, { width: 120, margin: 1, color: { dark: '#ffffffff', light: '#00000000' } });
			canvas.hidden = false;
		} catch {
			// The typed code and the link both still work.
		}
	}
	watchForClaims(host);
}

async function decide(host, b) {
	const id = b.dataset.id;
	const decision = b.dataset.action === 'confirm' ? 'confirm' : 'reject';
	const card = host.querySelector(`[data-pending="${CSS.escape(id)}"]`);
	const boxes = [...card.querySelectorAll('input[name="scope"]')];
	const scopes = boxes.length ? boxes.filter((x) => x.checked).map((x) => x.value) : undefined;
	if (decision === 'confirm' && boxes.length && !scopes.length) {
		toast('Keep at least one permission, or reject the request.');
		return;
	}
	card.querySelectorAll('button').forEach((x) => { x.disabled = true; });
	b.textContent = decision === 'confirm' ? 'Linking…' : 'Rejecting…';
	try {
		const r = await post('/api/auth/link-codes/decide', { id, decision, scopes });
		if (decision === 'confirm') {
			toast(r.chat_notice ? 'Linked. The chat has been told.' : `Linked ${r.device?.label || r.device_label || 'device'}`);
		} else {
			toast('Request rejected. The device received nothing.');
		}
		await loadLinkedDevices(host);
	} catch (err) {
		toast(err?.code === 'wrong_account' ? 'That request belongs to a different account.' : (err?.message || 'Could not decide that request'));
		await loadLinkedDevices(host);
	}
}

async function revoke(host, b) {
	if (!confirm(`Revoke ${b.dataset.label}? It is signed out immediately and its key or session stops working.`)) return;
	b.disabled = true;
	b.textContent = 'Revoking…';
	try {
		await post('/api/auth/link-codes/revoke', { id: b.dataset.id });
		toast('Device revoked');
		await loadLinkedDevices(host);
	} catch (err) {
		toast(err?.message || 'Revoke failed');
		b.disabled = false;
		b.textContent = 'Revoke';
	}
}

// ── Payout wallets ────────────────────────────────────────────────────────────

function solanaProvider() {
	return window.phantom?.solana || window.solana || window.backpack || window.solflare || null;
}

function evmProvider() {
	return window.ethereum || null;
}

const isUserRejection = (err) => err?.code === 4001 || /reject|denied|cancel/i.test(err?.message || '');

async function signChallenge(chain, message, address) {
	if (chain === 'solana') {
		const provider = solanaProvider();
		const signed = await provider.signMessage(new TextEncoder().encode(message), 'utf8');
		return btoa(String.fromCharCode(...signed.signature));
	}
	const provider = evmProvider();
	return provider.request({ method: 'personal_sign', params: [message, address] });
}

async function connectedAddress(chain) {
	if (chain === 'solana') {
		const provider = solanaProvider();
		if (!provider) throw Object.assign(new Error('No Solana wallet detected. Install Phantom, then try again.'), { noWallet: 'https://phantom.app/' });
		const res = await provider.connect();
		const address = res?.publicKey?.toString?.();
		if (!address) throw new Error('Wallet did not return an address');
		return address;
	}
	const provider = evmProvider();
	if (!provider) throw Object.assign(new Error('No EVM wallet detected. Install a browser wallet, then try again.'), { noWallet: 'https://metamask.io/' });
	const [address] = await provider.request({ method: 'eth_requestAccounts' });
	if (!address) throw new Error('Wallet did not return an address');
	return address;
}

export async function loadPayoutWallets(host, agents) {
	try {
		const linked = await get('/api/auth/linked-accounts');
		renderPayoutWallets(host, linked.payout, agents);
	} catch (err) {
		host.innerHTML = errorStateHTML({ title: 'Couldn’t load payout wallets', body: esc(err?.message || 'Check your connection and try again.') });
		const retry = document.createElement('button');
		retry.className = 'dn-btn';
		retry.type = 'button';
		retry.textContent = 'Try again';
		retry.style.marginTop = '10px';
		retry.addEventListener('click', () => loadPayoutWallets(host, agents));
		host.appendChild(retry);
	}
}

const STATUS_TAG = {
	active: '<span class="dn-tag" style="background:rgba(120,200,140,0.12);border-color:rgba(120,200,140,0.3);color:#9fd09f">active</span>',
	cooldown: '<span class="dn-tag" style="background:rgba(240,180,80,0.12);border-color:rgba(240,180,80,0.3);color:#f0b450">cooldown</span>',
	awaiting_approval: '<span class="dn-tag" style="background:rgba(138,180,248,0.12);border-color:rgba(138,180,248,0.3);color:#8ab4f8">awaiting approval</span>',
};

function renderPayoutWallets(host, payout, agents) {
	const wallets = payout?.wallets || [];
	const hours = payout?.cooldown_hours || 24;
	const agentOptions = [`<option value="">Whole account</option>`].concat((agents || []).map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`)).join('');
	const form = `
		<form data-form="payout" style="display:flex;gap:8px;flex-wrap:wrap;align-items:end;margin-bottom:14px">
			<label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--nxt-ink-fade)">Chain
				<select name="chain" class="dn-input" style="padding:6px 10px;font-size:13px"><option value="solana">Solana</option><option value="evm">EVM (Base)</option></select>
			</label>
			<label style="display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--nxt-ink-fade)">For
				<select name="agent_id" class="dn-input" style="padding:6px 10px;font-size:13px">${agentOptions}</select>
			</label>
			<button class="dn-btn primary" type="submit" style="padding:7px 12px;font-size:12.5px">Prove a wallet and set it</button>
			<span style="font-size:12px;color:var(--nxt-ink-fade);flex-basis:100%">Your wallet signs a message that names this account and the role; no transaction, no funds move. Replacing a live wallet needs your password and takes effect after ${hours} hours.</span>
		</form>`;
	const rows = wallets.map((w) => {
		const who = w.agent_id ? (w.agent_name || 'Agent') : 'Whole account';
		const when = w.status === 'cooldown' ? ` · takes over ${relTime(w.effective_at).replace(' ago', '')}` : w.status === 'awaiting_approval' ? ' · waiting on the approvals queue' : '';
		return `
			<div style="display:flex;align-items:center;gap:12px;padding:11px 0;border-bottom:1px solid var(--nxt-stroke);flex-wrap:wrap">
				<div style="flex:1;min-width:220px">
					<div style="font-size:13.5px;color:var(--nxt-ink);display:flex;gap:8px;align-items:center;flex-wrap:wrap">
						<span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px" title="${esc(w.address)}">${esc(truncMid(w.address, 8, 6))}</span>
						<span class="dn-tag">${esc(w.chain)}</span>
						${STATUS_TAG[w.status] || ''}
						${w.verified_at ? '<span class="dn-tag" title="Ownership proved with a signed message">proved</span>' : ''}
					</div>
					<div style="font-size:12px;color:var(--nxt-ink-fade);margin-top:3px">${esc(who)}${w.is_default ? ' · default' : ''} · set by ${esc(w.set_by || 'owner')} ${esc(relTime(w.created_at))}${esc(when)}</div>
				</div>
				${w.status === 'awaiting_approval' && w.approval_request_id ? `<a class="dn-btn" href="/dashboard/approvals" style="padding:5px 10px;font-size:12px">Review in approvals</a>` : ''}
			</div>`;
	}).join('');
	host.innerHTML = `${form}${rows || `
		<div class="dn-empty" style="padding:18px">
			<h3>No payout wallet yet</h3>
			<p>Earnings from sales, skills and subscriptions need somewhere to go. Prove a wallet above; the first one goes live at once.</p>
		</div>`}`;
	host.querySelector('[data-form="payout"]').addEventListener('submit', (e) => {
		e.preventDefault();
		provePayoutWallet(host, e.currentTarget, agents);
	});
}

async function provePayoutWallet(host, form, agents) {
	const chain = form.chain.value;
	const agentId = form.agent_id.value || null;
	const submit = form.querySelector('button[type="submit"]');
	const label = submit.textContent;
	submit.disabled = true;
	submit.textContent = 'Check your wallet…';
	try {
		const address = await connectedAddress(chain);
		const challenge = await post('/api/auth/external-wallet/challenge', { chain, address, role: 'payout', agent_id: agentId || undefined });
		const signature = await signChallenge(chain, challenge.message, address);
		submit.textContent = 'Saving…';
		const r = await withPayoutStepUp(async (extra) => {
			try {
				const data = await post('/api/auth/external-wallet/verify', { chain, message: challenge.message, signature, ...extra });
				return { ok: true, status: 200, data };
			} catch (err) {
				return { ok: false, status: err?.status || 0, data: err?.body || { error: err?.code, error_description: err?.message } };
			}
		});
		if (!r.ok) {
			if (!r.cancelled) toast(r.data?.error_description || r.data?.error || 'Could not set the payout wallet');
			return;
		}
		if (r.data.outcome === 'unchanged') toast('That wallet is already the payout wallet.');
		else if (r.data.outcome === 'awaiting_approval') toast('Filed for approval. Review it in the approvals queue.');
		else toast(cooldownNotice(r.data.wallet));
		await loadPayoutWallets(host, agents);
	} catch (err) {
		if (err?.noWallet) {
			toast(err.message);
			window.open(err.noWallet, '_blank', 'noopener');
		} else if (!isUserRejection(err)) {
			toast(err?.message ? `Could not prove the wallet: ${err.message}` : 'Wallet proof failed');
		}
	} finally {
		submit.disabled = false;
		submit.textContent = label;
	}
}
