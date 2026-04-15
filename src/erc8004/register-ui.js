/**
 * ERC-8004 Agent Registration UI.
 *
 * Renders the registration form and drives the registerAgent() flow.
 * Uses plain DOM (consistent with the rest of the project).
 */

import { registerAgent, connectWallet } from './agent-registry.js';
import { isPrivyConfigured } from './privy.js';

export class RegisterUI {
	/**
	 * @param {HTMLElement} containerEl  Parent element to mount into.
	 * @param {function} [onRegistered] Callback after successful registration.
	 */
	constructor(containerEl, onRegistered) {
		this.container = containerEl;
		this.onRegistered = onRegistered || (() => {});
		this.walletAddress = null;
		this.selectedFile = null;

		this._build();
		this._bind();
	}

	// -----------------------------------------------------------------------
	// DOM
	// -----------------------------------------------------------------------

	_build() {
		this.el = document.createElement('div');
		this.el.className = 'erc8004-register';
		this.el.innerHTML = `
			<div class="erc8004-card">
				<h2 class="erc8004-title">Register 3D Agent</h2>
				<p class="erc8004-subtitle">Mint your avatar as an ERC-8004 on-chain agent</p>

				<!-- Step 1: Connect wallet -->
				<div class="erc8004-section" data-step="wallet">
					<button class="erc8004-btn erc8004-btn--connect" type="button">
						<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><path d="M1 10h22"/></svg>
						${isPrivyConfigured() ? 'Connect Wallet' : 'Connect Wallet'}
					</button>
					<p class="erc8004-wallet-hint">${isPrivyConfigured() ? 'MetaMask, WalletConnect, Coinbase, or email' : 'Requires MetaMask or compatible wallet'}</p>
					<span class="erc8004-wallet-addr"></span>
				</div>

				<!-- Step 2: Agent details -->
				<div class="erc8004-section" data-step="details">
					<label class="erc8004-label">
						Agent Name
						<input type="text" class="erc8004-input" name="agentName" placeholder="e.g. Alpha-Agent-01" maxlength="64" required />
					</label>

					<label class="erc8004-label">
						Description
						<textarea class="erc8004-input erc8004-textarea" name="agentDesc" placeholder="What does this agent do?" maxlength="500" rows="3"></textarea>
					</label>

					<label class="erc8004-label">
						3D Avatar (GLB)
						<div class="erc8004-file-drop" id="erc8004-file-drop">
							<input type="file" accept=".glb,.gltf" class="erc8004-file-input" />
							<span class="erc8004-file-text">Drop .glb file or click to browse</span>
						</div>
					</label>

					<label class="erc8004-label">
						IPFS API Token
						<input type="password" class="erc8004-input" name="ipfsToken" placeholder="web3.storage or Filebase token" />
					</label>
				</div>

				<!-- Step 3: Register -->
				<div class="erc8004-section" data-step="submit">
					<button class="erc8004-btn erc8004-btn--register" type="button" disabled>
						Register Agent On-Chain
					</button>
				</div>

				<!-- Status log -->
				<div class="erc8004-log"></div>

				<!-- Result -->
				<div class="erc8004-result" style="display:none">
					<div class="erc8004-result-inner">
						<span class="erc8004-checkmark">&#10003;</span>
						<h3>Agent Registered!</h3>
						<dl class="erc8004-result-dl">
							<dt>Agent ID</dt>  <dd class="erc8004-res-id"></dd>
							<dt>IPFS CID</dt>  <dd class="erc8004-res-cid"></dd>
							<dt>Tx Hash</dt>   <dd class="erc8004-res-tx"></dd>
						</dl>
						<button class="erc8004-btn erc8004-btn--view" type="button">View in 3D</button>
					</div>
				</div>
			</div>
		`;
		this.container.appendChild(this.el);
	}

	_bind() {
		const $ = (sel) => this.el.querySelector(sel);

		// Connect wallet
		$('.erc8004-btn--connect').addEventListener('click', async () => {
			try {
				const { address, chainId } = await connectWallet();
				this.walletAddress = address;
				$('.erc8004-wallet-addr').textContent =
					address.slice(0, 6) + '...' + address.slice(-4) + ` (chain ${chainId})`;
				$('.erc8004-btn--connect').textContent = 'Connected';
				$('.erc8004-btn--connect').disabled = true;
				this._checkReady();
			} catch (err) {
				this._log('Wallet error: ' + err.message, true);
			}
		});

		// File input
		const fileInput = $('.erc8004-file-input');
		const fileDrop = $('#erc8004-file-drop');

		fileInput.addEventListener('change', (e) => {
			this.selectedFile = e.target.files[0] || null;
			this._updateFileLabel();
		});

		fileDrop.addEventListener('dragover', (e) => {
			e.preventDefault();
			fileDrop.classList.add('erc8004-file-drop--active');
		});
		fileDrop.addEventListener('dragleave', () => {
			fileDrop.classList.remove('erc8004-file-drop--active');
		});
		fileDrop.addEventListener('drop', (e) => {
			e.preventDefault();
			fileDrop.classList.remove('erc8004-file-drop--active');
			const file = e.dataTransfer.files[0];
			if (file && /\.(glb|gltf)$/i.test(file.name)) {
				this.selectedFile = file;
				this._updateFileLabel();
			}
		});

		// Register
		$('.erc8004-btn--register').addEventListener('click', () => this._doRegister());

		// View result
		$('.erc8004-btn--view').addEventListener('click', () => {
			const cid = $('.erc8004-res-cid').textContent;
			window.location.hash = `model=ipfs://${cid}`;
			window.location.reload();
		});
	}

	_updateFileLabel() {
		const label = this.el.querySelector('.erc8004-file-text');
		label.textContent = this.selectedFile ? this.selectedFile.name : 'Drop .glb file or click to browse';
		this._checkReady();
	}

	_checkReady() {
		const btn = this.el.querySelector('.erc8004-btn--register');
		const name = this.el.querySelector('[name="agentName"]').value.trim();
		btn.disabled = !(this.walletAddress && this.selectedFile && name.length > 0);
	}

	_log(msg, isError = false) {
		const log = this.el.querySelector('.erc8004-log');
		const line = document.createElement('div');
		line.className = 'erc8004-log-line' + (isError ? ' erc8004-log-error' : '');
		line.textContent = msg;
		log.appendChild(line);
		log.scrollTop = log.scrollHeight;
	}

	async _doRegister() {
		const $ = (sel) => this.el.querySelector(sel);
		const name = $('[name="agentName"]').value.trim();
		const description = $('[name="agentDesc"]').value.trim();
		const apiToken = $('[name="ipfsToken"]').value.trim();
		const registerBtn = $('.erc8004-btn--register');

		registerBtn.disabled = true;
		registerBtn.textContent = 'Registering...';

		try {
			const result = await registerAgent({
				glbFile: this.selectedFile,
				name,
				description,
				apiToken: apiToken || undefined,
				onStatus: (msg) => this._log(msg),
			});

			// Show result
			$('.erc8004-res-id').textContent = result.agentId;
			$('.erc8004-res-cid').textContent = result.registrationCID;
			$('.erc8004-res-tx').textContent = result.txHash;
			$('.erc8004-result').style.display = '';
			this._log('Registration complete!');

			this.onRegistered(result);
		} catch (err) {
			this._log('Registration failed: ' + err.message, true);
			registerBtn.disabled = false;
			registerBtn.textContent = 'Register Agent On-Chain';
		}
	}

	/** Remove the UI from the DOM. */
	destroy() {
		this.el.remove();
	}
}
