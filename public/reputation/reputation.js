/**
 * Reputation page — view agent scores and submit reviews.
 */

import { getReputation, getRecentReviews, submitReputation } from '../../src/erc8004/reputation.js';
import { JsonRpcProvider, BrowserProvider } from 'ethers';
import { REGISTRY_DEPLOYMENTS } from '../../src/erc8004/abi.js';

// ~seconds per block per chain
const BLOCK_TIME = {
	1: 12, 10: 2, 56: 3, 100: 5, 137: 2, 250: 1, 324: 1, 1284: 6,
	5000: 2, 8453: 2, 42161: 0.25, 42220: 5, 43114: 2, 59144: 2, 534352: 3,
	97: 3, 11155111: 12, 84532: 2, 421614: 0.25, 11155420: 2, 80002: 2, 43113: 2,
};

const CHAIN_NAMES = {
	1: 'Ethereum', 10: 'Optimism', 56: 'BSC', 100: 'Gnosis', 137: 'Polygon',
	250: 'Fantom', 324: 'zkSync Era', 1284: 'Moonbeam', 5000: 'Mantle', 8453: 'Base',
	42161: 'Arbitrum One', 42220: 'Celo', 43114: 'Avalanche', 59144: 'Linea', 534352: 'Scroll',
	97: 'BSC Testnet', 11155111: 'Ethereum Sepolia', 84532: 'Base Sepolia',
	421614: 'Arbitrum Sepolia', 11155420: 'Optimism Sepolia', 80002: 'Polygon Amoy', 43113: 'Avalanche Fuji',
};

const EXPLORER_BASE = {
	1: 'https://etherscan.io', 10: 'https://optimistic.etherscan.io', 56: 'https://bscscan.com',
	100: 'https://gnosisscan.io', 137: 'https://polygonscan.com', 250: 'https://ftmscan.com',
	324: 'https://explorer.zksync.io', 1284: 'https://moonscan.io', 5000: 'https://explorer.mantle.xyz',
	8453: 'https://basescan.org', 42161: 'https://arbiscan.io', 42220: 'https://explorer.celo.org',
	43114: 'https://snowscan.xyz', 59144: 'https://lineascan.build', 534352: 'https://scrollscan.com',
	97: 'https://testnet.bscscan.com', 11155111: 'https://sepolia.etherscan.io',
	84532: 'https://sepolia.basescan.org', 421614: 'https://sepolia.arbiscan.io',
	11155420: 'https://sepolia-optimism.etherscan.io', 80002: 'https://amoy.polygonscan.com',
	43113: 'https://testnet.snowtrace.io',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function getChainName(chainId) { return CHAIN_NAMES[chainId] || `Chain ${chainId}`; }

function getExplorerUrl(chainId, txHash) {
	const base = EXPLORER_BASE[chainId];
	return base ? `${base}/tx/${txHash}` : null;
}

function truncateAddress(addr) {
	if (!addr || addr.length < 10) return addr;
	return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function escapeHtml(text) {
	const div = document.createElement('div');
	div.textContent = text;
	return div.innerHTML;
}

// Convert 0–100 contract score to 1–5 star count
function scoreToStars(score) {
	if (!score || score <= 0) return 0;
	return Math.max(1, Math.min(5, Math.round(score / 20)));
}

// Render filled/empty star SVGs
function starsHtml(stars, size = 16) {
	let out = '<span class="rep-stars-row" aria-hidden="true">';
	for (let i = 1; i <= 5; i++) {
		out += `<svg width="${size}" height="${size}" viewBox="0 0 20 20" class="rep-star ${i <= stars ? 'filled' : 'empty'}">
			<path d="M10 1l2.39 4.84 5.34.78-3.87 3.77.91 5.32L10 13.27l-4.77 2.51.91-5.32L2.27 6.62l5.34-.78z"/>
		</svg>`;
	}
	out += '</span>';
	return out;
}

// Color identicon from address
function identiconHtml(address) {
	if (!address) return '';
	let hash = 0;
	for (let i = 0; i < address.length; i++) {
		hash = ((hash << 5) - hash + address.charCodeAt(i)) | 0;
	}
	const hue = Math.abs(hash) % 360;
	const initials = address.slice(2, 4).toUpperCase();
	return `<span class="rep-identicon" style="--hue:${hue}">${initials}</span>`;
}

// Estimate time-ago from block number
function timeAgo(blockNumber, currentBlock, chainId) {
	if (!currentBlock || !blockNumber) return null;
	const blocksSince = currentBlock - blockNumber;
	if (blocksSince < 0) return null;
	const secs = blocksSince * (BLOCK_TIME[chainId] || 12);
	if (secs < 60) return 'just now';
	if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
	if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
	if (secs < 86400 * 30) return `${Math.round(secs / 86400)}d ago`;
	return `${Math.round(secs / (86400 * 30))}mo ago`;
}

async function resolveENS(address, provider) {
	try { return await provider.resolveName(address); } catch { return null; }
}

// ── URL parsing ───────────────────────────────────────────────────────────────

function parseAgentId() {
	const params = new URLSearchParams(window.location.search);
	const agentParam = params.get('agent');
	if (!agentParam) return null;

	const parts = agentParam.split(':');
	if (parts.length !== 2) throw new Error('Invalid agent format. Expected ?agent=<chainId>:<agentId>');

	const chainId = Number(parts[0]);
	const agentId = Number(parts[1]);
	if (!chainId || !agentId) throw new Error('Invalid agent ID or chain ID');

	return { chainId, agentId };
}

// ── Lookup form ───────────────────────────────────────────────────────────────

function showLookupForm(appEl) {
	appEl.innerHTML = `
		<div class="rep-lookup-wrap">
			<h1>Agent Reputation</h1>
			<p class="rep-lookup-sub">View and submit on-chain reviews for any registered agent.</p>
			<div class="rep-lookup-form">
				<div class="rep-form-group">
					<label for="lookup-chain">Network</label>
					<select id="lookup-chain">
						<option value="1">Ethereum</option>
						<option value="137">Polygon</option>
						<option value="8453" selected>Base</option>
						<option value="42161">Arbitrum One</option>
						<option value="10">Optimism</option>
						<option value="11155111">Ethereum Sepolia</option>
						<option value="84532">Base Sepolia</option>
						<option value="421614">Arbitrum Sepolia</option>
					</select>
				</div>
				<div class="rep-form-group">
					<label for="lookup-agent">Agent ID</label>
					<input type="number" id="lookup-agent" placeholder="e.g. 42" min="1" />
				</div>
				<button id="lookup-btn" class="rep-submit-btn">View Reputation</button>
			</div>
		</div>
	`;

	const btn = document.getElementById('lookup-btn');
	const agentInput = document.getElementById('lookup-agent');
	const chainSelect = document.getElementById('lookup-chain');

	function go() {
		const id = agentInput.value.trim();
		if (!id || Number(id) < 1) { agentInput.focus(); return; }
		window.location.search = `?agent=${chainSelect.value}:${id}`;
	}

	btn.addEventListener('click', go);
	agentInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
}

// ── Skeleton loading ──────────────────────────────────────────────────────────

function showSkeleton(appEl) {
	const card = () => `
		<div class="rep-skeleton-card">
			<div class="rep-skel rep-skel-row">
				<div class="rep-skel rep-skel-avatar"></div>
				<div class="rep-skel rep-skel-name"></div>
				<div class="rep-skel rep-skel-badge"></div>
			</div>
			<div class="rep-skel rep-skel-line" style="width:90%"></div>
			<div class="rep-skel rep-skel-line" style="width:65%"></div>
		</div>`;
	appEl.innerHTML = `
		<div class="rep-breadcrumb">
			<a href="/marketplace.html">Marketplace</a>
			<span class="rep-breadcrumb-sep">/</span>
			<span>Reputation</span>
		</div>
		<div class="rep-skel-header">
			<div class="rep-skel rep-skel-title"></div>
			<div class="rep-skel rep-skel-meta"></div>
		</div>
		<div class="rep-skel-stats">
			${[1,2,3].map(() => `<div class="rep-skel-stat"><div class="rep-skel rep-skel-stat-val"></div><div class="rep-skel rep-skel-stat-lbl"></div></div>`).join('')}
		</div>
		<div class="rep-skel-reviews">
			${[1,2,3].map(card).join('')}
		</div>
	`;
}

// ── API ───────────────────────────────────────────────────────────────────────

async function fetchAgentInfo(agentId) {
	try {
		const r = await fetch(`/api/agents/${agentId}`);
		if (!r.ok) return null;
		return await r.json();
	} catch { return null; }
}

// ── Main render ───────────────────────────────────────────────────────────────

async function main() {
	const appEl = document.querySelector('#app');

	try {
		const parsed = parseAgentId();
		if (!parsed) { showLookupForm(appEl); return; }

		const { chainId, agentId } = parsed;
		showSkeleton(appEl);

		if (!REGISTRY_DEPLOYMENTS[chainId]) {
			appEl.innerHTML = `
				<div class="rep-unsupported-chain">
					<h3>Network not supported</h3>
					<p>On-chain reputation is not available on ${getChainName(chainId)} (chain ID ${chainId}).</p>
					<p>Supported: Ethereum, Polygon, Base, Arbitrum, and testnets.</p>
					<a href="/reputation" class="rep-submit-btn" style="display:inline-block;margin-top:1rem;text-decoration:none">Try another network</a>
				</div>`;
			return;
		}

		const rpcUrl = `https://rpc.${chainId}.io`;
		const provider = new JsonRpcProvider(rpcUrl);

		const [agentInfo, repData, reviews, currentBlock] = await Promise.all([
			fetchAgentInfo(agentId),
			getReputation({ agentId, runner: provider, chainId }),
			getRecentReviews({ agentId, runner: provider, chainId, fromBlock: 0 }),
			provider.getBlockNumber().catch(() => null),
		]);

		const allReviews = reviews.slice().reverse();
		const agentName = agentInfo?.name || `Agent #${agentId}`;
		const avgStars = scoreToStars(repData.average);

		// Build review HTML for a given list
		const ensCache = new Map();
		const ensPromises = allReviews.map(async (rev) => {
			if (!ensCache.has(rev.from)) {
				ensCache.set(rev.from, resolveENS(rev.from, provider).catch(() => null));
			}
			return { review: rev, name: await ensCache.get(rev.from) };
		});
		const reviewsWithENS = await Promise.all(ensPromises);

		function renderReviews(list) {
			if (!list.length) return `<div class="rep-empty">No reviews in this category.</div>`;
			return list.map(({ review, name }) => {
				const displayName = name || truncateAddress(review.from);
				const explorerUrl = getExplorerUrl(chainId, review.txHash);
				const stars = scoreToStars(review.score);
				const ts = timeAgo(review.blockNumber, currentBlock, chainId);
				return `
					<div class="rep-review-item">
						<div class="rep-review-header">
							<div class="rep-reviewer-info">
								${identiconHtml(review.from)}
								<span class="rep-reviewer">${escapeHtml(displayName)}</span>
							</div>
							<div class="rep-review-right">
								${starsHtml(stars, 14)}
								<span class="rep-score-num">${review.score}/100</span>
							</div>
						</div>
						${review.comment ? `<div class="rep-comment">${escapeHtml(review.comment)}</div>` : ''}
						<div class="rep-review-footer">
							${ts ? `<span>${ts}</span>` : ''}
							${explorerUrl ? `<a href="${explorerUrl}" target="_blank" rel="noopener">view tx</a>` : ''}
						</div>
					</div>`;
			}).join('');
		}

		const positive = reviewsWithENS.filter(r => r.review.score >= 60);
		const critical  = reviewsWithENS.filter(r => r.review.score < 40);

		// Share URL + X tweet text
		const shareUrl = window.location.href;
		const tweetText = encodeURIComponent(
			`Check out the on-chain reputation for ${agentName} on @trythreews — ${repData.count} reviews, avg score ${repData.average.toFixed(0)}/100\n${shareUrl}`
		);
		const tweetUrl = `https://x.com/intent/tweet?text=${tweetText}`;

		const html = `
			<div class="rep-breadcrumb">
				<a href="/marketplace.html">Marketplace</a>
				<span class="rep-breadcrumb-sep">/</span>
				<span>Reputation</span>
			</div>

			<div class="rep-header">
				<div class="rep-header-left">
					<h1>${escapeHtml(agentName)}</h1>
					<div class="rep-header-meta">${getChainName(chainId)} · ID ${agentId}</div>
				</div>
				<div class="rep-header-actions">
					<a href="${tweetUrl}" target="_blank" rel="noopener" class="rep-action-btn rep-tweet-btn" title="Share on X">
						<svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
						Share
					</a>
					<button class="rep-action-btn" id="copy-btn" title="Copy link">
						<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="3" r="1.5"/><circle cx="12" cy="13" r="1.5"/><circle cx="3" cy="8" r="1.5"/><line x1="10.6" y1="3.9" x2="4.4" y2="7.1"/><line x1="10.6" y1="12.1" x2="4.4" y2="8.9"/></svg>
						Copy link
					</button>
				</div>
			</div>

			<div class="rep-stats">
				<div class="rep-stat">
					<div class="rep-stat-label">Avg Rating</div>
					<div class="rep-stat-value">${repData.count ? repData.average.toFixed(0) : '—'}<span class="rep-stat-denom">${repData.count ? '/100' : ''}</span></div>
					<div class="rep-stars-stat">${starsHtml(avgStars, 15)}</div>
				</div>
				<div class="rep-stat">
					<div class="rep-stat-label">Reviews</div>
					<div class="rep-stat-value">${repData.count}</div>
					<div class="rep-stat-sub">${positive.length} positive · ${critical.length} critical</div>
				</div>
				<div class="rep-stat">
					<div class="rep-stat-label">Score bar</div>
					<div class="rep-score-meter">
						<div class="rep-score-meter-fill" style="width:${repData.count ? Math.min(100,repData.average) : 0}%;background:${repData.average >= 60 ? '#86efac' : repData.average >= 40 ? '#fde68a' : '#fca5a5'}"></div>
					</div>
					<div class="rep-stat-sub">${repData.count ? (repData.average >= 60 ? 'Good standing' : repData.average >= 40 ? 'Mixed reviews' : 'Poor standing') : 'No data yet'}</div>
				</div>
			</div>

			<div class="rep-reviews" id="reviews-section">
				<div class="rep-filter-tabs" role="tablist">
					<button class="rep-tab active" data-filter="all" role="tab" aria-selected="true">All <span class="rep-tab-count">${allReviews.length}</span></button>
					<button class="rep-tab" data-filter="positive" role="tab" aria-selected="false">Positive <span class="rep-tab-count">${positive.length}</span></button>
					<button class="rep-tab" data-filter="critical" role="tab" aria-selected="false">Critical <span class="rep-tab-count">${critical.length}</span></button>
				</div>
				<div id="review-list" class="rep-review-list">
					${allReviews.length === 0
						? `<div class="rep-empty">No reviews yet — be the first!</div>`
						: renderReviews(reviewsWithENS.slice(0, 20))}
				</div>
			</div>

			<div class="rep-submit-form">
				<h3>Submit a Review</h3>
				<div id="wallet-status" class="rep-form-hint">
					<button id="connect-wallet" class="rep-submit-btn">Connect Wallet</button>
				</div>
				<div id="form-container" style="display:none">
					<div class="rep-form-group">
						<label>Your Rating</label>
						<div class="rep-star-picker" id="star-picker" role="radiogroup" aria-label="Star rating">
							${[1,2,3,4,5].map(n => `
								<button class="rep-star-pick" data-stars="${n}" data-score="${n*20}" role="radio" aria-checked="false" title="${n} star${n>1?'s':''}">
									${starsHtml(n, 22)}
									<span class="rep-star-label">${['Terrible','Poor','Okay','Good','Excellent'][n-1]}</span>
								</button>`).join('')}
						</div>
						<input type="hidden" id="rep-rating" value="" />
					</div>
					<div class="rep-form-group">
						<label for="rep-comment">Comment <span class="rep-optional">(optional)</span></label>
						<textarea id="rep-comment" placeholder="What was your experience with this agent?" maxlength="280" rows="3"></textarea>
						<small><span id="char-count">0</span>/280</small>
					</div>
					<button id="submit-review" class="rep-submit-btn" disabled>Submit Review</button>
					<div id="form-message" style="display:none;margin-top:1rem"></div>
				</div>
			</div>
		`;

		appEl.innerHTML = html;

		// Filter tabs
		const reviewListEl = document.getElementById('review-list');
		const allData = { all: reviewsWithENS, positive, critical };
		document.querySelectorAll('.rep-tab').forEach(tab => {
			tab.addEventListener('click', () => {
				document.querySelectorAll('.rep-tab').forEach(t => {
					t.classList.remove('active');
					t.setAttribute('aria-selected', 'false');
				});
				tab.classList.add('active');
				tab.setAttribute('aria-selected', 'true');
				const filter = tab.dataset.filter;
				const list = allData[filter] || [];
				reviewListEl.innerHTML = renderReviews(list.slice(0, 20));
			});
		});

		// Copy link
		const copyBtn = document.getElementById('copy-btn');
		copyBtn.addEventListener('click', async () => {
			try { await navigator.clipboard.writeText(shareUrl); }
			catch {
				const ta = Object.assign(document.createElement('textarea'), { value: shareUrl });
				Object.assign(ta.style, { position: 'fixed', opacity: '0' });
				document.body.appendChild(ta);
				ta.select();
				document.execCommand('copy');
				document.body.removeChild(ta);
			}
			copyBtn.classList.add('copied');
			copyBtn.textContent = 'Copied!';
			setTimeout(() => {
				copyBtn.classList.remove('copied');
				copyBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="3" r="1.5"/><circle cx="12" cy="13" r="1.5"/><circle cx="3" cy="8" r="1.5"/><line x1="10.6" y1="3.9" x2="4.4" y2="7.1"/><line x1="10.6" y1="12.1" x2="4.4" y2="8.9"/></svg> Copy link`;
			}, 2000);
		});

		// Star picker
		const ratingInput = document.getElementById('rep-rating');
		const submitBtn = document.getElementById('submit-review');
		let ratingSelected = false;

		document.querySelectorAll('.rep-star-pick').forEach(btn => {
			btn.addEventListener('click', () => {
				document.querySelectorAll('.rep-star-pick').forEach(b => {
					b.classList.remove('selected');
					b.setAttribute('aria-checked', 'false');
				});
				btn.classList.add('selected');
				btn.setAttribute('aria-checked', 'true');
				ratingInput.value = btn.dataset.score;
				ratingSelected = true;
				submitBtn.disabled = false;
			});
		});

		// Comment char count
		const commentEl = document.getElementById('rep-comment');
		const charCount = document.getElementById('char-count');
		commentEl.addEventListener('input', () => { charCount.textContent = commentEl.value.length; });

		// Wallet + submit
		const connectBtn = document.getElementById('connect-wallet');
		const walletStatus = document.getElementById('wallet-status');
		const formContainer = document.getElementById('form-container');
		const formMessage = document.getElementById('form-message');
		let connectedAddress = null;

		connectBtn.addEventListener('click', async () => {
			try {
				if (typeof window.ethereum === 'undefined') throw new Error('No wallet found. Install MetaMask to submit a review.');
				const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
				connectedAddress = accounts[0];

				const alreadyReviewed = allReviews.some(r => r.from.toLowerCase() === connectedAddress.toLowerCase());
				if (alreadyReviewed) {
					walletStatus.innerHTML = `<div class="rep-info-box">You have already reviewed this agent.</div>`;
					return;
				}

				walletStatus.innerHTML = `
					<div class="rep-wallet-connected">
						${identiconHtml(connectedAddress)}
						<span>${truncateAddress(connectedAddress)}</span>
					</div>`;
				formContainer.style.display = '';
			} catch (err) {
				walletStatus.innerHTML = `<div class="rep-error"><p>${escapeHtml(err.message)}</p></div>`;
			}
		});

		submitBtn.addEventListener('click', async () => {
			if (!connectedAddress || !ratingSelected) return;

			const score = Number(ratingInput.value);
			const comment = commentEl.value.trim();

			submitBtn.disabled = true;
			submitBtn.textContent = 'Submitting…';
			formMessage.style.display = 'none';

			try {
				if (typeof window.ethereum === 'undefined') throw new Error('No wallet found.');
				const signer = await new BrowserProvider(window.ethereum).getSigner();
				const txHash = await submitReputation({ agentId, score, comment, signer, chainId });

				formMessage.innerHTML = `
					<div class="rep-success">
						Review submitted!
						${getExplorerUrl(chainId, txHash) ? `<a href="${getExplorerUrl(chainId, txHash)}" target="_blank" rel="noopener">View transaction</a>` : ''}
					</div>`;
				formMessage.style.display = '';
				formContainer.style.display = 'none';
			} catch (err) {
				formMessage.innerHTML = `<div class="rep-error"><p>${escapeHtml(err.message || 'Submission failed')}</p></div>`;
				formMessage.style.display = '';
				submitBtn.disabled = false;
				submitBtn.textContent = 'Submit Review';
			}
		});

	} catch (err) {
		console.error('Failed to load reputation:', err);
		appEl.innerHTML = `
			<div class="rep-error">
				<h3>Error</h3>
				<p>${escapeHtml(err.message)}</p>
				<button onclick="location.reload()">Retry</button>
			</div>`;
	}
}

main();
