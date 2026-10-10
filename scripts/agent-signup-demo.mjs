// Signs up a throwaway agent against a running server using a fresh Ed25519 key,
// then replays the request and sends a skewed one. Usage:
//   node scripts/agent-signup-demo.mjs [baseUrl]    (default http://localhost:3000)
import { ed25519 } from '@noble/curves/ed25519.js';
import bs58mod from 'bs58';
import { buildSignupMessage } from '../api/_lib/agent-signup.js';

const bs58 = bs58mod.default || bs58mod;
const base = process.argv[2] || 'http://localhost:3000';
const priv = ed25519.utils.randomSecretKey();
const publicKey = bs58.encode(ed25519.getPublicKey(priv));

function payload({ timestamp = Math.floor(Date.now() / 1000), nonce = bs58.encode(crypto.getRandomValues(new Uint8Array(16))), name = 'Demo Scout' } = {}) {
	const message = buildSignupMessage({ publicKey, name, timestamp, nonce });
	const signature = bs58.encode(ed25519.sign(new TextEncoder().encode(message), priv));
	return { public_key: publicKey, name, timestamp, nonce, signature };
}
async function post(body) {
	const res = await fetch(`${base}/api/v1/agents/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
	return { status: res.status, body: await res.json() };
}

const skewed = await post(payload({ timestamp: Math.floor(Date.now() / 1000) - 3600 }));
console.log('skewed  ->', skewed.status, skewed.body.error, skewed.body.error_description);

const good = payload();
const first = await post(good);
const d = first.body.data;
console.log('signup  ->', first.status, d ? { agent: d.agent.id, solana: d.agent.wallets.solana, mode: d.mode, key: d.credentials.api_key_prefix, scope: d.credentials.scope } : first.body);
const replay = await post(good);
console.log('replay  ->', replay.status, replay.body.error);
const again = await post(payload());
console.log('same key, new nonce ->', again.status, again.body.error);
if (d) console.log('AGENT_ID=' + d.agent.id + '\nCLAIM=' + d.claim.code);
