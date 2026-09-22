/**
 * Agent Wallet hub: Credits tab (self-funded inference).
 *
 * Owner-only. The agent pays for its own model usage: move USDC from this
 * wallet into the account's credits (previewed, then confirmed), cap what the
 * agent's model calls may burn per day and per month, and arm the automatic
 * top-up that keeps it running. The whole surface is the shared credits tile
 * (src/inference-credits.js), which the agent page also mounts compactly and
 * links back here with #credits.
 */

import { registerWalletTab } from '../registry.js';
import { mountInferenceCredits } from '../../inference-credits.js';

registerWalletTab({
	id: 'credits',
	label: 'Credits',
	order: 47,
	ownerOnly: true,
	mount({ panel, ctx }) {
		const host = document.createElement('div');
		panel.appendChild(host);
		const tile = mountInferenceCredits(host, { agentId: ctx.agentId });
		// The mount already loaded once; later visits to the tab re-read it.
		let shown = false;
		return {
			onShow: () => {
				if (shown) tile.refresh();
				shown = true;
			},
			destroy: () => tile.destroy(),
		};
	},
});
