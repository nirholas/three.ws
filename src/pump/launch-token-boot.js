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
			if (rawAgent?.meta?.token?.mint) return; // already launched

			const btn = document.getElementById('agent-stage-launch');
			if (!btn) return;
			btn.hidden = false;
			btn.addEventListener('click', () => {
				openLaunchTokenModal({
					agentId,
					agentName: identity.name,
					imageUrl:
						rawAgent.avatar_thumbnail_url || rawAgent.meta?.thumbnail_url || '',
				});
			});
		})
		.catch(() => {});
}

if (window.__agentReady) {
	_mount();
} else {
	window.addEventListener('agent:ready', _mount, { once: true });
}
