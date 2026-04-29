/**
 * Batch registration tab for ERC-8004 agents.
 *
 * Drop a CSV (`name,description,serviceType,endpoint`) or a JSON array of
 * agent configs, preview the queue, then run the same pipeline as step-4 of
 * the single-agent wizard (register(string) with a data-URI registration JSON)
 * for each row.
 *
 * Port of reference logic from erc8004.agency (`handleBatchFile`,
 * `renderBatchPreview`, `executeBatch`). Lightly adapted to our DOM + the
 * helpers already exported by agent-registry.js.
 */

import { ensureWallet, getIdentityRegistry } from './agent-registry.js';
import { REGISTRY_DEPLOYMENTS } from './abi.js';
import { CHAIN_META, switchChain, txExplorerUrl } from './chain-meta.js';

const esc = (s) =>
	String(s ?? '').replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
	);

/**
 * Render the Batch tab into `body`, wired to the surrounding RegisterUI.
 *
 * @param {HTMLElement} body  Container element — cleared and repopulated.
 * @param {object} ctx
 * @param {() => (null | { address: string, chainId: number })} ctx.getWallet
 * @param {() => number} ctx.getChainId
 * @param {(msg: string, isError?: boolean) => void} ctx.toast
 */
export function renderBatchTab(body, ctx) {
	body.innerHTML = `
		<h3 class="erc8004-h3">Batch Registration</h3>
		<p class="erc8004-p">Register multiple agents at once via CSV or JSON import.</p>

		<div class="erc8004-file-drop erc8004-batch-drop" data-role="drop">
			<input type="file" accept=".csv,.json" class="erc8004-file-input" />
			<div class="erc8004-batch-drop-inner">
				<div class="erc8004-batch-drop-icon">📁</div>
				<div class="erc8004-batch-drop-title">Drop CSV or JSON file here</div>
				<div class="erc8004-batch-drop-sub">or click to browse</div>
			</div>
		</div>

		<div class="erc8004-batch-preview" data-role="preview" style="display:none">
			<div class="erc8004-h4">Preview (<span data-role="count">0</span> agents)</div>
			<div class="erc8004-batch-list" data-role="list"></div>
			<div class="erc8004-row" style="margin-top:12px">
				<button class="erc8004-btn erc8004-btn--primary" data-role="run">🚀 Register All</button>
				<button class="erc8004-btn" data-role="clear">Clear</button>
			</div>
			<div class="erc8004-batch-progress" data-role="progress" style="display:none">
				<div class="erc8004-progress-bar"><div class="erc8004-progress-fill" data-role="bar"></div></div>
				<div class="erc8004-muted erc8004-small" data-role="status">Processing…</div>
			</div>
		</div>

		<details class="erc8004-accordion" data-role="format-guide">
			<summary class="erc8004-accordion-head">📝 Format Guide</summary>
			<div class="erc8004-accordion-body">
				<p class="erc8004-p"><strong>JSON format:</strong></p>
<pre class="erc8004-pre">[
  {
    "name": "Agent 1",
    "description": "Description here",
    "services": [{"name": "A2A", "endpoint": "https://..."}]
  }
]</pre>
				<p class="erc8004-p"><strong>CSV format:</strong></p>
<pre class="erc8004-pre">name,description,serviceType,endpoint
Agent 1,Does things,A2A,https://agent1.com
Agent 2,Does more,MCP,https://agent2.com</pre>
			</div>
		</details>
	`;

	const drop = body.querySelector('[data-role="drop"]');
	const input = drop.querySelector('.erc8004-file-input');
	const preview = body.querySelector('[data-role="preview"]');
	const countEl = body.querySelector('[data-role="count"]');
	const listEl = body.querySelector('[data-role="list"]');
	const progress = body.querySelector('[data-role="progress"]');
	const bar = body.querySelector('[data-role="bar"]');
	const status = body.querySelector('[data-role="status"]');

	let queue = [];

	const renderPreview = () => {
		if (!queue.length) {
			preview.style.display = 'none';
			return;
		}
		preview.style.display = '';
		countEl.textContent = String(queue.length);
		listEl.innerHTML = queue
			.map(
				(a, i) => `
					<div class="erc8004-batch-row" data-i="${i}">
						<div class="erc8004-batch-row-num">${i + 1}</div>
						<div class="erc8004-batch-row-body">
							<div class="erc8004-batch-row-title">${esc(a.name || 'Agent ' + (i + 1))}</div>
							<div class="erc8004-muted erc8004-small">${esc((a.description || '').slice(0, 80))}</div>
						</div>
						<div class="erc8004-batch-row-status erc8004-muted" data-role="row-status">pending</div>
					</div>
				`,
			)
			.join('');
	};

	const handleFile = (file) => {
		if (!file) return;
		const reader = new FileReader();
		reader.onload = (ev) => {
			const text = ev.target.result;
			try {
				if (/\.json$/i.test(file.name)) {
					let parsed = JSON.parse(text);
					if (!Array.isArray(parsed)) parsed = [parsed];
					queue = parsed;
				} else {
					// CSV
					const lines = String(text).trim().split(/\r?\n/);
					const headers = lines[0].split(',').map((h) => h.trim());
					queue = lines
						.slice(1)
						.map((line) => {
							const values = line.split(',').map((v) => v.trim());
							const obj = {};
							headers.forEach((h, i) => (obj[h] = values[i] || ''));
							return {
								name: obj.name || obj.Name || '',
								description: obj.description || obj.Description || '',
								services: [
									{
										name: obj.serviceType || obj.type || 'web',
										endpoint: obj.endpoint || obj.url || '',
									},
								],
							};
						})
						.filter((a) => a.name && a.services[0].endpoint);
				}
				renderPreview();
			} catch (err) {
				ctx.toast('Invalid file format: ' + err.message, true);
			}
		};
		reader.readAsText(file);
	};

	input.addEventListener('change', (e) => handleFile(e.target.files[0]));
	drop.addEventListener('dragover', (e) => {
		e.preventDefault();
		drop.classList.add('erc8004-file-drop--active');
	});
	drop.addEventListener('dragleave', () => drop.classList.remove('erc8004-file-drop--active'));
	drop.addEventListener('drop', (e) => {
		e.preventDefault();
		drop.classList.remove('erc8004-file-drop--active');
		handleFile(e.dataTransfer.files[0]);
	});

	body.querySelector('[data-role="clear"]').addEventListener('click', () => {
		queue = [];
		input.value = '';
		renderPreview();
	});

	body.querySelector('[data-role="run"]').addEventListener('click', async () => {
		const wallet = ctx.getWallet();
		if (!wallet) {
			ctx.toast('Connect a wallet first.', true);
			return;
		}
		if (!queue.length) return;

		const chainId = ctx.getChainId();
		const chain = CHAIN_META[chainId];
		if (!chain.testnet) {
			const proceed = window.confirm(
				`Batch register ${queue.length} agents on ${chain.name}? This uses real ${chain.currency.symbol}.`,
			);
			if (!proceed) return;
		}

		// Ensure we're on the target chain
		if (wallet.chainId !== chainId) {
			try {
				await switchChain(chainId);
				wallet.chainId = chainId;
			} catch (err) {
				ctx.toast('Chain switch rejected: ' + err.message, true);
				return;
			}
		}

		const { signer } = await ensureWallet();
		const registry = getIdentityRegistry(chainId, signer);
		const identityAddr = REGISTRY_DEPLOYMENTS[chainId].identityRegistry;

		progress.style.display = '';
		let success = 0;
		let failed = 0;
		const rows = listEl.querySelectorAll('.erc8004-batch-row');

		for (let i = 0; i < queue.length; i++) {
			const a = queue[i];
			const pct = ((i + 1) / queue.length) * 100;
			bar.style.width = pct.toFixed(0) + '%';
			status.textContent = `Processing ${i + 1}/${queue.length}: ${a.name || 'Agent'}`;
			const rowStatus = rows[i]?.querySelector('[data-role="row-status"]');
			if (rowStatus) rowStatus.textContent = 'signing…';

			try {
				const json = {
					type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
					name: a.name,
					description: a.description || '',
					services: a.services || [],
					active: true,
					registrations: [
						{
							agentId: 'PENDING',
							agentRegistry: `eip155:${chainId}:${identityAddr}`,
						},
					],
				};
				const uri =
					'data:application/json;base64,' +
					btoa(unescape(encodeURIComponent(JSON.stringify(json))));
				const tx = await registry['register(string)'](uri);
				if (rowStatus) rowStatus.textContent = 'confirming…';
				await tx.wait();
				success++;
				if (rowStatus) {
					rowStatus.innerHTML = `<a class="erc8004-link" href="${esc(
						txExplorerUrl(chainId, tx.hash),
					)}" target="_blank" rel="noopener">confirmed ↗</a>`;
				}
			} catch (err) {
				failed++;
				if (rowStatus) rowStatus.textContent = 'failed';
				if (err && (err.code === 'ACTION_REJECTED' || err.code === 4001)) {
					status.textContent = 'Batch cancelled by user.';
					break;
				}
			}
		}
		status.textContent = `Done! ${success} registered, ${failed} failed.`;
		ctx.toast(`Batch complete: ${success} registered.`, success === 0);
	});
}
