import { keccak_256 } from '@noble/hashes/sha3';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** EIP-55: convert a hex EVM address to its checksummed form. */
function toChecksumAddress(address) {
  const addr = address.replace(/^0x/i, '').toLowerCase();
  const hash = keccak_256(new TextEncoder().encode(addr));
  let result = '0x';
  for (let i = 0; i < addr.length; i++) {
    const nibble = hash[Math.floor(i / 2)];
    const bit = i % 2 === 0 ? (nibble >> 4) & 0xf : nibble & 0xf;
    result += bit >= 8 ? addr[i].toUpperCase() : addr[i];
  }
  return result;
}

function toBase58(bytes) {
  let n = BigInt('0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(''));
  let result = '';
  const base = BigInt(58);
  while (n > 0n) {
    result = BASE58_ALPHABET[Number(n % base)] + result;
    n /= base;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    result = '1' + result;
  }
  return result;
}

/**
 * Connect a Solana wallet and sign an arbitrary message.
 * @param {string} message
 * @returns {Promise<{address: string, signature: string}>}
 */
export async function signMessageSolana(message) {
  if (!window.solana) throw new Error('No Solana wallet found. Install Phantom or a compatible wallet.');
  await window.solana.connect();
  const address = window.solana.publicKey.toString();
  const bytes = new TextEncoder().encode(message);
  const result = await window.solana.signMessage(bytes);
  // Phantom returns { signature: Uint8Array }; some wallets return Uint8Array directly
  const sigBytes = result.signature || result;
  return { address, signature: toBase58(sigBytes) };
}

/**
 * Connect an EVM wallet and sign an arbitrary message (personal_sign).
 * @param {string} message
 * @returns {Promise<{address: string, signature: string}>}
 */
export async function signMessageEVM(message) {
  if (!window.ethereum) throw new Error('No EVM wallet found. Install MetaMask or a compatible wallet.');
  const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
  const address = toChecksumAddress(accounts[0]);
  const signature = await window.ethereum.request({
    method: 'personal_sign',
    params: [message, address],
  });
  return { address, signature };
}

/**
 * Returns the current user if a valid session exists, otherwise null.
 * @returns {Promise<object|null>}
 */
export async function getCurrentUser() {
  const res = await fetch('/api/auth/me', { credentials: 'include' });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`Failed to fetch current user: ${res.status}`);
  const { user } = await res.json();
  return user;
}

/**
 * Destroys the session cookie.
 * @returns {Promise<void>}
 */
export async function signOut() {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  } catch (_) {}
}

/**
 * Sign in with an EVM wallet via EIP-4361 (SIWE).
 * Requires window.ethereum (MetaMask, injected wallet).
 * @returns {Promise<{user: object, wallet: object}>}
 * @throws {Error} if no wallet, user rejects, or server rejects
 */
export async function signInWithEVM() {
  if (!window.ethereum) throw new Error('No EVM wallet found. Install MetaMask or a compatible wallet.');

  const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
  const address = toChecksumAddress(accounts[0]);
  const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
  const chainId = parseInt(chainIdHex, 16);

  const nonceRes = await fetch('/api/auth/siwe/nonce', { credentials: 'include' });
  if (!nonceRes.ok) throw new Error(`Failed to get SIWE nonce: ${nonceRes.status}`);
  const { nonce, csrf, issuedAt } = await nonceRes.json();

  const host = window.location.host;
  const origin = window.location.origin;
  const message = [
    `${host} wants you to sign in with your Ethereum account:`,
    address,
    '',
    'Sign in to three.ws.',
    '',
    `URI: ${origin}`,
    'Version: 1',
    `Chain ID: ${chainId}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ].join('\n');

  const signature = await window.ethereum.request({
    method: 'personal_sign',
    params: [message, address],
  });

  const verifyRes = await fetch('/api/auth/siwe/verify', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
    body: JSON.stringify({ message, signature }),
  });
  if (!verifyRes.ok) {
    const text = await verifyRes.text().catch(() => verifyRes.status.toString());
    throw new Error(`SIWE verification failed: ${text}`);
  }
  const { user } = await verifyRes.json();
  return { user, wallet: { type: 'evm', address, chainId } };
}

/**
 * Sign in with a Solana wallet via SIWS (CAIP-122).
 * Requires window.solana (Phantom or compatible).
 * @returns {Promise<{user: object, wallet: object}>}
 * @throws {Error} if no wallet, user rejects, or server rejects
 */
export async function signInWithSolana() {
  if (!window.solana) throw new Error('No Solana wallet found. Install Phantom or a compatible wallet.');

  await window.solana.connect();
  const address = window.solana.publicKey.toString();

  const nonceRes = await fetch('/api/auth/siws/nonce', { credentials: 'include' });
  if (!nonceRes.ok) throw new Error(`Failed to get SIWS nonce: ${nonceRes.status}`);
  const { nonce, csrf, issuedAt } = await nonceRes.json();

  const host = window.location.host;
  const origin = window.location.origin;
  const message = [
    `${host} wants you to sign in with your Solana account:`,
    address,
    '',
    'Sign in to three.ws.',
    '',
    `URI: ${origin}`,
    'Version: 1',
    'Chain ID: mainnet',
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ].join('\n');

  const bytes = new TextEncoder().encode(message);
  const { signature: sigBytes } = await window.solana.signMessage(bytes);
  const signature = toBase58(sigBytes);

  const verifyRes = await fetch('/api/auth/siws/verify', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
    body: JSON.stringify({ message, signature }),
  });
  if (!verifyRes.ok) {
    const text = await verifyRes.text().catch(() => verifyRes.status.toString());
    throw new Error(`SIWS verification failed: ${text}`);
  }
  const { user } = await verifyRes.json();
  return { user, wallet: { type: 'solana', address } };
}
