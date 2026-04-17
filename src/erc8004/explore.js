/**
 * Public explore page — a cross-chain gallery of ERC-8004 agents that resolve
 * to a 3D avatar. Entry point is `/explore`.
 *
 * Flow:
 *   1. For each supported chain, scan recent `Registered` events.
 *   2. Fetch the registration JSON behind each agent's URI.
 *   3. Keep only entries where `findAvatar3D(metadata)` returns a URL.
 *   4. Render a grid of cards linking to `/a/<chainId>/<agentId>`.
 *
 * No wallet required — uses public RPCs from CHAIN_META. Scans are bounded
 * (`blocks`, `limitPerChain`) so a single open of the page doesn't blow up
 * public endpoints. Metadata fetches run concurrently with a cap.
 */

import { supportedChainIds, CHAIN_META } from './chain-meta.js';
import { listRegisteredEvents, fetchAgentMetadata, findAvatar3D } from './queries.js';

const SCAN_BLOCKS       = 250000;
const LIMIT_PER_CHAIN   = 25;
const METADATA_CONCURRENCY = 6;

function esc(s) {
	return String(s ?? '').replace(/[&<>"']/g, (c) => ({
		'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
	}[c]));
}

/**
 * Render the explore page into `container`. Takes over that element.
 * @param {HTMLElement} container
 */
export async function renderExplorePage(container) {
	container.innerHTML = `
		<div class="explore-head">
			<h1>Explore on-chain 3D agents</h1>
			<p class="explore-sub">Every card below is an ERC-8004 agent whose registration metadata points at a 3D avatar. Click to load it in the viewer.</p>
			<div class="explore-meta" id="explore-meta">Scanning chains…</div>
		</div>
		<div class="explore-grid" id="explore-grid"></div>
		<div class="explore-foot" id="explore-foot"></div>
	`;

	const grid = container.querySelector('#explore-grid');
	const meta = container.querySelector('#explore-meta');
	const foot = container.querySelector('#explore-foot');

	const chains = supportedChainIds();
	let scanned = 0;
	let found = 0;

	const updateStatus = () => {
		meta.textContent = `Scanned ${scanned}/${chains.length} chains · ${found} live 3D agents`;
	};
	updateStatus();

	// Run chains in parallel — event queries on different RPCs are independent.
	await Promise.all(chains.map(async (chainId) => {
		const chainMeta = CHAIN_META[chainId];
		try {
			const events = await listRegisteredEvents({
				chainId,
				blocks: SCAN_BLOCKS,
				limit: LIMIT_PER_CHAIN,
			});
			await runWithConcurrency(events, METADATA_CONCURRENCY, async (ev) => {
				const meta = await fetchAgentMetadata(ev.agentURI);
				if (!meta.ok) return;
				const glb = findAvatar3D(meta.data);
				if (!glb) return;
				found += 1;
				renderCard(grid, {
					chainId,
					chainName: chainMeta?.shortName || chainMeta?.name || String(chainId),
					agentId: ev.agentId.toString(),
					owner: ev.owner,
					metadata: meta.data,
					glb,
				});
				updateStatus();
			});
		} catch (err) {
			console.warn(`[explore] chain ${chainId} scan failed:`, err.message);
		} finally {
			scanned += 1;
			updateStatus();
		}
	}));

	if (found === 0) {
		foot.innerHTML = `
			<p>No 3D agents indexed yet on the scanned window.</p>
			<p><a href="/deploy" class="explore-cta">Deploy yours →</a></p>
		`;
	} else {
		foot.innerHTML = `<p><a href="/deploy" class="explore-cta">Deploy your agent on-chain →</a></p>`;
	}
}

function renderCard(grid, { chainId, chainName, agentId, owner, metadata, glb }) {
	const card = document.createElement('a');
	card.className = 'explore-card';
	card.href = `/a/${chainId}/${agentId}`;

	const name = metadata.name ? String(metadata.name) : `Agent #${agentId}`;
	const desc = metadata.description ? String(metadata.description).slice(0, 140) : '';
	const img = typeof metadata.image === 'string' ? metadata.image : '';
	const thumbHtml = img
		? `<div class="explore-card__thumb" style="background-image:url('${esc(resolveUri(img))}')"></div>`
		: `<div class="explore-card__thumb explore-card__thumb--none">3D</div>`;

	card.innerHTML = `
		${thumbHtml}
		<div class="explore-card__body">
			<div class="explore-card__name">${esc(name)}</div>
			<div class="explore-card__chain">${esc(chainName)} · #${esc(agentId)}</div>
			${desc ? `<div class="explore-card__desc">${esc(desc)}</div>` : ''}
		</div>
	`;
	grid.appendChild(card);
}

function resolveUri(uri) {
	if (!uri) return '';
	if (uri.startsWith('ipfs://')) return 'https://ipfs.io/ipfs/' + uri.slice(7);
	if (uri.startsWith('ar://')) return 'https://arweave.net/' + uri.slice(5);
	return uri;
}

async function runWithConcurrency(items, limit, fn) {
	const iterator = items[Symbol.iterator]();
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		for (const item of iterator) {
			try { await fn(item); } catch { /* swallow per-item */ }
		}
	});
	await Promise.all(workers);
}
