// Service detail webview. Shows the normalised bazaar item, its payment
// requirements, and a "Pay & call" action that runs the real x402 flow and
// renders the response body + settlement receipt. One reusable panel.

import * as vscode from 'vscode';
import { payAndCall } from './pay.js';

let panel = null;

export function showService(context, item) {
	if (!panel) {
		panel = vscode.window.createWebviewPanel(
			'threewsX402.service',
			'x402 Service',
			vscode.ViewColumn.Active,
			{ enableScripts: true, retainContextWhenHidden: true },
		);
		panel.onDidDispose(() => {
			panel = null;
		});
		panel.webview.onDidReceiveMessage(async (msg) => {
			if (msg?.type === 'pay') {
				await runPay(context, msg);
			} else if (msg?.type === 'openExternal' && msg.url) {
				vscode.env.openExternal(vscode.Uri.parse(msg.url));
			}
		});
	}
	panel.title = `x402 · ${item.serviceName || hostOf(item.resource)}`;
	panel.webview.html = render(item);
	panel.reveal();
}

async function runPay(context, msg) {
	panel?.webview.postMessage({ type: 'status', state: 'running' });
	try {
		const result = await payAndCall(context, {
			url: msg.url,
			method: msg.method,
			body: msg.body,
			serviceName: msg.serviceName,
		});
		if (!result) {
			panel?.webview.postMessage({ type: 'status', state: 'cancelled' });
			return;
		}
		panel?.webview.postMessage({ type: 'result', result });
		if (result.ok) {
			vscode.window.showInformationMessage(
				`x402: ${msg.serviceName || msg.url} → ${result.status}` +
					(result.receipt?.transaction ? ` · tx ${short(result.receipt.transaction)}` : ''),
			);
		}
	} catch (e) {
		panel?.webview.postMessage({ type: 'error', message: e?.message || String(e) });
		vscode.window.showErrorMessage(`x402 payment failed: ${e?.message || e}`);
	}
}

function render(item) {
	const accepts = item.accepts || [];
	const isMcp = item.type === 'mcp';
	const defaultMethod = isMcp ? 'POST' : item.method && item.method !== 'MCP' ? item.method : 'GET';
	const defaultBody = isMcp
		? JSON.stringify(
				{
					jsonrpc: '2.0',
					id: 1,
					method: 'tools/call',
					params: { name: item.toolName || 'tool', arguments: {} },
				},
				null,
				2,
			)
		: '';
	const rows = accepts
		.map(
			(a) => `<tr>
				<td>${esc(a.network || '?')}</td>
				<td>${esc(a.priceLabel || a.amount || '?')}</td>
				<td>${esc(a.scheme || 'exact')}</td>
				<td class="mono">${esc(a.payTo || '')}</td>
			</tr>`,
		)
		.join('');

	return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>${STYLE}</style></head><body>
	<h1>${esc(item.serviceName || hostOf(item.resource))}</h1>
	<p class="desc">${esc(item.description || 'No description provided.')}</p>
	<div class="meta">
		<span class="pill">${esc(item.type || 'http')}</span>
		<span class="pill">${esc(item.minPriceLabel || 'free')}</span>
		${(item.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}
	</div>
	<p class="resource"><a href="#" onclick="ext('${esc(item.resource)}')">${esc(item.resource)}</a>${item.toolName ? ` · tool <code>${esc(item.toolName)}</code>` : ''}</p>
	${item.facilitator ? `<p class="muted">via ${esc(item.facilitator)}</p>` : ''}

	<h2>Payment requirements</h2>
	<table><thead><tr><th>Network</th><th>Price</th><th>Scheme</th><th>payTo</th></tr></thead><tbody>${rows || '<tr><td colspan="4">none</td></tr>'}</tbody></table>

	<h2>Call</h2>
	<label>Method
		<select id="method"><option${defaultMethod === 'GET' ? ' selected' : ''}>GET</option><option${defaultMethod === 'POST' ? ' selected' : ''}>POST</option></select>
	</label>
	<label>Request body (JSON, for POST/MCP)
		<textarea id="body" rows="7" spellcheck="false">${esc(defaultBody)}</textarea>
	</label>
	<button id="pay">Pay &amp; call</button>
	<span id="state" class="state"></span>

	<div id="out" class="out hidden">
		<h2>Response</h2>
		<div id="receipt"></div>
		<pre id="resp"></pre>
	</div>

<script>
	const vscode = acquireVsCodeApi();
	const D = {
		url: ${JSON.stringify(item.resource)},
		serviceName: ${JSON.stringify(item.serviceName || hostOf(item.resource))},
	};
	function ext(url){ vscode.postMessage({ type:'openExternal', url }); }
	document.getElementById('pay').addEventListener('click', () => {
		vscode.postMessage({
			type:'pay',
			url: D.url,
			serviceName: D.serviceName,
			method: document.getElementById('method').value,
			body: document.getElementById('body').value,
		});
	});
	window.addEventListener('message', (e) => {
		const m = e.data;
		const state = document.getElementById('state');
		const out = document.getElementById('out');
		const btn = document.getElementById('pay');
		if (m.type === 'status') {
			btn.disabled = m.state === 'running';
			state.textContent = m.state === 'running' ? 'Working…' : m.state === 'cancelled' ? 'Cancelled.' : '';
			state.className = 'state';
		} else if (m.type === 'error') {
			btn.disabled = false;
			state.textContent = m.message;
			state.className = 'state err';
		} else if (m.type === 'result') {
			btn.disabled = false;
			state.textContent = '';
			out.classList.remove('hidden');
			const r = m.result;
			const rc = document.getElementById('receipt');
			const paid = r.paymentLabel && r.paymentLabel !== 'free' ? r.paymentLabel + (r.network ? ' on ' + r.network : '') : 'free';
			let receipt = '<div class="kv"><b>Status</b> ' + r.status + ' · <b>Paid</b> ' + paid + (r.address ? ' · <b>From</b> <code>' + r.address + '</code>' : '') + '</div>';
			if (r.receipt) {
				const tx = r.receipt.transaction || r.receipt.txHash;
				if (tx) receipt += '<div class="kv"><b>Tx</b> <code>' + tx + '</code> ' + (r.receipt.network ? '('+r.receipt.network+')' : '') + '</div>';
			}
			rc.innerHTML = receipt;
			let body = r.bodyText || '';
			try { body = JSON.stringify(JSON.parse(body), null, 2); } catch(_) {}
			document.getElementById('resp').textContent = body;
		}
	});
</script>
</body></html>`;
}

const STYLE = `
	body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 0 4px 24px; }
	h1 { font-size: 1.4em; margin-bottom: 4px; }
	h2 { font-size: 1em; text-transform: uppercase; letter-spacing: .04em; opacity: .7; margin-top: 24px; }
	.desc { opacity: .9; }
	.muted, .resource { opacity: .7; font-size: .9em; }
	.meta { display:flex; gap:6px; flex-wrap:wrap; margin: 8px 0; }
	.pill { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); padding: 1px 8px; border-radius: 10px; font-size:.8em; }
	.tag { border:1px solid var(--vscode-panel-border); padding:1px 7px; border-radius:10px; font-size:.8em; opacity:.8; }
	a { color: var(--vscode-textLink-foreground); }
	table { width:100%; border-collapse: collapse; font-size:.9em; }
	th, td { text-align:left; padding:4px 8px; border-bottom:1px solid var(--vscode-panel-border); }
	.mono, code { font-family: var(--vscode-editor-font-family); font-size:.85em; word-break: break-all; }
	label { display:block; margin:10px 0 2px; font-size:.85em; opacity:.85; }
	select, textarea { width:100%; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border:1px solid var(--vscode-input-border); border-radius:4px; padding:6px; font-family: var(--vscode-editor-font-family); }
	button { margin-top:12px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border:none; padding:8px 16px; border-radius:4px; cursor:pointer; }
	button:hover { background: var(--vscode-button-hoverBackground); }
	button:disabled { opacity:.5; cursor:default; }
	.state { margin-left:10px; font-size:.85em; opacity:.8; }
	.state.err { color: var(--vscode-errorForeground); opacity:1; }
	.out.hidden { display:none; }
	.kv { font-size:.85em; margin:4px 0; }
	pre { background: var(--vscode-textCodeBlock-background); padding:10px; border-radius:6px; overflow:auto; max-height:420px; }
`;

function esc(s) {
	return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function hostOf(url) {
	try {
		return new URL(url).host;
	} catch {
		return url || 'service';
	}
}
function short(s) {
	return s ? `${s.slice(0, 6)}…${s.slice(-4)}` : '';
}
