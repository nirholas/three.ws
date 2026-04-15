// Client-side Sign-In with Ethereum (EIP-4361).
// Used by /login and /register pages to authenticate without a password.
// Loaded as a module from /public/login.html — ethers is pulled from a CDN
// ESM build so this file works outside the Vite bundler's entry graph.

import { BrowserProvider } from 'https://esm.sh/ethers@6.16.0';

const params = new URLSearchParams(location.search);
const next = params.get('next') || '/dashboard/';

async function signInWithWallet() {
	const btn = document.getElementById('wallet');
	const err = document.getElementById('err');
	const setErr = (m) => { if (err) { err.textContent = m; err.style.display = 'block'; } };
	const clearErr = () => { if (err) { err.style.display = 'none'; } };

	if (!window.ethereum) {
		setErr('No wallet detected. Install MetaMask or another Ethereum wallet.');
		return;
	}

	clearErr();
	btn.disabled = true;
	const original = btn.innerHTML;
	btn.textContent = 'Connecting…';

	try {
		const provider = new BrowserProvider(window.ethereum);
		const accounts = await provider.send('eth_requestAccounts', []);
		if (!accounts?.[0]) throw new Error('No accounts returned from wallet');

		const signer  = await provider.getSigner();
		const address = await signer.getAddress();
		const network = await provider.getNetwork();
		const chainId = Number(network.chainId);

		btn.textContent = 'Requesting nonce…';
		const nonceRes = await fetch('/api/auth/siwe/nonce', { credentials: 'include' });
		if (!nonceRes.ok) throw new Error('Failed to get nonce');
		const { nonce } = await nonceRes.json();

		const domain = location.host;
		const uri    = location.origin;
		const issuedAt      = new Date().toISOString();
		const expirationTime = new Date(Date.now() + 5 * 60 * 1000).toISOString();

		const message = [
			`${domain} wants you to sign in with your Ethereum account:`,
			address,
			'',
			'Sign in to 3D Agent. This does not cost anything and proves wallet ownership.',
			'',
			`URI: ${uri}`,
			'Version: 1',
			`Chain ID: ${chainId}`,
			`Nonce: ${nonce}`,
			`Issued At: ${issuedAt}`,
			`Expiration Time: ${expirationTime}`,
		].join('\n');

		btn.textContent = 'Check your wallet…';
		const signature = await signer.signMessage(message);

		btn.textContent = 'Verifying…';
		const verifyRes = await fetch('/api/auth/siwe/verify', {
			method: 'POST',
			credentials: 'include',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ message, signature }),
		});
		const data = await verifyRes.json();
		if (!verifyRes.ok) throw new Error(data.error_description || 'Verification failed');

		location.href = next;
	} catch (e) {
		const msg = e?.info?.error?.message || e?.message || String(e);
		setErr(msg === 'user rejected action' ? 'Signature cancelled.' : msg);
		btn.disabled = false;
		btn.innerHTML = original;
	}
}

const btn = document.getElementById('wallet');
if (btn) btn.addEventListener('click', signInWithWallet);
