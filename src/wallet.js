let connectedWalletAddress = null;
let listenersBound = false;

function getPhantom() {
	const provider = typeof window !== 'undefined' ? window.solana : null;
	return provider && provider.isPhantom ? provider : null;
}

function bindPhantomListeners(provider) {
	if (listenersBound || !provider) return;
	listenersBound = true;
	provider.on('connect', (publicKey) => {
		connectedWalletAddress = publicKey?.toString?.() || null;
		updateWalletState(connectedWalletAddress);
	});
	provider.on('disconnect', () => {
		connectedWalletAddress = null;
		updateWalletState(null);
	});
}

async function onConnectWallet() {
	const provider = getPhantom();
	if (!provider) {
		window.open('https://phantom.app/', '_blank', 'noopener');
		return;
	}
	bindPhantomListeners(provider);
	try {
		const res = await provider.connect();
		connectedWalletAddress = res?.publicKey?.toString?.() || null;
		updateWalletState(connectedWalletAddress);
	} catch (err) {
		console.error('Wallet connection failed:', err);
	}
}

export function updateWalletState(address) {
	const btn = document.getElementById('connect-wallet-btn');
	if (!btn) return;
	btn.textContent = address ? `${address.slice(0, 4)}...${address.slice(-4)}` : 'Connect Wallet';
}

export function initWalletButton() {
	const btn = document.getElementById('connect-wallet-btn');
	if (btn) btn.addEventListener('click', onConnectWallet);

	const provider = getPhantom();
	if (!provider) return;
	bindPhantomListeners(provider);
	provider.connect({ onlyIfTrusted: true })
		.then((res) => {
			connectedWalletAddress = res?.publicKey?.toString?.() || null;
			updateWalletState(connectedWalletAddress);
		})
		.catch(() => {});
}

export function getConnectedWallet() {
	const provider = getPhantom();
	return provider && provider.isConnected ? provider : null;
}

export function getConnectedWalletAddress() {
	return connectedWalletAddress;
}
