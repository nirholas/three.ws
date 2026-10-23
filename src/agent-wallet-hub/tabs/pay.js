/**
 * Agent Wallet hub — Pay tab (fully built).
 *
 * Owner-only. Discover an x402 service in the bazaar (or paste an endpoint),
 * fetch its live price, and pay it in USDC straight from the agent's OWN Solana
 * wallet — never the shared platform wallet. Streams the payment lifecycle,
 * shows the receipt, and lists the agent's x402 payment history from the custody
 * ledger so every spend is auditable: what was paid, to whom, for what, when.
 *
 * Funding-aware: before paying it checks the agent's USDC balance and, when
 * short, routes the owner to the Deposit tab instead of attempting a doomed pay.
 *
 * All real: bazaar search (/api/bazaar/search), live 402 negotiation + Solana
 * settlement (/api/x402-pay), holdings + custody reads. No mocks, no fake data.
 */

import { registerWalletTab } from '../registry.js';
import { ensureRiskAck } from '../../shared/risk-ack.js';
import {
	searchBazaarServices,
	previewX402,
	payX402Stream,
	fetchAgentUsdc,
	fetchX402Activity,
} from '../../agent-x402-pay.js';
import { formatUsd, timeAgo, explorerTxUrl } from '../util.js';
import { addressHtml } from '../../shared/address.js';

const SEARCH_DEBOUNCE_MS = 350;

const PAY_STYLE_ID = 'awh-pay-style';
const PAY_STYLE = `
.awh-pay-search { display: flex; gap: var(--space-2,8px); }
.awh-pay-input { flex: 1 1 auto; min-width: 0; font: inherit; font-size: var(--text-md,.8125rem); color: var(--ink,#e8e8e8); background: var(--surface-2, rgba(255,255,255,.05)); border: 1px solid var(--stroke, rgba(255,255,255,.08)); border-radius: var(--radius-md,10px); padding: 8px 12px; }
.awh-pay-input:focus-visible { outline: var(--focus-ring-width,2px) solid var(--focus-ring-color,#fff); outline-offset: var(--focus-ring-offset,2px); }
.awh-pay-hint { font-size: var(--text-sm,.764rem); color: var(--ink-dim,#888); margin: var(--space-3,12px) 0 0; }
.awh-pay-hint .awh-linkbtn { background: none; border: 0; padding: 0; margin: 0; font: inherit; color: var(--accent,#7dd3fc); text-decoration: underline; cursor: pointer; }
.awh-pay-hint .awh-linkbtn:hover { color: var(--ink-bright,#fff); }
.awh-pay-hint .awh-linkbtn:focus-visible { outline: 2px solid var(--accent,#7dd3fc); outline-offset: 2px; border-radius: 3px; }
.awh-pay-note { font-size: var(--text-sm,.764rem); color: var(--warn,#fbbf24); margin: 0 0 var(--space-3,12px); }

.awh-svc-list { list-style: none; margin: var(--space-3,12px) 0 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2,8px); }
.awh-svc { display: flex; align-items: center; gap: var(--space-3,12px); padding: var(--space-3,12px); border: 1px solid var(--stroke, rgba(255,255,255,.08)); border-radius: var(--radius-md,10px); background: var(--surface-1, rgba(255,255,255,.03)); transition: border-color var(--duration-fast,140ms), background var(--duration-fast,140ms); }
.awh-svc:hover { border-color: var(--stroke-strong, rgba(255,255,255,.14)); background: var(--surface-2, rgba(255,255,255,.05)); }
.awh-svc-main { min-width: 0; flex: 1 1 auto; }
.awh-svc-name { font-size: var(--text-md,.8125rem); font-weight: 600; color: var(--ink-bright,#fff); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.awh-svc-desc { font-size: var(--text-sm,.764rem); color: var(--ink-dim,#888); margin-top: 2px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.awh-svc-host { font-size: var(--text-2xs,.6875rem); color: var(--ink-dim,#888); margin-top: 3px; }
.awh-svc-side { flex: none; display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
.awh-svc-price { font-family: var(--font-mono, ui-monospace, monospace); font-size: var(--text-sm,.764rem); color: var(--ink,#e8e8e8); }

.awh-pay-sheet-top { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3,12px); margin-bottom: var(--space-3,12px); }
.awh-pay-back { appearance: none; font: inherit; font-size: var(--text-sm,.764rem); color: var(--ink-dim,#888); background: none; border: none; cursor: pointer; padding: 0; }
.awh-pay-back:hover { color: var(--ink,#e8e8e8); }
.awh-pay-rows { display: flex; flex-direction: column; gap: var(--space-2,8px); margin: var(--space-3,12px) 0; }
.awh-pay-row { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-3,12px); font-size: var(--text-sm,.764rem); }
.awh-pay-row dt { color: var(--ink-dim,#888); margin: 0; }
.awh-pay-row dd { margin: 0; color: var(--ink,#e8e8e8); text-align: right; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.awh-pay-price { font-family: var(--font-mono, ui-monospace, monospace); font-size: var(--text-lg,1.236rem); font-weight: 700; color: var(--ink-bright,#fff); }
.awh-pay-body-label { display: block; font-size: var(--text-2xs,.6875rem); text-transform: uppercase; letter-spacing: .06em; color: var(--ink-dim,#888); margin: var(--space-3,12px) 0 6px; }
.awh-pay-textarea { width: 100%; box-sizing: border-box; font-family: var(--font-mono, ui-monospace, monospace); font-size: var(--text-sm,.764rem); color: var(--ink,#e8e8e8); background: var(--surface-2, rgba(255,255,255,.05)); border: 1px solid var(--stroke, rgba(255,255,255,.08)); border-radius: var(--radius-md,10px); padding: 8px 10px; min-height: 88px; resize: vertical; }
.awh-pay-actions { display: flex; gap: var(--space-2,8px); margin-top: var(--space-4,16px); }
.awh-pay-fund { border: 1px solid color-mix(in srgb, var(--warn,#fbbf24) 35%, transparent); background: color-mix(in srgb, var(--warn,#fbbf24) 10%, transparent); border-radius: var(--radius-md,10px); padding: var(--space-3,12px); margin-top: var(--space-3,12px); }
.awh-pay-fund p { margin: 0 0 var(--space-2,8px); font-size: var(--text-sm,.764rem); color: var(--warn,#fbbf24); }

.awh-pay-flow { list-style: none; margin: var(--space-3,12px) 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.awh-pay-step { display: flex; align-items: center; gap: 10px; font-size: var(--text-sm,.764rem); color: var(--ink,#e8e8e8); }
.awh-pay-step::before { content: '✓'; flex: none; width: 18px; height: 18px; border-radius: 50%; display: grid; place-items: center; font-size: 11px; background: color-mix(in srgb, var(--success,#4ade80) 18%, transparent); color: var(--success,#4ade80); }
.awh-pay-step.is-active::before { content: ''; background: none; border: 2px solid var(--ink-dim,#888); border-top-color: var(--ink-bright,#fff); animation: awh-spin .7s linear infinite; }
.awh-pay-step .detail { color: var(--ink-dim,#888); }
.awh-pay-receipt { border: 1px solid color-mix(in srgb, var(--success,#4ade80) 30%, transparent); background: color-mix(in srgb, var(--success,#4ade80) 8%, transparent); border-radius: var(--radius-md,10px); padding: var(--space-3,12px); margin-top: var(--space-3,12px); }
.awh-pay-result { font-family: var(--font-mono, ui-monospace, monospace); font-size: var(--text-2xs,.6875rem); color: var(--ink-dim,#888); white-space: pre-wrap; word-break: break-word; max-height: 180px; overflow: auto; margin: var(--space-2,8px) 0 0; padding: var(--space-2,8px); background: var(--surface-2, rgba(255,255,255,.05)); border-radius: var(--radius-sm,6px); }
.awh-pay-err { color: var(--danger,#f87171); font-size: var(--text-sm,.764rem); margin-top: var(--space-3,12px); }

.awh-act2-list { list-style: none; margin: 0; padding: 0; }
.awh-act2-row { display: flex; align-items: center; gap: var(--space-3,12px); padding: 9px 0; border-bottom: 1px solid var(--stroke, rgba(255,255,255,.06)); font-size: var(--text-sm,.764rem); }
.awh-act2-row:last-child { border-bottom: none; }
.awh-act2-main { flex: 1 1 auto; min-width: 0; }
.awh-act2-svc { color: var(--ink,#e8e8e8); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.awh-act2-meta { color: var(--ink-dim,#888); font-size: var(--text-2xs,.6875rem); margin-top: 2px; }
.awh-act2-amt { flex: none; font-family: var(--font-mono, ui-monospace, monospace); color: var(--ink,#e8e8e8); text-align: right; }
.awh-act2-status { font-size: var(--text-2xs,.6875rem); }
.awh-act2-status.is-pending { color: var(--warn,#fbbf24); }

.awh-pay-skel span { display: block; height: 16px; border-radius: var(--radius-sm,6px); background: var(--surface-2, rgba(255,255,255,.05)); animation: awh-skel 1.4s ease-in-out infinite; margin-bottom: 10px; }
.awh-pay-skel span:nth-child(2){ width: 70%; } .awh-pay-skel span:nth-child(3){ width: 85%; }
@keyframes awh-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce){ .awh-pay-step.is-active::before, .awh-pay-skel span { animation: none; } }
`;
function injectPayStyle() {
	if (typeof document === 'undefined' || document.getElementById(PAY_STYLE_ID)) return;
	const tag = document.createElement('style');
	tag.id = PAY_STYLE_ID;
	tag.textContent = PAY_STYLE;
	document.head.appendChild(tag);
}

function hostOf(u) {
	try {
		return new URL(u).host;
	} catch {
		return u;
	}
}

// First Solana accept's human price for a bazaar resource card.
function solanaPriceLabel(resource) {
	const sol = (resource.accepts || []).find((a) => a.family === 'solana');
	return sol?.priceLabel || resource.minPriceLabel || '';
}

registerWalletTab({
	id: 'pay',
	label: 'Pay',
	order: 50,
	ownerOnly: true,
	mount({ panel, ctx }) {
		injectPayStyle();
		const { escapeHtml, shortAddress, copyToClipboard, toast } = ctx;
		// x402 here settles on Solana mainnet USDC regardless of the hub's network
		// toggle (the bazaar + facilitator are mainnet). We surface a note when the
		// selector is on devnet rather than silently paying on a different network.
		const PAY_NETWORK = 'mainnet';

		let debounceTimer = null;
		let detachNet = null;
		let destroyed = false;
		let payAbort = false; // set on destroy so a late stream result is ignored

		const state = {
			query: '',
			searching: false,
			searched: false,
			services: [],
			searchError: null,
			pasteOpen: false,
			pasteUrl: '',
			pasteError: null,
			selected: null, // { url, method, serviceName, description, bodyText, hasBody }
			previewing: false,
			preview: null,
			previewError: null,
			usdc: null,
			depositAddress: null,
			paying: false,
			progress: [], // [{ key, label, detail, active }]
			payResult: null,
			payError: null,
			activity: null,
			activityLoaded: false,
			activityError: null,
		};

		// ── element hosts (rendered once; sub-regions update in place) ──────────
		function shell() {
			const devnetNote =
				ctx.getNetwork() === 'devnet'
					? `<p class="awh-pay-note">x402 services settle on Solana mainnet — this pays from the agent's mainnet USDC.</p>`
					: '';
			panel.innerHTML = `
				<div class="awh-card">
					<h2 class="awh-card-h">Pay a service</h2>
					${devnetNote}
					<div data-host="main"></div>
				</div>
				<div class="awh-card">
					<h2 class="awh-card-h">Payment activity</h2>
					<div data-host="activity"></div>
				</div>
			`;
			renderMain();
			renderActivity();
		}

		const mainHost = () => panel.querySelector('[data-host="main"]');
		const resultsHost = () => panel.querySelector('[data-host="results"]');
		const flowHost = () => panel.querySelector('[data-host="payflow"]');
		const activityHost = () => panel.querySelector('[data-host="activity"]');

		// ── discover ────────────────────────────────────────────────────────────
		function renderMain() {
			const host = mainHost();
			if (!host) return;
			if (state.selected) {
				host.innerHTML = renderPaySheet();
				wirePaySheet();
				return;
			}
			host.innerHTML = `
				<form class="awh-pay-search" data-form="search" autocomplete="off">
					<input class="awh-pay-input" data-input="query" type="search"
						placeholder="Search the x402 bazaar (e.g. weather, intel, data)…"
						aria-label="Search x402 services" value="${escapeHtml(state.query)}" />
					<button class="awh-btn awh-btn--primary" type="submit">Search</button>
				</form>
				<p class="awh-pay-hint">Browse Solana-payable services, or
					<button type="button" class="awh-linkbtn" data-act="paste" aria-expanded="${state.pasteOpen ? 'true' : 'false'}">${state.pasteOpen ? 'hide URL entry' : 'paste an endpoint URL'}</button>.</p>
				${
					state.pasteOpen
						? `<form class="awh-pay-search" data-form="paste" autocomplete="off" style="margin-top:8px">
								<input class="awh-pay-input" data-input="url" type="url" inputmode="url"
									placeholder="https://api.example.com/paid-endpoint"
									aria-label="x402 endpoint URL" value="${escapeHtml(state.pasteUrl)}" />
								<button class="awh-btn awh-btn--primary" type="submit">Continue</button>
							</form>
							${state.pasteError ? `<div class="awh-pay-err">${escapeHtml(state.pasteError)}</div>` : ''}`
						: ''
				}
				<div data-host="results">${renderResultsInner()}</div>
			`;
			const input = host.querySelector('[data-input="query"]');
			input?.addEventListener('input', () => {
				state.query = input.value;
				clearTimeout(debounceTimer);
				debounceTimer = setTimeout(() => runSearch(), SEARCH_DEBOUNCE_MS);
			});
			const urlInput = host.querySelector('[data-input="url"]');
			if (urlInput) {
				urlInput.addEventListener('input', () => {
					state.pasteUrl = urlInput.value;
				});
				urlInput.focus();
			}
		}

		function renderResultsInner() {
			if (state.searching) {
				return `<div class="awh-pay-skel" aria-busy="true"><span></span><span></span><span></span></div>`;
			}
			if (state.searchError) {
				return `<div class="awh-empty" role="alert">Could not reach the bazaar. <button class="awh-btn awh-bal-mini" type="button" data-act="retry-search">Retry</button></div>`;
			}
			if (!state.searched) {
				return `<p class="awh-pay-hint">Search above to find a paid API to call from this agent's wallet.</p>`;
			}
			if (!state.services.length) {
				return `<div class="awh-empty">No Solana-payable services found${state.query ? ` for “${escapeHtml(state.query)}”` : ''}. Try another search, or paste an endpoint URL above.</div>`;
			}
			return `<ul class="awh-svc-list">${state.services
				.map((s, i) => {
					const price = solanaPriceLabel(s);
					const name = s.serviceName || hostOf(s.resource);
					return `<li class="awh-svc">
						<div class="awh-svc-main">
							<div class="awh-svc-name" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
							${s.description ? `<div class="awh-svc-desc">${escapeHtml(s.description)}</div>` : ''}
							<div class="awh-svc-host">${escapeHtml(hostOf(s.resource))}</div>
						</div>
						<div class="awh-svc-side">
							${price ? `<span class="awh-svc-price">${escapeHtml(price)}</span>` : ''}
							<button class="awh-btn awh-btn--primary awh-bal-mini" type="button" data-act="select" data-i="${i}">Pay</button>
						</div>
					</li>`;
				})
				.join('')}</ul>`;
		}

		function renderResults() {
			const host = resultsHost();
			if (host) host.innerHTML = renderResultsInner();
		}

		async function runSearch() {
			if (destroyed) return;
			const q = state.query.trim();
			state.searching = true;
			state.searchError = null;
			renderResults();
			try {
				const { resources } = await searchBazaarServices(q, { limit: 24 });
				if (destroyed) return;
				// Only keep entries that actually expose a Solana accept to pay.
				state.services = resources.filter((r) => (r.accepts || []).some((a) => a.family === 'solana'));
				state.searched = true;
			} catch (e) {
				state.searchError = e?.message || 'search failed';
			} finally {
				state.searching = false;
				renderResults();
			}
		}

		// ── pay sheet ─────────────────────────────────────────────────────────
		function selectFromService(resource) {
			const sol = (resource.accepts || []).find((a) => a.family === 'solana');
			const method = (resource.input?.method || resource.method || 'GET').toUpperCase();
			const hasBody = ['POST', 'PUT', 'PATCH'].includes(method);
			const bodyExample = resource.input?.body;
			state.selected = {
				url: resource.resource,
				method,
				hasBody,
				bodyText: hasBody && bodyExample ? JSON.stringify(bodyExample, null, 2) : '',
				serviceName: resource.serviceName || hostOf(resource.resource),
				description: resource.description || '',
				priceLabel: sol?.priceLabel || '',
			};
			resetPayState();
			renderMain();
			runPreview();
		}

		function submitPastedUrl() {
			const raw = (state.pasteUrl || '').trim();
			let url;
			try {
				url = new URL(raw);
			} catch {
				state.pasteError = 'Enter a full URL, e.g. https://api.example.com/endpoint';
				renderMain();
				return;
			}
			if (url.protocol !== 'https:' && url.protocol !== 'http:') {
				state.pasteError = 'Only http(s) endpoints can be paid.';
				renderMain();
				return;
			}
			state.pasteError = null;
			selectFromUrl(url.href);
		}

		function selectFromUrl(url) {
			state.selected = {
				url,
				method: 'GET',
				hasBody: false,
				bodyText: '',
				serviceName: hostOf(url),
				description: '',
				priceLabel: '',
			};
			resetPayState();
			renderMain();
			runPreview();
		}

		function resetPayState() {
			state.previewing = false;
			state.preview = null;
			state.previewError = null;
			state.usdc = null;
			state.paying = false;
			state.progress = [];
			state.payResult = null;
			state.payError = null;
		}

		function backToServices() {
			state.selected = null;
			resetPayState();
			renderMain();
		}

		async function runPreview() {
			const sel = state.selected;
			if (!sel) return;
			state.previewing = true;
			state.previewError = null;
			renderMain();
			const [prev, bal] = await Promise.allSettled([
				previewX402({ agentId: ctx.agentId, url: sel.url, method: sel.method, body: bodyForRequest() }),
				fetchAgentUsdc(ctx.agentId, PAY_NETWORK),
			]);
			if (destroyed || state.selected !== sel) return;
			if (prev.status === 'fulfilled') {
				state.preview = prev.value;
				state.previewError = null;
			} else {
				state.previewError = prev.reason?.message || 'could not load the price';
			}
			state.usdc = bal.status === 'fulfilled' ? bal.value.usdc : null;
			state.depositAddress = bal.status === 'fulfilled' ? bal.value.address : null;
			state.previewing = false;
			renderMain();
		}

		function bodyForRequest() {
			const sel = state.selected;
			if (!sel || !sel.hasBody || !sel.bodyText.trim()) return undefined;
			try {
				return JSON.parse(sel.bodyText);
			} catch {
				return sel.bodyText; // send as-is; the server forwards it
			}
		}

		function renderPaySheet() {
			const sel = state.selected;
			const head = `
				<div class="awh-pay-sheet-top">
					<button class="awh-pay-back" type="button" data-act="back">← Back to services</button>
				</div>
				<div class="awh-svc-name" title="${escapeHtml(sel.serviceName)}">${escapeHtml(sel.serviceName)}</div>
				<div class="awh-svc-host">${escapeHtml(hostOf(sel.url))}</div>
				${sel.description ? `<p class="awh-svc-desc" style="margin-top:6px;-webkit-line-clamp:4">${escapeHtml(sel.description)}</p>` : ''}`;

			if (state.payResult) return head + renderReceipt();
			if (state.paying) return head + `<div data-host="payflow" role="status" aria-live="polite">${renderFlow()}</div>`;

			if (state.previewing) {
				return head + `<div class="awh-pay-skel" aria-busy="true" style="margin-top:12px"><span></span><span></span><span></span></div>`;
			}
			if (state.previewError) {
				return head + `<div class="awh-pay-err" role="alert">${escapeHtml(state.previewError)}</div>
					<div class="awh-pay-actions"><button class="awh-btn" type="button" data-act="retry-preview">Try again</button></div>`;
			}
			const p = state.preview;
			if (p && p.requires_payment === false) {
				return head + `<p class="awh-pay-hint">This endpoint responded without asking for payment — there is nothing to pay. You can call it directly.</p>
					<div class="awh-pay-actions"><button class="awh-btn" type="button" data-act="back">Back</button></div>`;
			}
			if (p && p.payable === false) {
				const nets = Array.isArray(p.networks) && p.networks.length ? p.networks.join(', ') : 'another network';
				const why = p.code === 'no_solana_accept'
					? `This service only accepts ${escapeHtml(nets)}. Agent wallets pay in Solana USDC, so it can't be paid from here.`
					: `This service didn't advertise a Solana fee payer, so it can't be paid from here.`;
				return head + `<div class="awh-pay-err">${why}</div>
					<div class="awh-pay-actions"><button class="awh-btn" type="button" data-act="back">Back to services</button></div>`;
			}

			// Ready to confirm.
			const price = p?.price_usdc;
			const priceStr = price != null ? `${price.toFixed(price < 1 ? 4 : 2)} USDC` : (sel.priceLabel || '—');
			const usdcStr = state.usdc == null ? 'unavailable' : `${state.usdc.toFixed(state.usdc < 1 ? 4 : 2)} USDC`;
			const insufficient = price != null && state.usdc != null && state.usdc < price;
			const bodyEditor = sel.hasBody
				? `<label class="awh-pay-body-label" for="awh-pay-body">Request body (JSON)</label>
					<textarea class="awh-pay-textarea" id="awh-pay-body" data-input="body" spellcheck="false">${escapeHtml(sel.bodyText)}</textarea>`
				: '';

			const fundBlock = insufficient
				? `<div class="awh-pay-fund">
						<p>This agent has ${escapeHtml(usdcStr)} but the service costs ${escapeHtml(priceStr)}. Fund the wallet first.</p>
						${state.depositAddress ? `<div class="awh-bal-addr"><span class="awh-mono">${addressHtml(state.depositAddress, { head: 6, tail: 6, label: 'Wallet deposit address' })}</span><button class="awh-btn awh-bal-mini" type="button" data-act="copy-addr">Copy</button></div>` : ''}
						<div class="awh-pay-actions"><button class="awh-btn awh-btn--primary" type="button" data-act="fund">Fund wallet →</button></div>
					</div>`
				: '';

			return head + `
				<dl class="awh-pay-rows">
					<div class="awh-pay-row"><dt>Price</dt><dd class="awh-pay-price">${escapeHtml(priceStr)}</dd></div>
					<div class="awh-pay-row"><dt>Pay to</dt><dd class="awh-mono">${addressHtml(p?.payTo || '', { head: 6, tail: 6, label: 'Recipient' })}</dd></div>
					<div class="awh-pay-row"><dt>Method</dt><dd>${escapeHtml(sel.method)}</dd></div>
					<div class="awh-pay-row"><dt>Agent balance</dt><dd>${escapeHtml(usdcStr)}</dd></div>
				</dl>
				${bodyEditor}
				${fundBlock}
				<div class="awh-pay-actions">
					<button class="awh-btn awh-btn--primary" type="button" data-act="pay" ${insufficient || !p?.payable ? 'disabled' : ''}>Pay ${escapeHtml(priceStr)}</button>
					<button class="awh-btn" type="button" data-act="back">Cancel</button>
				</div>`;
		}

		function renderFlow() {
			return `<ul class="awh-pay-flow">${state.progress
				.map(
					(s) => `<li class="awh-pay-step ${s.active ? 'is-active' : ''}">${escapeHtml(s.label)}${s.detail ? ` <span class="detail">· ${escapeHtml(s.detail)}</span>` : ''}</li>`,
				)
				.join('')}</ul>${state.payError ? `<div class="awh-pay-err" role="alert">${escapeHtml(state.payError)}</div><div class="awh-pay-actions"><button class="awh-btn" type="button" data-act="retry-preview">Try again</button><button class="awh-btn" type="button" data-act="back">Back</button></div>` : ''}`;
		}

		function renderReceipt() {
			const r = state.payResult;
			const pay = r.payment || {};
			let resultStr = '';
			try {
				resultStr = typeof r.result === 'string' ? r.result : JSON.stringify(r.result, null, 2);
			} catch {
				resultStr = String(r.result ?? '');
			}
			if (resultStr.length > 1500) resultStr = resultStr.slice(0, 1500) + '\n…';
			const amt = pay.amount != null ? `${(Number(pay.amount) / 1e6).toFixed(Number(pay.amount) / 1e6 < 1 ? 4 : 2)} USDC` : '';
			return `
				<div class="awh-pay-receipt">
					<div class="awh-svc-name" style="color:var(--success,#4ade80)">Paid ✓ ${escapeHtml(amt)}</div>
					<dl class="awh-pay-rows" style="margin-bottom:0">
						<div class="awh-pay-row"><dt>Paid to</dt><dd class="awh-mono">${addressHtml(pay.payTo || '', { head: 6, tail: 6, label: 'Recipient' })}</dd></div>
						${pay.tx ? `<div class="awh-pay-row"><dt>Transaction</dt><dd><a class="awh-mono awh-act-sig" href="${escapeHtml(pay.explorer || explorerTxUrl(pay.tx, PAY_NETWORK))}" target="_blank" rel="noopener">${escapeHtml(shortAddress(pay.tx, 6, 6))} ↗</a></dd></div>` : ''}
					</dl>
				</div>
				${resultStr ? `<div class="awh-pay-body-label">Service response</div><pre class="awh-pay-result">${escapeHtml(resultStr)}</pre>` : ''}
				<div class="awh-pay-actions">
					<button class="awh-btn awh-btn--primary" type="button" data-act="back">Pay another</button>
				</div>`;
		}

		function wirePaySheet() {
			const sel = state.selected;
			if (!sel) return;
			const body = mainHost()?.querySelector('[data-input="body"]');
			body?.addEventListener('input', () => {
				sel.bodyText = body.value;
			});
		}

		async function runPay() {
			const sel = state.selected;
			const p = state.preview;
			if (!sel || !p || !p.payable) return;
			if (!(await ensureRiskAck({ context: 'x402-pay' }))) return;
			state.paying = true;
			state.payError = null;
			state.progress = [{ key: 'start', label: 'Submitting payment…', active: true }];
			renderMain();

			const setStep = (key, label, detail) => {
				// Mark the previous active step done, append the new one as active.
				state.progress = state.progress.map((s) => ({ ...s, active: false }));
				state.progress.push({ key, label, detail, active: true });
				const host = flowHost();
				if (host) host.innerHTML = renderFlow();
			};

			try {
				const result = await payX402Stream(
					{
						agentId: ctx.agentId,
						url: sel.url,
						method: sel.method,
						body: bodyForRequest(),
						serviceLabel: sel.serviceName,
					},
					(event, data) => {
						if (destroyed || payAbort) return;
						if (event === 'challenge') {
							const price = data?.price_usdc;
							setStep('challenge', 'Price confirmed', price != null ? `${price.toFixed(price < 1 ? 4 : 2)} USDC` : '');
						} else if (event === 'built') {
							setStep('built', 'Payment signed by agent wallet');
						} else if (event === 'settled') {
							setStep('settled', 'Settled on-chain', data?.tx ? shortAddress(data.tx, 6, 6) : '');
						}
					},
				);
				if (destroyed || payAbort) return;
				state.progress = state.progress.map((s) => ({ ...s, active: false }));
				state.payResult = result;
				state.paying = false;
				renderMain();
				toast('Payment complete');
				// Reflect the spend immediately.
				loadActivity();
				fetchAgentUsdc(ctx.agentId, PAY_NETWORK)
					.then((b) => { state.usdc = b.usdc; })
					.catch(() => {});
			} catch (e) {
				if (destroyed || payAbort) return;
				state.progress = state.progress.map((s) => ({ ...s, active: false }));
				state.payError = e?.message || 'payment failed';
				state.paying = false;
				renderMain();
			}
		}

		// ── activity ────────────────────────────────────────────────────────────
		function renderActivityInner() {
			if (!state.activityLoaded) {
				return `<div class="awh-pay-skel" aria-busy="true"><span></span><span></span></div>`;
			}
			if (state.activityError) {
				return `<div class="awh-empty" role="alert">Could not load payment activity. <button class="awh-btn awh-bal-mini" type="button" data-act="retry-activity">Retry</button></div>`;
			}
			const rows = state.activity || [];
			if (!rows.length) {
				return `<div class="awh-empty">No payments yet. Services you pay for from this wallet appear here.</div>`;
			}
			return `<ul class="awh-act2-list">${rows
				.map((e) => {
					const svc = e.meta?.service || (e.meta?.url ? hostOf(e.meta.url) : null) || (e.destination ? shortAddress(e.destination, 4, 4) : 'x402 service');
					const usd = e.usd != null ? formatUsd(e.usd) : null;
					const when = e.created_at ? timeAgo(Math.floor(new Date(e.created_at).getTime() / 1000)) : '';
					const statusCls = e.status === 'pending' ? 'is-pending' : '';
					const statusTxt = e.status && e.status !== 'confirmed' && e.status !== 'ok' ? e.status : '';
					return `<li class="awh-act2-row">
						<div class="awh-act2-main">
							<div class="awh-act2-svc" title="${escapeHtml(e.meta?.url || svc)}">${escapeHtml(svc)}</div>
							<div class="awh-act2-meta">${e.destination ? `to ${escapeHtml(shortAddress(e.destination, 4, 4))} · ` : ''}${escapeHtml(when)}${statusTxt ? ` · <span class="awh-act2-status ${statusCls}">${escapeHtml(statusTxt)}</span>` : ''}</div>
						</div>
						${e.signature ? `<a class="awh-act2-amt awh-act-sig" href="${escapeHtml(e.explorer || explorerTxUrl(e.signature, e.network || PAY_NETWORK))}" target="_blank" rel="noopener">${usd ? escapeHtml(usd) : escapeHtml(shortAddress(e.signature, 4, 4))} ↗</a>` : `<span class="awh-act2-amt">${usd ? escapeHtml(usd) : '—'}</span>`}
					</li>`;
				})
				.join('')}</ul>`;
		}

		function renderActivity() {
			const host = activityHost();
			if (host) host.innerHTML = renderActivityInner();
		}

		async function loadActivity() {
			try {
				const items = await fetchX402Activity(ctx.agentId, PAY_NETWORK, 25);
				if (destroyed) return;
				state.activity = items;
				state.activityError = null;
			} catch (e) {
				state.activityError = e?.message || 'activity_error';
			} finally {
				state.activityLoaded = true;
				renderActivity();
			}
		}

		// ── delegated interactions ──────────────────────────────────────────────
		panel.addEventListener('submit', (e) => {
			const form = e.target?.dataset?.form;
			if (form === 'search') {
				e.preventDefault();
				clearTimeout(debounceTimer);
				runSearch();
			} else if (form === 'paste') {
				e.preventDefault();
				submitPastedUrl();
			}
		});

		panel.addEventListener('click', async (e) => {
			const act = e.target?.closest?.('[data-act]')?.dataset?.act;
			if (!act) return;
			if (act === 'select') {
				const i = Number(e.target.closest('[data-act]').dataset.i);
				const svc = state.services[i];
				if (svc) selectFromService(svc);
			} else if (act === 'paste') {
				e.preventDefault();
				state.pasteOpen = !state.pasteOpen;
				state.pasteError = null;
				renderMain();
			} else if (act === 'back') {
				backToServices();
			} else if (act === 'retry-preview') {
				state.payError = null;
				runPreview();
			} else if (act === 'pay') {
				runPay();
			} else if (act === 'fund') {
				ctx.openTab?.('deposit');
			} else if (act === 'copy-addr') {
				const ok = await copyToClipboard(state.depositAddress);
				toast(ok ? 'Address copied' : 'Copy failed — select it manually');
			} else if (act === 'retry-search') {
				runSearch();
			} else if (act === 'retry-activity') {
				state.activityLoaded = false;
				renderActivity();
				loadActivity();
			}
		});

		// Network toggle only affects the devnet note here (x402 is mainnet).
		detachNet = ctx.onNetworkChange(() => {
			if (!state.selected) shell();
		});

		shell();

		return {
			onShow() {
				if (!state.activityLoaded) loadActivity();
			},
			onHide() {
				clearTimeout(debounceTimer);
			},
			destroy() {
				destroyed = true;
				payAbort = true;
				clearTimeout(debounceTimer);
				detachNet?.();
			},
		};
	},
});
