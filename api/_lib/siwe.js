// Shared EIP-4361 (SIWE) message parser.
// verify.js has its own copy — do not delete that one until it imports from here.

export function parseSiweMessage(msg) {
	const lines = msg.split('\n');
	if (lines.length < 6) return null;

	const header = lines[0];
	const m = /^([^\s]+) wants you to sign in with your Ethereum account:$/.exec(header);
	if (!m) return null;
	const domain = m[1];

	const address = (lines[1] || '').trim();
	if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return null;

	const out = { domain, address };
	for (let i = 2; i < lines.length; i++) {
		const line = lines[i];
		const kv = /^([A-Za-z -]+):\s*(.*)$/.exec(line);
		if (!kv) continue;
		const key = kv[1].trim();
		const val = kv[2].trim();
		switch (key) {
			case 'URI':
				out.uri = val;
				break;
			case 'Version':
				out.version = val;
				break;
			case 'Chain ID':
				out.chainId = parseInt(val, 10) || null;
				break;
			case 'Nonce':
				out.nonce = val;
				break;
			case 'Issued At':
				out.issuedAt = val;
				break;
			case 'Expiration Time':
				out.expirationTime = val;
				break;
			case 'Not Before':
				out.notBefore = val;
				break;
			case 'Request ID':
				out.requestId = val;
				break;
		}
	}
	if (!out.uri || !out.nonce || !out.version) return null;
	return out;
}
