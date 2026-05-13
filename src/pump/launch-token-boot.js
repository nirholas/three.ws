/**
 * launch-token-boot.js — self-initializing module for the Launch Token button.
 *
 * Loaded as a standalone <script type="module"> in agent-home.html.
 * Uses the `agent:ready` event emitted at the end of main() to pick up
 * agentId + identity without touching the existing inline script.
 *
 * Pattern mirrors agent-home-orphans.js.
 */

import { openLaunchTokenModal } from './launch-token-modal.js';

function _mount() {
	const d = window.__agentReady;
	if (!d) return;
	const { agentId, identity } = d;
	if (!agentId) return;

	// Fetch raw agent to check ownership and mint status
	fetch(`/api/agents/${agentId}`, { credentials: 'include' })
		.then((r) => (r.ok ? r.json() : null))
		.then((data) => {
			const rawAgent = data?.agent || null;
			if (!rawAgent?.user_id) return; // not the owner

			const btn = document.getElementById('agent-stage-launch');
			if (!btn) return;

			if (rawAgent?.meta?.token?.mint) {
				// Token launched, show dashboard button
				btn.textContent = 'View Token Dashboard';
				btn.addEventListener('click', () => {
					window.open(`/pump-dashboard.html?agent=${agentId}`, '_blank');
				});
			} else {
				const imageUrl =
					rawAgent.avatar_thumbnail_url || rawAgent.meta?.thumbnail_url || '';
				const onchain = rawAgent.onchain || rawAgent.meta?.onchain || null;
				const needsDeploy = !onchain || onchain.family !== 'solana';

				btn.addEventListener('click', () => {
					openLaunchTokenModal({
						agentId,
						agentName: identity.name,
						imageUrl,
						needsDeploy,
						agentForDeploy: needsDeploy
							? {
									id: agentId,
									name: rawAgent.name || identity.name,
									description: rawAgent.description || '',
									avatar_id: rawAgent.avatar_id || null,
									skills: rawAgent.skills || undefined,
								}
							: null,
					});
				});
			}
			btn.hidden = false;
		})
		.catch(() => {});
}

if (window.__agentReady) {
	_mount();
} else {
	window.addEventListener('agent:ready', _mount, { once: true });
}
