/**
 * SkillPaymentModal — self-contained skill purchase flow for the agent-3d
 * embed element. Renders inside the shadow DOM so it works on any host page
 * without colliding with host CSS.
 *
 * Usage:
 *   const modal = new SkillPaymentModal(shadowRoot, agentId);
 *   const purchased = await modal.show({ skill, price });
 *   if (purchased) runtime.skillAccess = refreshedChecker;
 */

const USDC_DECIMALS = 6;

// Lazy-load Solana modules from esm.sh — same pattern as marketplace.js so
// the browser can reuse the same cached module across both surfaces.
let _web3 = null;
let _spl = null;
async function loadSolana() {
	if (!_web3) _web3 = await import('https://esm.sh/@solana/web3.js@1.95.4');
	if (!_spl) _spl = await import('https://esm.sh/@solana/spl-token@0.4.8');
	return { web3: _web3, spl: _spl };
}

const STYLE = `
.skill-pay-overlay {
	position: fixed; inset: 0; background: rgba(0,0,0,0.72);
	display: flex; align-items: center; justify-content: center;
	z-index: 9999; font-family: system-ui, sans-serif;
}
.skill-pay-overlay[hidden] { display: none; }
.skill-pay-box {
	background: #1a1a2e; border: 1px solid rgba(255,255,255,.12);
	border-radius: 16px; padding: 28px 24px; max-width: 380px; width: 90%;
	color: #f0f0f0; box-shadow: 0 24px 64px rgba(0,0,0,.6);
}
.skill-pay-head {
	display: flex; align-items: center; justify-content: space-between;
	margin-bottom: 20px;
}
.skill-pay-title { font-size: 17px; font-weight: 700; letter-spacing: .01em; }
.skill-pay-close {
	background: none; border: none; color: rgba(255,255,255,.5); font-size: 22px;
	cursor: pointer; line-height: 1; padding: 0; transition: color .15s;
}
.skill-pay-close:hover { color: #fff; }
.skill-pay-skill {
	font-size: 15px; font-weight: 600; color: #a78bfa;
	background: rgba(167,139,250,.1); border-radius: 8px;
	padding: 8px 12px; margin: 0 0 8px; font-family: monospace;
	overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.skill-pay-desc { font-size: 13px; color: rgba(255,255,255,.55); margin: 0 0 16px; }
.skill-pay-price {
	display: flex; align-items: center; justify-content: space-between;
	font-size: 15px; margin-bottom: 20px; padding: 12px;
	background: rgba(255,255,255,.05); border-radius: 10px;
}
.skill-pay-price strong { font-size: 20px; color: #34d399; }
.skill-pay-wallet-area { margin-bottom: 12px; }
.skill-pay-btn {
	width: 100%; padding: 12px; border-radius: 10px; border: none;
	font-size: 14px; font-weight: 600; cursor: pointer;
	background: linear-gradient(135deg, #7c3aed, #6d28d9); color: #fff;
	transition: opacity .15s; letter-spacing: .02em;
}
.skill-pay-btn:hover:not(:disabled) { opacity: .88; }
.skill-pay-btn:disabled { opacity: .4; cursor: default; }
.skill-pay-confirm {
	width: 100%; padding: 13px; border-radius: 10px; border: none;
	font-size: 15px; font-weight: 700; cursor: pointer; letter-spacing: .02em;
	background: linear-gradient(135deg, #059669, #047857); color: #fff;
	transition: opacity .15s; margin-top: 10px;
}
.skill-pay-confirm:hover:not(:disabled) { opacity: .88; }
.skill-pay-confirm:disabled { opacity: .35; cursor: default; }
.skill-pay-status {
	margin-top: 12px; font-size: 13px; min-height: 18px; text-align: center;
	color: rgba(255,255,255,.6);
}
.skill-pay-status.err { color: #f87171; }
.skill-pay-status.ok  { color: #34d399; }
.skill-pay-open-link {
	display: block; text-align: center; margin-top: 14px;
	font-size: 12px; color: rgba(255,255,255,.4); text-decoration: none;
}
.skill-pay-open-link:hover { color: rgba(255,255,255,.7); text-decoration: underline; }
`;

export class SkillPaymentModal {
	/**
	 * @param {ShadowRoot|Document} root  where to inject the modal element
	 * @param {string} agentId            the seller agent's UUID
	 */
	constructor(root, agentId) {
		this._root = root;
		this._agentId = agentId;
		this._resolve = null;
		this._wallet = null;
		this._connection = null;
		this._activePurchase = null;
		this._el = null;
		this._init();
	}

	_init() {
		// Inject <style> and overlay into the shadow/light DOM once.
		const style = document.createElement('style');
		style.textContent = STYLE;
		this._root.appendChild(style);

		const el = document.createElement('div');
		el.className = 'skill-pay-overlay';
		el.setAttribute('hidden', '');
		el.innerHTML = `
			<div class="skill-pay-box" role="dialog" aria-modal="true" aria-labelledby="skill-pay-title-text">
				<div class="skill-pay-head">
					<span class="skill-pay-title" id="skill-pay-title-text">Unlock Skill</span>
					<button class="skill-pay-close" aria-label="Close">×</button>
				</div>
				<p class="skill-pay-skill"></p>
				<p class="skill-pay-desc">This skill requires a one-time payment to unlock.</p>
				<div class="skill-pay-price">
					<span>Total</span>
					<strong></strong>
				</div>
				<div class="skill-pay-wallet-area">
					<button class="skill-pay-btn" id="skill-pay-connect">Connect Phantom</button>
				</div>
				<button class="skill-pay-confirm" disabled>Confirm Purchase</button>
				<div class="skill-pay-status" role="status" aria-live="polite"></div>
				<a class="skill-pay-open-link" target="_blank" rel="noopener">
					Open in marketplace →
				</a>
			</div>
		`;
		this._root.appendChild(el);
		this._el = el;

		el.querySelector('.skill-pay-close').addEventListener('click', () => this._cancel());
		el.addEventListener('click', (e) => { if (e.target === el) this._cancel(); });
		el.querySelector('#skill-pay-connect').addEventListener('click', () => this._connectWallet());
		el.querySelector('.skill-pay-confirm').addEventListener('click', () => this._purchase());
	}

	/**
	 * Show the modal for a payment-required event.
	 * @param {{ skill: string, price?: { amount: string|number, currency_mint: string, chain: string } }} payload
	 * @returns {Promise<boolean>} resolves true if purchased, false if dismissed
	 */
	show(payload) {
		return new Promise((resolve) => {
			this._resolve = resolve;
			this._activePurchase = null;

			const { skill = 'skill', price = {} } = payload;
			const amountUsdc = (Number(price.amount || 0) / 10 ** USDC_DECIMALS).toFixed(2);
			const currency = price.chain === 'solana' ? 'USDC' : price.currency_mint?.slice(0, 8) || 'USDC';

			this._el.querySelector('.skill-pay-skill').textContent = skill;
			this._el.querySelector('.skill-pay-price strong').textContent = `${amountUsdc} ${currency}`;
			this._el.querySelector('.skill-pay-open-link').href =
				`/marketplace/agents/${this._agentId}?buy=${encodeURIComponent(skill)}`;

			this._setStatus('');
			this._el.querySelector('.skill-pay-confirm').disabled = true;
			this._updateWalletArea();
			this._el.removeAttribute('hidden');
		});
	}

	hide() {
		this._el.setAttribute('hidden', '');
	}

	_cancel() {
		this.hide();
		this._resolve?.(false);
		this._resolve = null;
	}

	_setStatus(msg, kind = '') {
		const el = this._el.querySelector('.skill-pay-status');
		el.textContent = msg;
		el.className = 'skill-pay-status' + (kind ? ' ' + kind : '');
	}

	_updateWalletArea() {
		const area = this._el.querySelector('.skill-pay-wallet-area');
		const confirm = this._el.querySelector('.skill-pay-confirm');
		if (this._wallet?.isConnected || window.solana?.isConnected) {
			const pub = (this._wallet?.publicKey || window.solana?.publicKey)?.toBase58?.() || '';
			area.innerHTML = `<div style="font-size:12px;color:rgba(255,255,255,.5);padding:8px 0">
				Connected: <code>${pub.slice(0, 6)}…${pub.slice(-4)}</code>
				<button id="skill-pay-disconnect" style="margin-left:8px;font-size:11px;background:none;border:1px solid rgba(255,255,255,.2);border-radius:6px;color:rgba(255,255,255,.5);cursor:pointer;padding:2px 6px">Disconnect</button>
			</div>`;
			area.querySelector('#skill-pay-disconnect')?.addEventListener('click', () => this._disconnect());
			confirm.disabled = false;
		} else {
			area.innerHTML = `<button class="skill-pay-btn" id="skill-pay-connect">Connect Phantom</button>`;
			area.querySelector('#skill-pay-connect')?.addEventListener('click', () => this._connectWallet());
			confirm.disabled = true;
		}
	}

	async _connectWallet() {
		const btn = this._el.querySelector('#skill-pay-connect');
		if (btn) { btn.textContent = 'Connecting…'; btn.disabled = true; }
		try {
			// Try injected Phantom wallet first, then wallet adapter
			if (window.solana?.isPhantom || window.solana?.connect) {
				await window.solana.connect();
				this._wallet = window.solana;
			} else {
				this._setStatus('Phantom not detected. Install Phantom wallet to purchase.', 'err');
				if (btn) { btn.textContent = 'Connect Phantom'; btn.disabled = false; }
				return;
			}
			this._setStatus('');
			this._updateWalletArea();
		} catch (e) {
			this._setStatus(e.message || 'Connection failed', 'err');
			if (btn) { btn.textContent = 'Connect Phantom'; btn.disabled = false; }
		}
	}

	_disconnect() {
		this._wallet?.disconnect?.();
		this._wallet = null;
		this._updateWalletArea();
	}

	async _purchase() {
		const confirm = this._el.querySelector('.skill-pay-confirm');
		confirm.disabled = true;

		const skill = this._el.querySelector('.skill-pay-skill').textContent;

		// Step 1: Create pending purchase record
		this._setStatus('Creating purchase…');
		let purchase;
		try {
			const r = await fetch('/api/marketplace/purchase', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({ agent_id: this._agentId, skill }),
			});
			const j = await r.json();
			if (!r.ok) throw new Error(j.error_description || j.error || `HTTP ${r.status}`);
			purchase = j.data;
			if (purchase.already_owned) {
				this._setStatus('✓ Already purchased — access granted.', 'ok');
				await delay(1000);
				this.hide();
				this._resolve?.(true);
				this._resolve = null;
				return;
			}
		} catch (e) {
			this._setStatus(e.message || 'Failed to start purchase', 'err');
			confirm.disabled = false;
			return;
		}

		// Step 2: Build + sign + send the SPL transfer
		this._setStatus('Building transaction…');
		try {
			const { web3, spl } = await loadSolana();
			const { Connection, PublicKey, Transaction } = web3;
			const { getAssociatedTokenAddressSync, createTransferInstruction } = spl;

			if (!this._connection) {
				const rpc = window.__solanaRpc || 'https://api.mainnet-beta.solana.com';
				this._connection = new Connection(rpc, 'confirmed');
			}

			const payer = this._wallet?.publicKey || window.solana?.publicKey;
			if (!payer) throw new Error('Wallet not connected');

			const payerKey = new PublicKey(payer.toBase58());
			const recipientKey = new PublicKey(purchase.recipient);
			const mintKey = new PublicKey(purchase.currency_mint);
			const referenceKey = new PublicKey(purchase.reference);

			const fromAta = getAssociatedTokenAddressSync(mintKey, payerKey);
			const toAta = getAssociatedTokenAddressSync(mintKey, recipientKey);

			const ix = createTransferInstruction(fromAta, toAta, payerKey, BigInt(purchase.amount));
			ix.keys.push({ pubkey: referenceKey, isSigner: false, isWritable: false });

			const { blockhash } = await this._connection.getLatestBlockhash('confirmed');
			const tx = new Transaction({ feePayer: payerKey, recentBlockhash: blockhash }).add(ix);

			this._setStatus('Approve in wallet…');
			const wallet = this._wallet || window.solana;
			const txid = await wallet.sendTransaction(tx, this._connection);

			this._setStatus('Waiting for confirmation…');
			await this._connection.confirmTransaction(txid, 'confirmed');

			this._setStatus('Verifying with server…');
			const ok = await this._pollConfirm(purchase.reference);
			if (!ok) throw new Error('Server could not verify the transaction — contact support with tx: ' + txid);

			this._setStatus('✓ Skill unlocked!', 'ok');
			await delay(1200);
			this.hide();
			this._resolve?.(true);
			this._resolve = null;
		} catch (e) {
			this._setStatus(e.message || 'Purchase failed', 'err');
			confirm.disabled = false;
		}
	}

	async _pollConfirm(reference, maxMs = 60_000) {
		const deadline = Date.now() + maxMs;
		while (Date.now() < deadline) {
			const r = await fetch(`/api/marketplace/purchase/${reference}/confirm`, {
				method: 'POST',
				credentials: 'include',
			});
			const j = await r.json().catch(() => ({}));
			if (r.ok && j.data?.status === 'confirmed') return true;
			if (r.status === 409) throw new Error(j.error_description || 'Transfer mismatch');
			await delay(2500);
		}
		return false;
	}

	destroy() {
		this._el?.remove();
		this._el = null;
	}
}

function delay(ms) {
	return new Promise((r) => setTimeout(r, ms));
}
