/**
 * Solana Blinks / Actions skills
 * --------------------------------
 * Wraps @solana/actions so an agent can:
 *   - parse a Solana Action (blink) URL → describe what it does
 *   - execute a blink action → build + sign + send transaction
 *
 * Blinks are shareable links that encode on-chain actions. A GET request
 * to the action URL returns metadata (title, description, buttons); a POST
 * with the user's wallet returns a transaction ready to sign.
 *
 * Wallet: uses the same Phantom/Backpack/Solflare detection as pump skills.
 * No keys held here. All signing is delegated to the injected wallet.
 */

import { detectSolanaWallet, SOLANA_RPC } from './erc8004/solana-deploy.js';

const ACTIONS_IDENTITY_HEADER = 'x-blockchain-ids';
const DEFAULT_NETWORK = 'mainnet';

async function requireWallet() {
	const wallet = detectSolanaWallet();
	if (!wallet) throw new Error('No Solana wallet detected. Install Phantom or Backpack.');
	const pubkey = await wallet.connect();
	return { wallet, pubkey };
}

async function fetchAction(url) {
	const r = await fetch(url, {
		headers: { Accept: 'application/json', 'x-action-version': '2.4', 'x-blockchain-ids': 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' },
	});
	if (!r.ok) throw new Error(`Action fetch failed: ${r.status} ${r.statusText}`);
	const data = await r.json();
	if (data.error) throw new Error(data.error.message || 'Action returned an error');
	return data;
}

function summarizeAction(action) {
	const title = action.title || '(no title)';
	const description = action.description || '';
	const links = action.links?.actions || [];
	const buttons = links.map((l) => `"${l.label}"`).join(', ');
	const parts = [`**${title}**`];
	if (description) parts.push(description);
	if (buttons) parts.push(`Available actions: ${buttons}`);
	if (action.disabled) parts.push('⚠️ This action is currently disabled.');
	return parts.join('\n');
}

/**
 * Register Solana Blinks / Actions skills onto an AgentSkills instance.
 * @param {import('./agent-skills.js').AgentSkills} skills
 */
export function registerBlinksSkills(skills) {
	// ── blink-parse ─────────────────────────────────────────────────────────
	skills.register({
		name: 'blink-parse',
		description: 'Parse a Solana Action (blink) URL and describe what it does.',
		instruction:
			'Fetches action metadata from the given URL and returns a human-readable summary of the title, description, and available action buttons.',
		animationHint: 'curiosity',
		voicePattern: 'Let me read that blink for you…',
		mcpExposed: true,
		inputSchema: {
			type: 'object',
			properties: {
				url: {
					type: 'string',
					description: 'A Solana Action URL (https://… or solana-action:…)',
				},
			},
			required: ['url'],
		},
		handler: async (args) => {
			let actionUrl = String(args?.url || '').trim();
			if (!actionUrl) return { success: false, output: 'url is required', sentiment: -0.2 };

			// Strip the solana-action: protocol wrapper if present
			if (actionUrl.startsWith('solana-action:')) {
				actionUrl = decodeURIComponent(actionUrl.slice('solana-action:'.length));
			}

			try {
				const action = await fetchAction(actionUrl);
				const summary = summarizeAction(action);
				return {
					success: true,
					output: summary,
					sentiment: 0.2,
					data: {
						title: action.title,
						description: action.description,
						icon: action.icon,
						label: action.label,
						disabled: action.disabled ?? false,
						actions: action.links?.actions || [],
					},
				};
			} catch (err) {
				return {
					success: false,
					output: `Could not parse blink: ${err.message}`,
					sentiment: -0.3,
				};
			}
		},
	});

	// ── blink-execute ────────────────────────────────────────────────────────
	skills.register({
		name: 'blink-execute',
		description: 'Execute a Solana Action blink — build the transaction, sign with the connected wallet, and broadcast it.',
		instruction:
			'POSTs to the action href with the connected wallet address to obtain a transaction, signs it with the browser wallet, and sends it.',
		animationHint: 'gesture',
		voicePattern: 'Executing blink action…',
		mcpExposed: true,
		inputSchema: {
			type: 'object',
			properties: {
				url: {
					type: 'string',
					description: 'The action href from a parsed blink (https://…)',
				},
				params: {
					type: 'object',
					description: 'Optional key-value pairs to substitute into URL template parameters (e.g. { amount: "1.5" })',
				},
				network: {
					type: 'string',
					enum: ['mainnet', 'devnet'],
					default: 'mainnet',
				},
			},
			required: ['url'],
		},
		handler: async (args) => {
			let actionHref = String(args?.url || '').trim();
			if (!actionHref) return { success: false, output: 'url is required', sentiment: -0.2 };
			if (actionHref.startsWith('solana-action:')) {
				actionHref = decodeURIComponent(actionHref.slice('solana-action:'.length));
			}

			const network = args.network || DEFAULT_NETWORK;

			// Substitute URL template params like {amount}
			if (args.params && typeof args.params === 'object') {
				for (const [k, v] of Object.entries(args.params)) {
					actionHref = actionHref.replace(
						new RegExp(`\\{${k}\\}`, 'g'),
						encodeURIComponent(String(v)),
					);
				}
			}

			try {
				const { wallet, pubkey } = await requireWallet();
				const [{ VersionedTransaction, Transaction, Connection }, { parseURL, serializeTransaction }] =
					await Promise.all([
						import('@solana/web3.js'),
						import('@solana/actions'),
					]);

				// POST to action endpoint with the user's account
				const postResp = await fetch(actionHref, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						Accept: 'application/json',
						'x-action-version': '2.4',
						'x-blockchain-ids': 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
					},
					body: JSON.stringify({ account: pubkey.toBase58() }),
				});
				if (!postResp.ok) {
					const txt = await postResp.text().catch(() => postResp.status.toString());
					throw new Error(`Action POST failed: ${postResp.status} — ${txt}`);
				}
				const result = await postResp.json();
				if (result.error) throw new Error(result.error.message || 'Action returned error');
				if (!result.transaction) throw new Error('Action returned no transaction');

				const rpcUrl = SOLANA_RPC[network] || SOLANA_RPC[DEFAULT_NETWORK];
				const connection = new Connection(rpcUrl, 'confirmed');

				// Deserialize, sign, send
				const txBytes = Buffer.from(result.transaction, 'base64');
				let tx;
				try {
					tx = VersionedTransaction.deserialize(txBytes);
				} catch {
					tx = Transaction.from(txBytes);
				}

				const signed = await wallet.signTransaction(tx);
				const raw = signed.serialize();
				const sig = await connection.sendRawTransaction(raw, { skipPreflight: false });
				await connection.confirmTransaction(sig, 'confirmed');

				const message = result.message || 'Action executed successfully.';
				return {
					success: true,
					output: `${message}\nSignature: ${sig}`,
					sentiment: 0.7,
					data: { signature: sig, network, message },
				};
			} catch (err) {
				return {
					success: false,
					output: `Blink execution failed: ${err.message}`,
					sentiment: -0.4,
				};
			}
		},
	});
}
