// Client-side wallet authentication.
// Used by /login and /register pages. Supports two paths:
//   1. Privy — email/social/wallet login with auto-created embedded wallets
//   2. Raw MetaMask/SIWE — direct Sign-In with Ethereum for existing wallets
//
// Loaded as a module from login.html — imports from CDN so it works outside Vite.

import { BrowserProvider } from 'https://esm.sh/ethers@6.16.0';

const params = new URLSearchParams(location.search);
const next = params.get('next') || '/dashboard/';

// Privy app id comes from /api/config (backed by PRIVY_APP_ID env var). The
// meta tag is a local-dev fallback — prod should rely on the fetched config.
let PRIVY_APP_ID = document.querySelector('meta[name="privy-app-id"]')?.content || '';
const configReady = fetch('/api/config', { credentials: 'omit' })
	.then((r) => r.ok ? r.json() : null)
	.then((cfg) => { if (cfg?.privyAppId) PRIVY_APP_ID = cfg.privyAppId; })
	.catch(() => {});

// ── UI helpers ──────────────────────────────────────────────────────────────

function ui() {
	const walletBtn = document.getElementById('wallet');
	const privyBtn  = document.getElementById('privy');
	const err       = document.getElementById('err');
	return {
		walletBtn, privyBtn, err,
		setErr: (m) => { if (err) { err.textContent = m; err.style.display = 'block'; } },
		clearErr: () => { if (err) { err.style.display = 'none'; } },
	};
}

// ── Privy login (primary path) ─────────────────────────────────────────────
// Privy handles email + social + wallet login. On success it provides an
// EIP-1193 provider (embedded or external) which we SIWE-verify against our
// backend exactly like a raw MetaMask login.

async function signInWithPrivy() {
	const { privyBtn, setErr, clearErr } = ui();
	await configReady;
	if (!PRIVY_APP_ID) { setErr('Privy not configured.'); return; }

	clearErr();
	if (privyBtn) { privyBtn.disabled = true; privyBtn.textContent = 'Loading Privy…'; }

	try {
		const mod = await import('https://esm.sh/@privy-io/js-sdk-core@latest');
		const PrivyClient = mod.PrivyClient || mod.default;
		const privy = new PrivyClient({ appId: PRIVY_APP_ID });

		if (privyBtn) privyBtn.textContent = 'Opening login…';
		await privy.login({ loginMethods: ['wallet', 'email', 'google'] });

		if (privyBtn) privyBtn.textContent = 'Connecting wallet…';
		const eip1193 = await privy.getEthereumProvider();
		if (!eip1193) throw new Error('No wallet provider returned by Privy.');

		const provider = new BrowserProvider(eip1193);
		await completeSignIn(provider, privyBtn);
	} catch (e) {
		const msg = e?.message || String(e);
		setErr(msg === 'user rejected action' || msg.includes('cancelled') ? 'Login cancelled.' : msg);
		if (privyBtn) { privyBtn.disabled = false; privyBtn.textContent = 'Sign in with Privy'; }
	}
}

// ── Raw MetaMask / SIWE (fallback path) ────────────────────────────────────

async function signInWithWallet() {
	const { walletBtn, setErr, clearErr } = ui();

	if (!window.ethereum) {
		setErr('No wallet detected. Install MetaMask or another Ethereum wallet.');
		return;
	}

	clearErr();
	if (walletBtn) { walletBtn.disabled = true; walletBtn.textContent = 'Connecting…'; }
	const original = walletBtn?.innerHTML;

	try {
		const provider = new BrowserProvider(window.ethereum);
		await provider.send('eth_requestAccounts', []);
		await completeSignIn(provider, walletBtn);
	} catch (e) {
		const msg = e?.info?.error?.message || e?.message || String(e);
		setErr(msg === 'user rejected action' ? 'Signature cancelled.' : msg);
		if (walletBtn) { walletBtn.disabled = false; walletBtn.innerHTML = original; }
	}
}

// ── Shared SIWE flow ───────────────────────────────────────────────────────
// Both Privy and raw wallet paths use this to complete the login.

async function completeSignIn(provider, btn) {
	const signer  = await provider.getSigner();
	const address = await signer.getAddress();
	const network = await provider.getNetwork();
	const chainId = Number(network.chainId);

	if (btn) btn.textContent = 'Requesting nonce…';
	const nonceRes = await fetch('/api/auth/siwe/nonce', { credentials: 'include' });
	if (!nonceRes.ok) throw new Error('Failed to get nonce');
	const { nonce, csrf } = await nonceRes.json();

	const domain = location.host;
	const uri    = location.origin;
	const issuedAt      = new Date().toISOString();
	const expirationTime = new Date(Date.now() + 5 * 60 * 1000).toISOString();

	const message = [
		`${domain} wants you to sign in with your Ethereum account:`,
		address,
		'',
		'Sign in to three.ws. This does not cost anything and proves wallet ownership.',
		'',
		`URI: ${uri}`,
		'Version: 1',
		`Chain ID: ${chainId}`,
		`Nonce: ${nonce}`,
		`Issued At: ${issuedAt}`,
		`Expiration Time: ${expirationTime}`,
	].join('\n');

	if (btn) btn.textContent = 'Check your wallet…';
	const signature = await signer.signMessage(message);

	if (btn) btn.textContent = 'Verifying…';
	const verifyRes = await fetch('/api/auth/siwe/verify', {
		method: 'POST',
		credentials: 'include',
		headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
		body: JSON.stringify({ message, signature }),
	});
	const data = await verifyRes.json();
	if (!verifyRes.ok) throw new Error(data.error_description || 'Verification failed');

	try { localStorage.setItem('3dagent:auth-hint', JSON.stringify({ authed: true, ts: Date.now() })); } catch { /* ignore */ }
	location.href = next;
}

// ── Bind buttons ────────────────────────────────────────────────────────────

const walletBtn = document.getElementById('wallet');
const privyBtn  = document.getElementById('privy');

if (walletBtn) walletBtn.addEventListener('click', signInWithWallet);
if (privyBtn)  privyBtn.addEventListener('click', signInWithPrivy);
