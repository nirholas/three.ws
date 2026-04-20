/**
 * tip-jar/skill.js  — trusted-main-thread UI skill
 *
 * Attaches a "Tip the creator" button to the agent's chat UI and executes an
 * ERC-7710 delegation redemption to transfer USDC directly to agent.ownerAddress.
 *
 * Runtime dependencies loaded lazily (tasks 10 + 13 must be deployed):
 *   /src/runtime/delegation-redeem.js  → redeemFromSkill
 *   /src/permissions/grant-modal.js    → openGrantModal
 *
 * Host contract (provided by the embedding runtime):
 *   host.attachAction({ id, label, icon, handler, oneShot? })
 *   host.speak(text)
 *   host.showMessage(text)
 *   host.isOwner   — true when the current viewer owns this agent
 */

/** USDC contract addresses indexed by EVM chainId. */
const USDC_BY_CHAIN = {
	84532: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', // Base Sepolia
	8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // Base mainnet
};

const TIP_OPTIONS = [1, 5, 10]; // USDC display amounts
const USDC_DECIMALS = 6;

// ── Pure helper ──────────────────────────────────────────────────────────────

/**
 * Build ERC-20 transfer calldata without any external dependency.
 *
 * Equivalent to:
 *   new Interface(['function transfer(address,uint256)'])
 *     .encodeFunctionData('transfer', [recipient, amountBaseUnits])
 *
 * ABI encoding:
 *   selector  = keccak256("transfer(address,uint256)")[0..4] = 0xa9059cbb
 *   arg[0]    = recipient address, zero-padded left to 32 bytes
 *   arg[1]    = amountBaseUnits as big-endian uint256, zero-padded to 32 bytes
 *
 * @param {string} tokenAddr     ERC-20 contract address (checksummed or lower)
 * @param {string} recipient     Destination address
 * @param {string|bigint} amountBaseUnits  Token-native units (e.g. 5000000 for 5 USDC)
 * @returns {{ to: string, value: string, data: string }}
 */
export function buildERC20Transfer(tokenAddr, recipient, amountBaseUnits) {
	const addr = recipient.replace(/^0x/i, '').toLowerCase().padStart(64, '0');
	const amt = BigInt(amountBaseUnits).toString(16).padStart(64, '0');
	return {
		to: tokenAddr,
		value: '0x0',
		data: '0xa9059cbb' + addr + amt,
	};
}

// ── Skill lifecycle ──────────────────────────────────────────────────────────

/**
 * Called once when the skill is installed into an agent session.
 * Attaches the tip button to the agent's action bar.
 *
 * @param {{ agent: Object, host: Object }} ctx
 */
export async function setup({ agent, host }) {
	host.attachAction({
		id: 'tip-jar:tip',
		label: 'Tip the creator',
		icon: '💝',
		handler: () => execute({ agent, host, args: {} }),
	});
}

/**
 * Invoked when the viewer clicks "Tip the creator".
 *
 * @param {{ agent: Object, host: Object, args: Object }} ctx
 */
export async function execute({ agent, host, args: _args }) {
	const chainId = agent.chainId ?? 84532;
	const usdcAddr = USDC_BY_CHAIN[chainId];

	if (!usdcAddr) {
		_notify(host, `Chain ${chainId} is not supported for tipping.`);
		return;
	}

	// 1. Ask viewer for amount
	const amount = await _pickAmount();
	if (amount === null) return; // cancelled

	const amountBase = String(BigInt(Math.round(amount)) * BigInt(10 ** USDC_DECIMALS));
	const call = buildERC20Transfer(usdcAddr, agent.ownerAddress, amountBase);

	// 2. Lazy-load delegation-redeem (task 13)
	let redeemFromSkill;
	try {
		({ redeemFromSkill } = await import('/src/runtime/delegation-redeem.js'));
	} catch {
		_notify(host, 'Tipping is not available yet on this install.');
		return;
	}

	// 3. Execute the delegated transfer
	try {
		const result = await redeemFromSkill({
			agentId: agent.id,
			chainId,
			skillId: 'tip-jar',
			calls: [call],
			mode: 'auto',
		});

		if (!result.ok) {
			const err = new Error(result.error);
			err.code = result.error;
			throw err;
		}

		// 4. Success
		host.speak('Thank you for the tip!');
		_emitTipReceived(agent, amount, result.txHash);
		_notify(host, `Tip sent! Tx: ${result.txHash}`);
	} catch (err) {
		const code = err.code ?? err.message;

		if (code === 'delegation_not_found' || code === 'no_delegation') {
			await _handleNoDelegation({ agent, host, chainId, usdcAddr });
		} else if (code === 'scope_exceeded') {
			_notify(host, 'Daily tipping cap reached — try again tomorrow.');
		} else {
			_notify(host, `Tip failed: ${code}`);
		}
	}
}

// ── Private helpers ──────────────────────────────────────────────────────────

/** Render a small amount-picker modal; resolves with the chosen number or null on cancel. */
function _pickAmount() {
	return new Promise((resolve) => {
		const overlay = document.createElement('div');
		overlay.className = 'tip-jar-overlay';
		overlay.innerHTML = `
			<div class="tip-jar-modal">
				<p class="tip-jar-title">Choose a tip amount</p>
				<div class="tip-jar-options">
					${TIP_OPTIONS.map((v) => `<button class="tip-jar-btn" data-v="${v}">${v} USDC</button>`).join('')}
				</div>
				<input
					class="tip-jar-custom"
					type="number"
					min="0.01"
					max="10"
					step="1"
					placeholder="Custom (max 10 USDC)"
				/>
				<div class="tip-jar-footer">
					<button class="tip-jar-send" disabled>Send tip</button>
					<button class="tip-jar-cancel">Cancel</button>
				</div>
			</div>
		`;
		document.body.appendChild(overlay);

		const sendBtn = overlay.querySelector('.tip-jar-send');
		const cancelBtn = overlay.querySelector('.tip-jar-cancel');
		const customInput = overlay.querySelector('.tip-jar-custom');
		let selected = null;

		const select = (val) => {
			selected = val;
			overlay
				.querySelectorAll('.tip-jar-btn')
				.forEach((b) => b.classList.toggle('selected', Number(b.dataset.v) === val));
			sendBtn.disabled = false;
		};

		overlay.querySelectorAll('.tip-jar-btn').forEach((btn) =>
			btn.addEventListener('click', () => {
				customInput.value = '';
				select(Number(btn.dataset.v));
			}),
		);

		customInput.addEventListener('input', () => {
			const val = parseFloat(customInput.value);
			if (val > 0 && val <= 10) {
				overlay
					.querySelectorAll('.tip-jar-btn')
					.forEach((b) => b.classList.remove('selected'));
				select(val);
			} else {
				selected = null;
				sendBtn.disabled = true;
			}
		});

		const done = (val) => {
			document.body.removeChild(overlay);
			resolve(val);
		};
		sendBtn.addEventListener('click', () => done(selected));
		cancelBtn.addEventListener('click', () => done(null));
	});
}

/**
 * Handle the no-delegation error path.
 * - Non-owner: display friendly copy.
 * - Owner: surface a one-shot "Grant tipping" action that opens the grant modal.
 */
async function _handleNoDelegation({ agent, host, chainId, usdcAddr }) {
	const baseMsg = "The creator hasn't enabled tipping on this device yet.";

	if (!host.isOwner) {
		_notify(host, baseMsg);
		return;
	}

	// Owner only: load grant modal (task 10)
	let openGrantModal;
	try {
		({ openGrantModal } = await import('/src/permissions/grant-modal.js'));
	} catch {
		_notify(host, `${baseMsg} (Grant modal not available — task 10 pending.)`);
		return;
	}

	host.attachAction({
		id: 'tip-jar:grant',
		label: 'Grant tipping',
		icon: '🔑',
		oneShot: true,
		handler: () =>
			openGrantModal({
				agentId: agent.id,
				chainId,
				preset: {
					token: usdcAddr,
					maxAmount: '10000000',
					period: 'daily',
					targets: [usdcAddr],
					expiry_days: 30,
				},
			}),
	});

	_notify(host, `${baseMsg} Click "Grant tipping" to enable it.`);
}

/** Emit tip.received on the global protocol bus (non-fatal if unavailable). */
function _emitTipReceived(agent, amountUsdc, txHash) {
	try {
		const bus = globalThis.__agentProtocol ?? globalThis.VIEWER?.agent_protocol;
		if (bus) {
			bus.emit({
				type: 'tip.received',
				payload: { agentId: agent.id, amountUsdc, txHash },
				agentId: agent.id,
				sourceSkill: 'tip-jar',
			});
		}
	} catch {
		/* protocol is optional */
	}
}

/** Surface a message via host.showMessage if available, otherwise log. */
function _notify(host, text) {
	if (typeof host?.showMessage === 'function') host.showMessage(text);
	else console.info('[tip-jar]', text);
}
