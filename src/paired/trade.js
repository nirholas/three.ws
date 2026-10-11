// The trade ticket on a paired coin's page: buy the coin with one of its quote
// assets, or sell it back into that pool, from the visitor's own EVM wallet.
//
// Every number comes from the launchpad itself: quoteBuy / quoteSell price the
// trade at the curve's current point, the minimum out is that quote less the
// visitor's slippage, and the contract reverts rather than fill worse. An
// approval is requested only for the exact amount being traded, never an
// unlimited one, and only when the current allowance is short.
//
// Selling into a pool quoted in a tokenized stock delivers a Stock Token, so
// that path carries the same eligibility disclosure the platform shows
// wherever a Stock Token is the output, and needs the visitor to affirm it.

import { BaseError, ContractFunctionRevertedError, createPublicClient, createWalletClient, custom, formatUnits, http, parseUnits } from 'viem';
import { HOOD_MAINNET, ensureChain } from '../robinhood-purchase.js';
import { amount, esc, short } from './common.js';

const EXPLORER = 'https://robinhoodchain.blockscout.com';
const TOKEN_DECIMALS = 18;

const view = (name, inputs, outputs) => ({ name, type: 'function', stateMutability: 'view', inputs, outputs });
const ERC20 = [
	view('balanceOf', [{ type: 'address' }], [{ type: 'uint256' }]),
	view('allowance', [{ type: 'address' }, { type: 'address' }], [{ type: 'uint256' }]),
	{ name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }] },
];
const ERRORS = ['UnknownMarket', 'ZeroAmount', 'SlippageExceeded', 'Reentrancy'];
const LAUNCHPAD = [
	view('quoteBuy', [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }], [{ name: 'tokensOut', type: 'uint256' }, { name: 'fee', type: 'uint256' }]),
	view('quoteSell', [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }], [{ name: 'quoteOut', type: 'uint256' }, { name: 'fee', type: 'uint256' }]),
	{
		name: 'buy',
		type: 'function',
		stateMutability: 'nonpayable',
		inputs: [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint256' }],
		outputs: [{ type: 'uint256' }],
	},
	{
		name: 'sell',
		type: 'function',
		stateMutability: 'nonpayable',
		inputs: [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint256' }],
		outputs: [{ type: 'uint256' }],
	},
	...ERRORS.map((name) => ({ name, type: 'error', inputs: [] })),
];

const REVERTS = {
	SlippageExceeded: 'The price moved past your slippage before the trade landed. Nothing was traded. Raise slippage or try again.',
	ZeroAmount: 'That amount is too small to trade, or more than the pool has left to sell.',
	UnknownMarket: 'This coin does not trade in that pool.',
};

let reader;
function client() {
	if (!reader) reader = createPublicClient({ chain: HOOD_MAINNET, transport: http(undefined, { timeout: 10_000, retryCount: 2 }) });
	return reader;
}

function explain(err) {
	if (err instanceof BaseError) {
		const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
		const name = reverted instanceof ContractFunctionRevertedError ? reverted.data?.errorName : null;
		if (name) return REVERTS[name] || `The launchpad rejected the trade (${name}). Nothing was traded.`;
	}
	const text = String(err?.shortMessage || err?.message || err).toLowerCase();
	if (text.includes('user rejected') || text.includes('user denied')) return 'You cancelled in your wallet. Nothing was traded.';
	if (text.includes('insufficient funds')) return 'Your wallet needs a little ETH on Robinhood Chain for gas.';
	if (text.includes('exceeds balance') || text.includes('insufficient balance')) return 'Your wallet does not hold enough for that amount.';
	return err?.shortMessage || err?.message || 'The trade failed.';
}

/**
 * Mount the ticket. `coin` is the coin-detail payload, `getPool()` returns the
 * pool currently selected on the page, `onTraded()` refreshes the page data.
 */
export function mountTicket(container, { coin, getPool, onTraded }) {
	const s = { side: 'buy', amount: '', slippage: 1, account: null, wallet: null, quote: null, quoting: false, busy: false, eligible: false, balances: null, status: null };
	const launchpad = coin.terms.launchpad;
	let seq = 0;
	let timer = null;

	const pool = () => getPool();
	const inDecimals = () => (s.side === 'buy' ? pool().quoteDecimals : TOKEN_DECIMALS);
	const inSymbol = () => (s.side === 'buy' ? pool().quoteSymbol : coin.symbol);
	const outSymbol = () => (s.side === 'buy' ? coin.symbol : pool().quoteSymbol);
	const needsGate = () => s.side === 'sell' && pool().quoteClass === 'rwa-equity';

	function setStatus(text, kind = '') {
		s.status = text ? { text, kind } : null;
		const el = container.querySelector('#pc-t-status');
		if (!el) return;
		el.hidden = !text;
		el.className = `pc-status${kind ? ` is-${kind}` : ''}`;
		el.innerHTML = text || '';
	}

	function parsedIn() {
		const text = String(s.amount).trim();
		if (!text || !/^\d*\.?\d+$/.test(text)) return null;
		try {
			const v = parseUnits(text, inDecimals());
			return v > 0n ? v : null;
		} catch {
			return null;
		}
	}

	async function refreshBalances() {
		if (!s.account) return;
		const p = pool();
		const [q, t] = await Promise.all([
			client().readContract({ address: p.quoteToken, abi: ERC20, functionName: 'balanceOf', args: [s.account] }),
			client().readContract({ address: coin.address, abi: ERC20, functionName: 'balanceOf', args: [s.account] }),
		]).catch(() => [null, null]);
		s.balances = q == null ? null : { quote: q, token: t };
		paintDynamic();
	}

	async function requote() {
		const id = ++seq;
		const amountIn = parsedIn();
		if (!amountIn) {
			s.quote = null;
			paintDynamic();
			return;
		}
		s.quoting = true;
		paintDynamic();
		try {
			const p = pool();
			const fn = s.side === 'buy' ? 'quoteBuy' : 'quoteSell';
			const [out, fee] = await client().readContract({ address: launchpad, abi: LAUNCHPAD, functionName: fn, args: [coin.address, p.quoteToken, amountIn] });
			if (id !== seq) return;
			s.quote = { amountIn, out, fee };
		} catch (err) {
			if (id !== seq) return;
			s.quote = null;
			setStatus(explain(err), 'error');
		} finally {
			if (id === seq) {
				s.quoting = false;
				paintDynamic();
			}
		}
	}

	function scheduleQuote() {
		clearTimeout(timer);
		timer = setTimeout(requote, 250);
	}

	async function connect() {
		if (!window.ethereum) {
			setStatus('No browser wallet found. Install MetaMask or another EVM wallet to trade.', 'error');
			return;
		}
		try {
			await ensureChain(window.ethereum);
			s.wallet = createWalletClient({ chain: HOOD_MAINNET, transport: custom(window.ethereum) });
			const [addr] = await s.wallet.requestAddresses();
			s.account = addr;
			setStatus('');
			paintDynamic();
			await refreshBalances();
		} catch (err) {
			setStatus(explain(err), 'error');
		}
	}

	async function execute() {
		if (!s.quote || s.busy) return;
		if (needsGate() && !s.eligible) return;
		const p = pool();
		const { amountIn, out } = s.quote;
		const minOut = (out * BigInt(Math.round((100 - s.slippage) * 100))) / 10_000n;
		const spend = s.side === 'buy' ? p.quoteToken : coin.address;
		s.busy = true;
		paintDynamic();
		try {
			await ensureChain(window.ethereum);
			const allowance = await client().readContract({ address: spend, abi: ERC20, functionName: 'allowance', args: [s.account, launchpad] });
			if (allowance < amountIn) {
				setStatus(`Approve ${esc(amount(formatUnits(amountIn, inDecimals())))} ${esc(inSymbol())} in your wallet (this exact amount only).`);
				const approveHash = await s.wallet.writeContract({ account: s.account, address: spend, abi: ERC20, functionName: 'approve', args: [launchpad, amountIn] });
				await client().waitForTransactionReceipt({ hash: approveHash });
			}
			setStatus(`Confirm the ${s.side} in your wallet.`);
			const hash = await s.wallet.writeContract({
				account: s.account,
				address: launchpad,
				abi: LAUNCHPAD,
				functionName: s.side,
				args: [coin.address, p.quoteToken, amountIn, minOut],
			});
			setStatus(`Submitted. Waiting for Robinhood Chain… <a href="${EXPLORER}/tx/${esc(hash)}" target="_blank" rel="noopener noreferrer">${esc(short(hash))} ↗</a>`);
			const receipt = await client().waitForTransactionReceipt({ hash });
			if (receipt.status !== 'success') throw new Error('The trade reverted on chain. Only gas was spent.');
			setStatus(
				`Done: ${s.side === 'buy' ? 'bought' : 'sold'} for at least ${esc(amount(formatUnits(minOut, s.side === 'buy' ? TOKEN_DECIMALS : p.quoteDecimals)))} ${esc(outSymbol())}. <a href="${EXPLORER}/tx/${esc(hash)}" target="_blank" rel="noopener noreferrer">View transaction ↗</a>`,
				'ok',
			);
			s.amount = '';
			s.quote = null;
			const input = container.querySelector('#pc-t-amount');
			if (input) input.value = '';
			await refreshBalances();
			onTraded?.();
		} catch (err) {
			setStatus(explain(err), 'error');
		} finally {
			s.busy = false;
			paintDynamic();
		}
	}

	/** The parts that change while the visitor types: quote, gate, button, balance. */
	function paintDynamic() {
		const p = pool();
		const balIn = s.balances ? (s.side === 'buy' ? s.balances.quote : s.balances.token) : null;
		const over = balIn != null && s.quote && s.quote.amountIn > balIn;
		const outDecimals = s.side === 'buy' ? TOKEN_DECIMALS : p.quoteDecimals;
		const minOut = s.quote ? (s.quote.out * BigInt(Math.round((100 - s.slippage) * 100))) / 10_000n : 0n;

		const outEl = container.querySelector('#pc-t-out');
		if (outEl) {
			outEl.innerHTML = s.quote
				? `<dl class="pc-out">
					<dt>You receive about</dt><dd>${esc(amount(formatUnits(s.quote.out, outDecimals)))} ${esc(outSymbol())}</dd>
					<dt>Minimum after ${esc(s.slippage)}% slippage</dt><dd>${esc(amount(formatUnits(minOut, outDecimals)))}</dd>
					<dt>Swap fee</dt><dd>${esc(amount(formatUnits(s.quote.fee, p.quoteDecimals)))} ${esc(p.quoteSymbol)}</dd>
				</dl>`
				: s.quoting
					? '<div class="cv-skel" style="height:84px;border-radius:10px"></div>'
					: '';
		}

		const gateEl = container.querySelector('#pc-t-gatebox');
		if (gateEl) {
			gateEl.innerHTML = needsGate()
				? `<label class="pc-gate"><input type="checkbox" id="pc-t-gate" ${s.eligible ? 'checked' : ''} /><span>Selling here pays out ${esc(p.quoteSymbol)}, a Stock Token: a tokenized debt security issued by Robinhood Assets (Jersey) Ltd that may not be offered, sold or delivered to US persons (extra limits apply in Canada, the UK and Switzerland). I confirm I am eligible to receive it.</span></label>`
				: '';
			gateEl.querySelector('#pc-t-gate')?.addEventListener('change', (e) => {
				s.eligible = e.target.checked;
				paintDynamic();
			});
		}

		const balEl = container.querySelector('#pc-t-bal');
		if (balEl) balEl.textContent = balIn != null ? ` · balance ${amount(formatUnits(balIn, inDecimals()))}` : '';
		const maxEl = container.querySelector('#pc-t-max');
		if (maxEl) maxEl.hidden = !(balIn != null && balIn > 0n);
		const slipEl = container.querySelector('#pc-t-slipval');
		if (slipEl) slipEl.textContent = `${s.slippage}%`;

		const actionEl = container.querySelector('#pc-t-action');
		if (actionEl) {
			if (!s.account) {
				actionEl.innerHTML = '<button type="button" class="pc-btn pc-btn-primary" id="pc-t-connect" style="width:100%">Connect wallet</button>';
				actionEl.querySelector('#pc-t-connect').addEventListener('click', connect);
			} else {
				const ready = s.quote && !s.quoting && !s.busy && !over && (!needsGate() || s.eligible);
				const label = s.busy ? 'Confirm in your wallet…' : over ? `Not enough ${inSymbol()}` : `${s.side === 'buy' ? 'Buy' : 'Sell'} $${coin.symbol}`;
				actionEl.innerHTML = `<button type="button" class="pc-btn pc-btn-primary ${s.busy ? 'is-busy' : ''}" id="pc-t-go" style="width:100%" ${ready ? '' : 'disabled'}>${esc(label)}</button>`;
				actionEl.querySelector('#pc-t-go').addEventListener('click', execute);
			}
		}
		const footEl = container.querySelector('#pc-t-foot');
		if (footEl) {
			footEl.innerHTML = s.account
				? `Connected as <code>${esc(short(s.account))}</code> on Robinhood Chain.`
				: 'No ETH on Robinhood Chain yet? <a href="https://jumper.exchange/?toChain=4663&amp;toToken=0x0000000000000000000000000000000000000000" target="_blank" rel="noopener noreferrer">Bridge in via LI.FI ↗</a>';
		}
	}

	/** The ticket's shell, rebuilt only when the side or the pool changes. */
	function paint() {
		const p = pool();
		container.innerHTML = `
		<section class="pc-ticket" aria-label="Trade">
			<h2 class="cv-h2">Trade $${esc(coin.symbol)}</h2>
			<div class="pc-side" role="group" aria-label="Side">
				<button type="button" data-side="buy" aria-pressed="${s.side === 'buy'}">Buy</button>
				<button type="button" data-side="sell" aria-pressed="${s.side === 'sell'}">Sell</button>
			</div>
			<p class="pc-fine" style="margin:0">Pool: <strong>${esc(p.quoteSymbol)}</strong>. Pick another pool to trade in it.</p>
			<label class="pc-field" for="pc-t-amount"><span>${s.side === 'buy' ? 'You pay' : 'You sell'}<em id="pc-t-bal"></em></span>
				<div class="pc-unit"><input class="pc-input mono" id="pc-t-amount" inputmode="decimal" autocomplete="off" placeholder="0.0" value="${esc(s.amount)}" /><span>${esc(inSymbol())}</span></div>
			</label>
			<button type="button" class="pc-btn" id="pc-t-max" style="min-height:28px;align-self:flex-start" hidden>Max</button>
			<label class="pc-field" for="pc-t-slip"><span>Slippage <em id="pc-t-slipval"></em></span>
				<input type="range" id="pc-t-slip" min="0.1" max="10" step="0.1" value="${esc(s.slippage)}" />
			</label>
			<div id="pc-t-out" aria-live="polite"></div>
			<div id="pc-t-gatebox"></div>
			<div id="pc-t-action"></div>
			<p class="pc-status" id="pc-t-status" role="status" hidden></p>
			<p class="pc-fine" id="pc-t-foot"></p>
		</section>`;
		wire();
		setStatus(s.status?.text || '', s.status?.kind || '');
		paintDynamic();
	}

	function wire() {
		container.querySelectorAll('[data-side]').forEach((b) =>
			b.addEventListener('click', () => {
				if (s.side === b.dataset.side) return;
				s.side = b.dataset.side;
				s.amount = '';
				s.quote = null;
				s.status = null;
				paint();
			}),
		);
		const input = container.querySelector('#pc-t-amount');
		input.addEventListener('input', () => {
			const clean = input.value.replace(/[^0-9.]/g, '');
			if (clean !== input.value) input.value = clean;
			s.amount = clean;
			scheduleQuote();
		});
		container.querySelector('#pc-t-max').addEventListener('click', () => {
			const bal = s.side === 'buy' ? s.balances.quote : s.balances.token;
			s.amount = formatUnits(bal, inDecimals());
			input.value = s.amount;
			requote();
		});
		const slip = container.querySelector('#pc-t-slip');
		slip.addEventListener('input', () => {
			s.slippage = Number(slip.value);
			paintDynamic();
		});
	}

	paint();
	return {
		/** Called when the page switches pools: reprice in the new pool. */
		poolChanged() {
			s.quote = null;
			s.eligible = false;
			s.status = null;
			paint();
			refreshBalances();
			if (parsedIn()) requote();
		},
	};
}
