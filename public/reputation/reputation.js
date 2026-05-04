/**
 * Reputation page logic — view agent scores and submit reviews.
 * Imports from src/erc8004/reputation.js for contract interactions.
 */

import { getReputation, getRecentReviews, submitReputation } from '../../src/erc8004/reputation.js';
import { JsonRpcProvider, BrowserProvider } from 'ethers';
import { REGISTRY_DEPLOYMENTS } from '../../src/erc8004/abi.js';

const CHAIN_NAMES = {
	1: 'Ethereum',
	10: 'Optimism',
	56: 'BSC',
	100: 'Gnosis',
	137: 'Polygon',
	250: 'Fantom',
	324: 'zkSync Era',
	1284: 'Moonbeam',
	5000: 'Mantle',
	8453: 'Base',
	42161: 'Arbitrum One',
	42220: 'Celo',
	43114: 'Avalanche',
	59144: 'Linea',
	534352: 'Scroll',
	97: 'BSC Testnet',
	11155111: 'Ethereum Sepolia',
	84532: 'Base Sepolia',
	421614: 'Arbitrum Sepolia',
	11155420: 'Optimism Sepolia',
	80002: 'Polygon Amoy',
	43113: 'Avalanche Fuji',
};

function getChainName(chainId) {
	return CHAIN_NAMES[chainId] || `Chain ${chainId}`;
}

function getExplorerUrl(chainId, txHash) {
	const base = {
		1: 'https://etherscan.io',
		10: 'https://optimistic.etherscan.io',
		56: 'https://bscscan.com',
		100: 'https://gnosisscan.io',
		137: 'https://polygonscan.com',
		250: 'https://ftmscan.com',
		324: 'https://explorer.zksync.io',
		1284: 'https://moonscan.io',
		5000: 'https://explorer.mantle.xyz',
		8453: 'https://basescan.org',
		42161: 'https://arbiscan.io',
		42220: 'https://explorer.celo.org',
		43114: 'https://snowscan.xyz',
		59144: 'https://lineascan.build',
		534352: 'https://scrollscan.com',
		97: 'https://testnet.bscscan.com',
		11155111: 'https://sepolia.etherscan.io',
		84532: 'https://sepolia.basescan.org',
		421614: 'https://sepolia.arbiscan.io',
		11155420: 'https://sepolia-optimism.etherscan.io',
		80002: 'https://amoy.polygonscan.com',
		43113: 'https://testnet.snowtrace.io',
	}[chainId];
	return base ? `${base}/tx/${txHash}` : null;
}

function parseAgentId() {
	const params = new URLSearchParams(window.location.search);
	const agentParam = params.get('agent');

	if (!agentParam) {
		return null;
	}

	const parts = agentParam.split(':');
	if (parts.length !== 2) {
		throw new Error('Invalid agent format. Expected ?agent=<chainId>:<agentId>');
	}

	const chainId = Number(parts[0]);
	const agentId = Number(parts[1]);

	if (!chainId || !agentId) {
		throw new Error('Invalid agent ID or chain ID');
	}

	return { chainId, agentId };
}

function showLookupForm(appEl) {
	appEl.innerHTML = `
		<div class="rep-lookup-wrap">
			<h1>Agent Reputation</h1>
			<p class="rep-lookup-sub">View and submit on-chain reviews for any registered agent.</p>
			<div class="rep-lookup-form">
				<div class="rep-form-group">
					<label for="lookup-chain">Network</label>
					<select id="lookup-chain">
						<option value="1">Ethereum (1)</option>
						<option value="137">Polygon (137)</option>
						<option value="8453" selected>Base (8453)</option>
						<option value="42161">Arbitrum One (42161)</option>
						<option value="10">Optimism (10)</option>
						<option value="11155111">Ethereum Sepolia (11155111)</option>
						<option value="84532">Base Sepolia (84532)</option>
						<option value="421614">Arbitrum Sepolia (421614)</option>
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
		const agentId = agentInput.value.trim();
		const chainId = chainSelect.value;
		if (!agentId || Number(agentId) < 1) {
			agentInput.focus();
			return;
		}
		window.location.search = `?agent=${chainId}:${agentId}`;
	}

	btn.addEventListener('click', go);
	agentInput.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') go();
	});
}

async function fetchAgentInfo(agentId) {
	try {
		const response = await fetch(`/api/agents/${agentId}`);
		if (!response.ok) return null;
		return await response.json();
	} catch {
		return null;
	}
}

function truncateAddress(addr) {
	if (!addr || addr.length < 10) return addr;
	return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

async function resolveENS(address, provider) {
	try {
		return await provider.resolveName(address);
	} catch {
		return null;
	}
}

function formatScore(score) {
	if (typeof score === 'number') {
		return score.toFixed(1);
	}
	return '—';
}

function scoreBadge(score) {
	if (score > 0) return `<span class="rep-score-badge pos">+${score}</span>`;
	if (score < 0) return `<span class="rep-score-badge neg">${score}</span>`;
	return `<span class="rep-score-badge neu">0</span>`;
}

function scoreBarHtml(average) {
	if (typeof average !== 'number' || isNaN(average)) return '';
	const pct = Math.max(0, Math.min(100, ((average + 100) / 200) * 100));
	const color = average > 0 ? '#86efac' : average < 0 ? '#fca5a5' : 'rgba(255,255,255,0.3)';
	return `<div class="rep-score-bar"><div class="rep-score-fill" style="width:${pct}%;background:${color}"></div></div>`;
}

function formatDate() {
	return 'Recent';
}

async function main() {
	const appEl = document.querySelector('#app');

	try {
		const parsed = parseAgentId();
		if (!parsed) {
			showLookupForm(appEl);
			return;
		}
		const { chainId, agentId } = parsed;

		// Show loading state
		appEl.innerHTML = `
			<div class="rep-loading">
				<div class="spinner"></div>
				<p>Loading reputation…</p>
			</div>
		`;

		// Check if chain is supported
		if (!REGISTRY_DEPLOYMENTS[chainId]) {
			appEl.innerHTML = `
				<div class="rep-unsupported-chain">
					<h3>Network not supported</h3>
					<p>On-chain reputation is not available on ${getChainName(chainId)} (chain ID ${chainId}).</p>
					<p>Switch to Ethereum mainnet, Polygon, Base, or Arbitrum to view reputation.</p>
				</div>
			`;
			return;
		}

		// Get agent info from backend if available
		const agentInfo = await fetchAgentInfo(agentId);

		// Create provider for on-chain data
		const rpcUrl = REGISTRY_DEPLOYMENTS[chainId]?.rpcUrl || `https://rpc.${chainId}.io`;
		const provider = new JsonRpcProvider(rpcUrl);

		// Fetch reputation data
		const [repData, reviews] = await Promise.all([
			getReputation({ agentId, runner: provider, chainId }),
			getRecentReviews({ agentId, runner: provider, chainId, fromBlock: 0 }),
		]);

		// Reverse to show most recent first, limit to 20
		const recentReviews = reviews.reverse().slice(0, 20);

		// Render page
		const avgClass = repData.average > 0 ? 'positive' : repData.average < 0 ? 'negative' : '';
		let html = `
			<div class="rep-breadcrumb">
				<a href="/marketplace.html">Marketplace</a>
				<span class="rep-breadcrumb-sep">/</span>
				<span>Reputation</span>
			</div>

			<div class="rep-header">
				<div class="rep-header-left">
					<h1>${agentInfo?.name || `Agent #${agentId}`}</h1>
					<div class="rep-header-meta">${getChainName(chainId)} · ID ${agentId}</div>
				</div>
				<button class="rep-share-btn" id="share-btn" title="Copy link">
					<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="3" r="1.5"/><circle cx="12" cy="13" r="1.5"/><circle cx="3" cy="8" r="1.5"/><line x1="10.6" y1="3.9" x2="4.4" y2="7.1"/><line x1="10.6" y1="12.1" x2="4.4" y2="8.9"/></svg>
					Share
				</button>
			</div>

			<div class="rep-stats">
				<div class="rep-stat">
					<div class="rep-stat-label">Average Rating</div>
					<div class="rep-stat-value ${avgClass}">${formatScore(repData.average)}</div>
					${scoreBarHtml(repData.average)}
				</div>
				<div class="rep-stat">
					<div class="rep-stat-label">Reviews</div>
					<div class="rep-stat-value">${repData.count}</div>
				</div>
				<div class="rep-stat">
					<div class="rep-stat-label">Total Score</div>
					<div class="rep-stat-value ${avgClass}">${repData.total}</div>
				</div>
			</div>
		`;

		if (recentReviews.length === 0) {
			html += `
				<div class="rep-reviews">
					<div class="rep-empty">No reviews yet. Be the first to review this agent!</div>
				</div>
			`;
		} else {
			html += `
				<div class="rep-reviews">
					<h3>Recent Reviews <span class="rep-review-count">${recentReviews.length} shown</span></h3>
					<div class="rep-review-list">
			`;

			// Resolve ENS names in parallel
			const ensPromises = recentReviews.map(async (rev) => {
				const name = await resolveENS(rev.from, provider).catch(() => null);
				return { review: rev, name };
			});

			const reviewsWithENS = await Promise.all(ensPromises);

			reviewsWithENS.forEach(({ review, name }) => {
				const displayName = name || truncateAddress(review.from);
				const explorerUrl = getExplorerUrl(chainId, review.txHash);

				html += `
					<div class="rep-review-item">
						<div class="rep-review-header">
							<span class="rep-reviewer">${displayName}</span>
							${scoreBadge(review.score)}
						</div>
				`;

				if (review.comment) {
					html += `<div class="rep-comment">${escapeHtml(review.comment)}</div>`;
				}

				html += `
						<div class="rep-review-footer">
							<span>${formatDate()}</span>
				`;

				if (explorerUrl) {
					html += `<a href="${explorerUrl}" target="_blank" rel="noopener">view tx</a>`;
				}

				html += `
						</div>
					</div>
				`;
			});

			html += `
					</div>
				</div>
			`;
		}

		// Submit form
		html += `
			<div class="rep-submit-form">
				<h3>Submit a Review</h3>
				<div id="wallet-status" class="rep-form-hint">
					<button id="connect-wallet" class="rep-submit-btn">Connect Wallet</button>
				</div>
				<div id="form-container" style="display:none">
					<div class="rep-form-group">
						<label>Your Rating</label>
						<p class="rep-rating-hint">−100 (very bad) → 0 (neutral) → +100 (excellent)</p>
						<div class="rep-stars-input" id="rating-input"></div>
						<input type="hidden" id="rep-rating" value="0" />
					</div>
					<div class="rep-form-group">
						<label>Comment (optional)</label>
						<textarea id="rep-comment" placeholder="Share your feedback…" maxlength="280"></textarea>
						<small><span id="char-count">0</span>/280 characters</small>
					</div>
					<button id="submit-review" class="rep-submit-btn" disabled>Submit Review</button>
					<div id="form-message" style="display:none; margin-top:1rem"></div>
				</div>
			</div>
		`;

		appEl.innerHTML = html;

		// Share button
		const shareBtn = document.getElementById('share-btn');
		if (shareBtn) {
			shareBtn.addEventListener('click', async () => {
				const url = window.location.href;
				try {
					await navigator.clipboard.writeText(url);
				} catch {
					const ta = document.createElement('textarea');
					ta.value = url;
					ta.style.position = 'fixed';
					ta.style.opacity = '0';
					document.body.appendChild(ta);
					ta.select();
					document.execCommand('copy');
					document.body.removeChild(ta);
				}
				shareBtn.classList.add('copied');
				shareBtn.textContent = 'Copied!';
				setTimeout(() => {
					shareBtn.classList.remove('copied');
					shareBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="3" r="1.5"/><circle cx="12" cy="13" r="1.5"/><circle cx="3" cy="8" r="1.5"/><line x1="10.6" y1="3.9" x2="4.4" y2="7.1"/><line x1="10.6" y1="12.1" x2="4.4" y2="8.9"/></svg> Share`;
				}, 2000);
			});
		}

		// Wire up wallet connection
		const connectBtn = document.getElementById('connect-wallet');
		const walletStatus = document.getElementById('wallet-status');
		const formContainer = document.getElementById('form-container');
		const submitBtn = document.getElementById('submit-review');
		const ratingInput = document.getElementById('rating-input');
		const commentEl = document.getElementById('rep-comment');
		const charCount = document.getElementById('char-count');
		const formMessage = document.getElementById('form-message');

		// Create star buttons
		for (let i = -100; i <= 100; i += 20) {
			const btn = document.createElement('button');
			btn.className = 'rep-star-btn';
			btn.textContent = i >= 0 ? `+${i}` : `${i}`;
			btn.dataset.value = i;
			btn.addEventListener('click', () => {
				document
					.querySelectorAll('#rating-input button')
					.forEach((b) => b.classList.remove('selected'));
				btn.classList.add('selected');
				document.getElementById('rep-rating').value = i;
				submitBtn.disabled = false;
			});
			ratingInput.appendChild(btn);
		}

		commentEl.addEventListener('input', () => {
			charCount.textContent = commentEl.value.length;
		});

		let connectedAddress = null;

		connectBtn.addEventListener('click', async () => {
			try {
				if (typeof window.ethereum === 'undefined') {
					throw new Error('MetaMask not found. Please install it.');
				}

				const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
				connectedAddress = accounts[0];

				// Check if already reviewed
				const hasReviewed = recentReviews.some(
					(r) => r.from.toLowerCase() === connectedAddress.toLowerCase(),
				);
				if (hasReviewed) {
					walletStatus.innerHTML = `
						<div class="rep-error">
							<p>You've already reviewed this agent.</p>
						</div>
					`;
					formContainer.style.display = 'none';
					return;
				}

				walletStatus.innerHTML = `
					<p style="color:rgba(229,229,229,0.7)">
						Connected: <code style="font-family:monospace">${truncateAddress(connectedAddress)}</code>
					</p>
				`;
				formContainer.style.display = '';
				connectBtn.style.display = 'none';
			} catch (err) {
				formMessage.style.display = '';
				formMessage.className = 'rep-error';
				formMessage.innerHTML = `<p>${err.message}</p>`;
			}
		});

		submitBtn.addEventListener('click', async () => {
			if (!connectedAddress) {
				formMessage.innerHTML = '<p>Please connect your wallet first.</p>';
				formMessage.className = 'rep-error';
				formMessage.style.display = '';
				return;
			}

			const rating = Number(document.getElementById('rep-rating').value);
			const comment = commentEl.value.trim();

			if (!rating && rating !== 0) {
				formMessage.innerHTML = '<p>Please select a rating.</p>';
				formMessage.className = 'rep-error';
				formMessage.style.display = '';
				return;
			}

			try {
				submitBtn.disabled = true;
				submitBtn.textContent = 'Submitting…';

				if (typeof window.ethereum === 'undefined') {
					throw new Error('MetaMask not found.');
				}

				const signer = new BrowserProvider(window.ethereum).getSigner();
				const txHash = await submitReputation({
					agentId,
					score: Math.abs(rating),
					comment,
					signer: await signer,
					chainId,
				});

				formMessage.innerHTML = `
					<div class="rep-success">
						<p>Review submitted! <a href="${getExplorerUrl(chainId, txHash) || '#'}" target="_blank" rel="noopener">View transaction</a></p>
					</div>
				`;
				formMessage.style.display = '';
				formContainer.style.display = 'none';
				connectBtn.style.display = '';
				connectBtn.textContent = 'Submit Another?';
			} catch (err) {
				formMessage.innerHTML = `<p>${err.message || 'Submission failed'}</p>`;
				formMessage.className = 'rep-error';
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
				<p>${err.message}</p>
				<button onclick="location.reload()">Retry</button>
			</div>
		`;
	}
}

function escapeHtml(text) {
	const div = document.createElement('div');
	div.textContent = text;
	return div.innerHTML;
}

main();
