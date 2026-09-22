// Total x402 charge for a (possibly batched) JSON-RPC MCP body.
//
// A single X-PAYMENT must cover EVERY priced tools/call the batch will execute.
// Pricing only the lone-call case (and letting multi-call batches fall back to
// the flat env default) let a caller run N priced tools — up to the batch cap —
// for one tool's price, a ~1000–3000× underpayment. We instead SUM the per-tool
// price across all tools/call so the advertised 402 amount, the verified
// payment, and the settled charge all equal the true cost of the batch.
//
// `priceForTool(name, args)` → atomic-unit price string for a tool, or null if
//                        free. `args` is the call's `params.arguments` so
//                        argument-dependent pricing (e.g. the 3D Studio's
//                        tier-priced text_to_3d) quotes the same number the
//                        settle path charges.
// `isFreeName(name)`   → true only for an explicitly public/free tool that may
//                        be served with no payment at all (e.g. getting_started).
//
// Returns { totalAmount, allFree }:
//   totalAmount — atomic-unit string sum of every priced call, or null if the
//                 batch is entirely free. Passed to authenticateRequest as the
//                 per-request x402 price.
//   allFree     — true when there is ≥1 tools/call, nothing is priced, and every
//                 call targets an explicit free/public tool → serve anonymously.
export function priceBatch(body, { priceForTool, isFreeName }) {
	const batch = Array.isArray(body) ? body : [body];
	const calls = batch
		.filter((m) => m && m.method === 'tools/call')
		.map((c) => ({
			name: typeof c?.params?.name === 'string' ? c.params.name : null,
			args: c?.params?.arguments,
		}));
	const names = calls.map((c) => c.name);

	let totalAtomic = 0n;
	for (const { name, args } of calls) {
		const atomic = name ? priceForTool(name, args) : null;
		if (!atomic) continue;
		try {
			totalAtomic += BigInt(atomic);
		} catch {
			// Non-numeric price string can't be summed; the dispatcher rejects the
			// call as unknown/invalid, so it never executes paid work uncharged.
		}
	}

	const totalAmount = totalAtomic > 0n ? totalAtomic.toString() : null;
	const allFree =
		names.length > 0 && totalAmount === null && names.every((n) => n && isFreeName(n));

	return { totalAmount, allFree };
}

// MCP lifecycle/discovery methods that carry no billable work. A batch made up
// ONLY of these is the "what is this server?" handshake — initialize,
// tools/list, ping, and the post-initialize notification. Serving it free of
// OAuth/x402 lets autonomous agents and registry crawlers read the tool
// catalog before deciding to pay; the catalog is public information anyway
// (the 402 challenge embeds it in the bazaar extension). tools/call is never
// a discovery method, so paid work still requires credentials or payment.
//
// Resource and prompt discovery is free on the same terms: the catalogs are
// public, prompts/get only renders static text, and resources/read enforces its
// own access rules, so an anonymous principal can read only the public
// resources (three://models, three://marketplace, three://x402/services) and
// gets a sign-in error for account data.
const DISCOVERY_METHODS = new Set([
	'initialize',
	'tools/list',
	'ping',
	'notifications/initialized',
	'resources/list',
	'resources/templates/list',
	'resources/read',
	'prompts/list',
	'prompts/get',
]);

export function isDiscoveryOnlyBatch(body) {
	const batch = Array.isArray(body) ? body : [body];
	return (
		batch.length > 0 &&
		batch.every((m) => m && typeof m.method === 'string' && DISCOVERY_METHODS.has(m.method))
	);
}
