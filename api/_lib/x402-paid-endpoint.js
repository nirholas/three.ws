// Helper for building paid x402 endpoints with minimal boilerplate.
//
// A paid endpoint runs an 8-step dance: CORS → method-check → access-control
// hook (optional bypass) → SIWX short-circuit (when opted in) → 402 challenge
// (when no payment header) → verify → run the handler → settle → respond
// with the X-PAYMENT-RESPONSE header. We factor that into `paidEndpoint(spec)`
// so each new /api/x402/* file only has to declare its route metadata + a
// handler that returns JSON.
//
// Pricing: each endpoint gets its own `priceAtomics` (USDC has 6 decimals,
// so "1000" = $0.001). Networks default to Solana first then Base, which is
// the order the 402 challenge lists them in; pass `networks` only to narrow
// that set (e.g. `['solana']`) or to force a different order. The bazaar discovery
// extension is required — agentic.market's catalog rejects entries without
// it. See api/_lib/x402-spec.js for the v2 wire-format details.
//
// SIWX opt-in (Sign-In-With-X, CAIP-122). Add `siwx: { statement, ttlSeconds?,
// expirationSeconds? }` to opt the endpoint into wallet-signature re-access:
//   - statement: human-readable purpose shown to the wallet on signing.
//   - ttlSeconds: how long the payment grant lasts (null = permanent).
//   - expirationSeconds: SIWX message validity window (default 300s).
// When set, the 402 body declares the `sign-in-with-x` extension, and an
// incoming `SIGN-IN-WITH-X` header skips the X-PAYMENT path for any wallet
// already in siwx_payments. Fresh settlements record a grant automatically.
//
// Per-asset payouts. Pass `payTo: { base?, solana?, bsc? }` to override the
// shared env.X402_PAY_TO_* receivers — used by /api/x402/asset-download so
// each creator can collect USDC to their own wallet without forking the
// helper. Missing keys fall back to env (so a single override doesn't
// disable the other networks).

import { cors, error, readBody, respondError, rateLimited, wrap } from './http.js';
import { env } from './env.js';
import { clientIp, limits } from './rate-limit.js';
import { logPaymentEvent } from './x402/audit-log.js';
import { recordPaymentMetric } from './axiom.js';
import { PAYMENT_EVENT_TOPIC as BSC_PAYMENT_EVENT_TOPIC } from './x402-bsc-direct.js';
import {
	BUILDER_CODE,
	NETWORK_BASE_MAINNET,
	NETWORK_BSC_MAINNET,
	NETWORK_SOLANA_MAINNET,
	X402Error,
	baseSettleable,
	solanaSettleable,
	encodePaymentResponseHeader,
	permit2VariantOf,
	resolveResourceUrl,
	send402,
	settlePayment,
	verifyPayment,
} from './x402-spec.js';
import { declareBuilderCodeExtension } from './x402-builder-code.js';
import { sponsorKnownBelowFloor, refreshSponsorFloorState } from './x402/self-facilitator.js';
import { resolveSolanaFacilitator } from './x402/ring-config.js';
import {
	PAYMENT_IDENTIFIER,
	checkCache,
	enforceRequired,
	extractIdFromHeader,
	hashPaymentProof,
	legacyPaymentProofHash,
	hashRequestPayload,
	paymentIdentifierExtension,
	reserveSlot,
	releaseSlot,
	storeResponse,
	writeCachedResponse,
	writeConflict,
	writeInflight,
} from './x402/payment-identifier-server.js';
import { authenticateSiwx, declareSiwxExtensionFor, recordSiwxPayment } from './siwx-server.js';
import { normalizeAddress } from './siwx-storage.js';
import { normalizeBazaarEntry } from './x402/bazaar-helpers.js';
import { buildOffersExtension, buildReceiptExtension } from './x402/offer-receipt-server.js';
import { signReceipt } from './x402-offer-receipt.js';
import { recordReceipt } from './x402/receipt-storage.js';
import {
	claimPaidRetry,
	claimSpentPayment,
	isPaymentSpent,
	markDelivered,
	markFailedAfterSettle,
	paidFailureFields,
	writeReplayed,
} from './x402/spent-payments.js';
import {
	authenticateAuthHintsRequest,
	declareAuthHintsExtension,
	freeEvmAcceptForAuth,
} from './x402/auth-hints.js';

const NETWORK_ALIASES = {
	base: NETWORK_BASE_MAINNET,
	'base-mainnet': NETWORK_BASE_MAINNET,
	bsc: NETWORK_BSC_MAINNET,
	'bsc-mainnet': NETWORK_BSC_MAINNET,
	solana: NETWORK_SOLANA_MAINNET,
	'solana-mainnet': NETWORK_SOLANA_MAINNET,
};

function resolveNetwork(name) {
	return NETWORK_ALIASES[name] || name;
}

// USDC is 6-decimal; the x402 requirement carries the price as an atomic string.
// Returns undefined for an absent/unparseable amount so the metric simply omits
// the field rather than reporting a misleading 0.
function atomicsToUsd(atomics) {
	if (atomics == null) return undefined;
	const n = Number(atomics);
	return Number.isFinite(n) ? n / 1e6 : undefined;
}

// Largest request body the wrapper buffers to key the idempotency hash. Above
// the Cloud Run body-parser limit (8 MB) so every parsed body fits, with room
// for the raw-audio routes that read their own stream.
const PAID_BODY_HASH_LIMIT = 32 * 1024 * 1024;

// The request bytes a paid call is FOR, so the payment-identifier hash keys a
// cached response to the exact input. GET/HEAD carry no body. On Cloud Run the
// server's body parsers have already buffered the bytes (req.rawBody / req.body)
// and readBody returns them without touching the stream; anywhere the stream is
// still unread, the bytes are kept on req.rawBody so the handler's own
// readBody/readJson reads the same buffer instead of a drained stream.
async function paidRequestBody(req) {
	const m = String(req.method || 'GET').toUpperCase();
	if (m === 'GET' || m === 'HEAD') return null;
	const buffered = Buffer.isBuffer(req.rawBody) || req.body !== undefined;
	const buf = await readBody(req, PAID_BODY_HASH_LIMIT);
	if (!buffered) req.rawBody = buf;
	return buf;
}

// What the durable spent-payment row stores about a settlement: enough for a
// paid retry to answer with the original x-payment-response and rebuild the
// handler's `settled` / `requirement` context without a second settle, plus
// the request payload hash, so a retry can only re-run the request that was
// paid for.
function settlementRecord(settled, verified, paymentResponseHeader, payloadHash) {
	return {
		payload: payloadHash ?? null,
		transaction: settled?.transaction ?? null,
		network: settled?.network || verified?.requirement?.network || null,
		payer: settled?.payer || verified?.payer || null,
		asset: verified?.requirement?.asset ?? null,
		amount: verified?.requirement?.amount ?? null,
		status: settled?.status ?? null,
		header: paymentResponseHeader ?? null,
	};
}

function settledFromRecord(record) {
	return {
		success: true,
		transaction: record?.transaction ?? null,
		network: record?.network ?? null,
		payer: record?.payer ?? null,
		...(record?.status ? { status: record.status } : {}),
	};
}

// A paid retry skips verify, so the requirement the buyer originally paid
// against is recovered from this request's accepts by network and asset.
function verifiedFromRecord(record, requirements) {
	const requirement = requirements.find(
		(r) => r.network === record?.network && (!record?.asset || r.asset === record.asset),
	) || { network: record?.network ?? null, asset: record?.asset ?? null, amount: record?.amount ?? null };
	return { requirement, payer: record?.payer ?? null, paymentPayload: null };
}

// Any failure once the buyer was charged answers with `paid: true`, whether a
// retry with the same payment is safe, and the settlement transaction, so a
// client never reads it as "pay again".
function writePaidFailure(res, { status, code, err, record, state }) {
	if (record?.header) res.setHeader('x-payment-response', record.header);
	return respondError(res, status, code, err, paidFailureFields({ settlement: record, ...state }));
}

function buildAccept(network, priceAtomics, resourceUrl, payToOverride, selfPayOnly = false) {
	const common = {
		scheme: 'exact',
		amount: String(priceAtomics),
		maxTimeoutSeconds: 60,
		resource: resourceUrl,
	};
	if (network === NETWORK_BASE_MAINNET) {
		return {
			...common,
			network: NETWORK_BASE_MAINNET,
			payTo: payToOverride?.base || env.X402_PAY_TO_BASE,
			asset: env.X402_ASSET_ADDRESS_BASE,
			// EIP-712 domain name must match the on-chain USDC contract — Base
			// USDC's domain is "USD Coin" (not "USDC"), or signatures fail.
			extra: { name: 'USD Coin', version: '2', decimals: 6 },
		};
	}
	if (network === NETWORK_SOLANA_MAINNET) {
		return {
			...common,
			network: NETWORK_SOLANA_MAINNET,
			payTo: payToOverride?.solana || env.X402_PAY_TO_SOLANA,
			asset: env.X402_ASSET_MINT_SOLANA,
			// PayAI requires this account as fee payer; without it /verify rejects.
			// Omitted deliberately in self-pay mode: absence of feePayer is the
			// wire signal that the buyer covers their own gas, which is what keeps
			// the endpoint payable while the sponsor wallet is empty.
			extra: {
				name: 'USDC',
				decimals: 6,
				...(selfPayOnly ? {} : { feePayer: env.X402_FEE_PAYER_SOLANA }),
			},
		};
	}
	if (network === NETWORK_BSC_MAINNET) {
		const contract = payToOverride?.bsc || env.X402_PAY_TO_BSC;
		// Contract-mediated "direct" scheme — the client calls
		// ThreeWSPayments.pay(bytes32) from their own wallet (see x402-bsc-direct.js).
		return {
			...common,
			scheme: 'direct',
			network: NETWORK_BSC_MAINNET,
			payTo: contract,
			asset: env.X402_ASSET_ADDRESS_BSC,
			extra: {
				name: 'Binance-Peg USD Coin',
				decimals: 6,
				contract,
				method: 'pay(bytes32)',
				eventTopic: BSC_PAYMENT_EVENT_TOPIC,
			},
		};
	}
	throw new X402Error('unsupported_network', `paidEndpoint: unsupported network ${network}`, 500);
}

// Exported for tests: the self-pay fallback below decides whether a paid
// endpoint stays payable while the sponsor wallet is empty, which is the
// difference between taking money and answering 503.
export function buildRequirements({ priceAtomics, networks, resourceUrl, payToOverride, acceptThree = true }) {
	const out = [];
	for (const name of networks) {
		const net = resolveNetwork(name);
		const baseTo = payToOverride?.base || env.X402_PAY_TO_BASE;
		const solTo = payToOverride?.solana || env.X402_PAY_TO_SOLANA;
		const bscTo = payToOverride?.bsc || env.X402_PAY_TO_BSC;
		// Advertise a network only when EVERY field its accept needs is present.
		// One half-configured chain must never take down the others: the endpoint
		// offers whatever networks are fully wired and silently drops the rest,
		// 402-failing only when NONE are payable. The asset is checked here too —
		// without it the accept would be advertised and then rejected by the
		// facilitator at settle, which is the same broken experience as a 500.
		// Base also needs a WORKING facilitator to settle against — CDP creds or the
		// X402_ADVERTISE_BASE opt-in. A bare facilitator URL is not enough: the prod
		// host was decommissioned and 404s every /verify, so advertising Base would
		// hand buyers an accept that always fails at settle (a 502, not a clean 402).
		// Drop Base instead; the Solana accept still settles in-house.
		if (
			net === NETWORK_BASE_MAINNET &&
			(!baseTo || !env.X402_ASSET_ADDRESS_BASE || !baseSettleable())
		)
			continue;
		// Solana needs somewhere to send the money and a mint to send. Those are
		// the only hard requirements: without them there is nothing to advertise.
		if (
			net === NETWORK_SOLANA_MAINNET &&
			(!solTo || !env.X402_ASSET_MINT_SOLANA)
		)
			continue;
		// Who pays the Solana fee is a SEPARATE question from whether we can be
		// paid. Sponsoring the buyer's gas is a convenience we offer so a buyer
		// holding only USDC needs no SOL; it is not a precondition for receiving.
		// This used to drop Solana whenever the sponsor could not co-sign (no
		// X402_FEE_PAYER_SECRET_BASE58 loaded, or the wallet under its SOL floor),
		// which 503'd a paid endpoint whose entire job is RECEIVING crypto while
		// the payTo wallet sat there perfectly able to receive. Advertise the
		// accept without a feePayer instead: that is the self-pay contract, where
		// the buyer signs as their own fee payer and the facilitator only
		// broadcasts, spending none of our SOL. Sponsored mode resumes by itself
		// the moment the wallet is topped up.
		//
		// Only when WE settle. An external facilitator (PayAI) pins the sponsor as
		// fee payer and rejects a challenge without one at /verify, so dropping
		// feePayer there would trade a retryable 503 for a hard verify failure.
		const solanaSelfPayOnly =
			net === NETWORK_SOLANA_MAINNET &&
			resolveSolanaFacilitator().self &&
			(!env.X402_FEE_PAYER_SOLANA || !solanaSettleable() || sponsorKnownBelowFloor());
		if (net === NETWORK_BSC_MAINNET && (!bscTo || !env.X402_ASSET_ADDRESS_BSC)) continue;
		const accept = buildAccept(net, priceAtomics, resourceUrl, payToOverride, solanaSelfPayOnly);
		out.push(accept);
		// $THREE alongside USDC on Solana (opt-in via X402_ACCEPT_THREE_SOLANA).
		// Pushed right after the USDC Solana accept — and after the network guard
		// above already confirmed solTo + fee payer + USDC mint — so holders can
		// pay this endpoint in the platform token; the modal shows a token chooser.
		// USDC stays first, so first-accept clients keep settling USDC.
		// `acceptThree: false` opts a route out. The $THREE amount is a FIXED
		// env value, so on a route whose USDC price varies per request (a print
		// order priced from its own quote token, a knock priced by the
		// recipient's door) it would let a $40 good settle for a flat token
		// amount. A fixed-price route is unaffected, which is why the default
		// stays on.
		if (acceptThree && net === NETWORK_SOLANA_MAINNET && env.X402_ACCEPT_THREE_SOLANA) {
			out.push({
				scheme: 'exact',
				network: NETWORK_SOLANA_MAINNET,
				amount: String(env.X402_THREE_AMOUNT_SOLANA || priceAtomics),
				maxTimeoutSeconds: 60,
				resource: resourceUrl,
				payTo: solTo,
				asset: env.THREE_TOKEN_MINT,
				extra: {
					name: 'THREE',
					decimals: env.THREE_TOKEN_DECIMALS,
					...(solanaSelfPayOnly ? {} : { feePayer: env.X402_FEE_PAYER_SOLANA }),
				},
			});
		}
		// For EVM `exact` networks, advertise a Permit2 sibling so @x402/* SDK
		// clients can pick the gasless Permit2-via-EIP-2612 path. The EIP-3009
		// entry stays first so the browser modal (which only signs
		// transferWithAuthorization) keeps selecting it. send402/build402Body
		// auto-declares the eip2612GasSponsoring extension when this sibling
		// is present — no per-endpoint opt-in needed.
		const sibling = permit2VariantOf(accept);
		if (sibling) out.push(sibling);
	}
	if (!out.length) {
		// Distinguish a TEMPORARY settlement gap from a genuine misconfiguration.
		// If Solana was requested and is otherwise fully configured (pay-to + mint +
		// sponsor pubkey) but dropped ONLY because solanaSettleable() is false — the
		// self-facilitator's co-signing secret isn't loaded yet — this is a transient,
		// operator-fixable state, not "nothing is wired". Surface a retryable 503 with
		// an actionable message instead of a 500 that reads as a permanent config
		// error, and never after taking a payment. Self-heals when the secret is set.
		const solanaConfigured =
			networks.some((n) => resolveNetwork(n) === NETWORK_SOLANA_MAINNET) &&
			(payToOverride?.solana || env.X402_PAY_TO_SOLANA) &&
			env.X402_FEE_PAYER_SOLANA &&
			env.X402_ASSET_MINT_SOLANA;
		if (solanaConfigured && !solanaSettleable()) {
			throw new X402Error(
				'settlement_unavailable',
				'paidEndpoint: Solana settlement is temporarily unavailable — the self-facilitator co-signing key (X402_FEE_PAYER_SECRET_BASE58) is not configured. Retry once it is set.',
				503,
			);
		}
		// Same transient class, different cause: fully wired but the sponsor
		// wallet is under its SOL settle floor. Self-heals when treasury-topup
		// (or the operator) refunds the wallet.
		if (solanaConfigured && sponsorKnownBelowFloor()) {
			throw new X402Error(
				'settlement_unavailable',
				'paidEndpoint: settlement is temporarily unavailable, the sponsor wallet is below its SOL settle floor. Retry after it is refunded.',
				503,
			);
		}
		throw new X402Error(
			'no_payto_configured',
			'paidEndpoint: no X402_PAY_TO_* configured for any requested network',
			500,
		);
	}
	return out;
}

// `spec.bazaar` is the v2 discoverable extension shape: { discoverable: true,
// info: { input, output }, schema }. See model-check.js for a worked example.
// `spec.handler({ req, res, requirement, payer })` is called only AFTER the
// payment verifies. It should return a JSON-serializable result; throwing an
// Error with .status + .code maps to a clean error response. Throwing an
// X402Error with status=402 re-emits the 402 challenge (e.g. wrong network).
//
// `spec.accessControl` (optional) — async (req, routeConfig) => result hook
// matching the v2 SDK onProtectedRequest contract. Built via
// installAccessControl() from api/_lib/x402/access-control.js. Returns:
//   • { grantAccess: true, reason, callerId, headers? } → bypass payment,
//     invoke the handler with `bypass = { reason, callerId, subscription?,
//     oauth? }` instead of `requirement`/`payer`, and skip settlement.
//   • { abort: true, status, reason, headers? } → reject the request with the
//     given status (default 403) and message.
//   • null / undefined → continue to the normal 402 flow.
//
// `spec.requiredScope` (optional) — OAuth scope the route declares for
// bypass-via-Bearer. Passed to the hook in routeConfig.requiredScope.
export function paidEndpoint(spec) {
	const {
		route,
		method = 'GET',
		priceAtomics = env.X402_MAX_AMOUNT_REQUIRED,
		// Solana-first platform default: the live 402 challenge lists Solana
		// before Base so first-accept clients/modals settle on Solana unless a
		// route explicitly overrides the network order.
		networks = ['solana', 'base'],
		description,
		mimeType = 'application/json',
		// Response shape. Default (false) is deliver-then-settle: the handler
		// RETURNS a value and the wrapper settles, then serialises + flushes it.
		// A handler on a default route that ends its own response is a bug — the
		// good would ship before settlement — and is rejected loudly below.
		// Set `streaming: true` for routes that must write their own body
		// (binary download, res.pipe, SSE): the wrapper then settles BEFORE
		// invoking the handler (settle-then-stream) and emits the
		// x-payment-response header up-front, so a self-flushing handler is paid
		// by construction. Streamed responses are never idempotency-cached.
		streaming = false,
		bazaar,
		handler,
		// ERC-8021 builder-code attribution. Optional per-route service codes
		// — e.g. a multi-service route declares ["pose-studio", "openai-proxy"]
		// so the on-chain CBOR suffix records every internal service that
		// participated. The app code (`a`) is pulled from env so every route
		// attributes to the same X402_BUILDER_CODE_APP. When env is unset, no
		// builder-code extension is declared and echo verification is skipped.
		services,
		accessControl,
		requiredScope = null,
		// USE-15: payment-identifier idempotency. Defaults to optional so any
		// caller can opt in. Set `{ required: true }` for routes where a
		// duplicate call is materially expensive or observable (oracle
		// submissions, fact-check writes, on-chain mints). `ttlSeconds`
		// overrides the env default (X402_IDEMPOTENCY_TTL_SECONDS).
		paymentIdentifier = {},
		// Optional per-route payout overrides — { base?, solana?, bsc? }. When
		// set, replaces env.X402_PAY_TO_* on a network-by-network basis.
		// Missing keys fall back to env so a single override doesn't disable
		// the other networks.
		payTo,
		// Advertise the $THREE accept alongside USDC on Solana (default true,
		// still gated on env.X402_ACCEPT_THREE_SOLANA). Set false on a route
		// whose USDC price varies per request: the $THREE amount comes from a
		// FIXED env value, so a variable-price good would be purchasable at a
		// flat token price no matter what its USDC quote said.
		acceptThree = true,
		// Optional SIWX (Sign-In-With-X, CAIP-122) opt-in. See file header.
		siwx,
		// Optional post-settlement hook for per-job metering (Roadmap phase 4:
		// inference settlement). Called with the settled payment context BEFORE
		// the response is flushed; the value it returns is JSON-merged into the
		// response body (object results only), so a paid route can attach a
		// signed metered-job core + receipt that provably covers the exact bytes
		// about to ship. Async; a throw is logged and the response ships
		// un-metered rather than failing a settled payment.
		metered,
		// Optional post-settlement accrual hook (Roadmap phase 3: per-call
		// royalties). Called fire-and-forget AFTER settlement succeeds, with
		// { payer, network, txHash, amountAtomics, asset, resourceUrl }. Use it
		// for ledger writes that must not delay or fail the settled response,
		// e.g. /api/x402/skill-call recording the author's royalty accrual. Any
		// throw is logged and swallowed; the payment already settled.
		onSettled,
		// Optional per-request resource URL. Default = route path. For routes
		// that serve multiple distinct goods through query params (e.g.
		// /api/x402/asset-download?slug=…), pass (req) => string to make each
		// good its own SIWX grant key. The 402 challenge AND the SIWX message
		// both use this URL, so the client signs against the same string we
		// look up in siwx_payments.
		resourceUrlBuilder,
		// USE-21: `auth-hints` extension. Declares OAuth2 and/or SIWX as
		// alternatives to paying for this endpoint. When set, the 402 body
		// surfaces an `auth-hints` extension AND one zero-amount accepts[]
		// entry per declared method, mapping authRequirements → acceptIndexes.
		// A valid `Authorization: Bearer …` or `SIGN-IN-WITH-X: …` header
		// short-circuits the payment dance with no facilitator settle and no
		// X-PAYMENT-RESPONSE — the handler runs with `auth = { method, ... }`
		// in place of `requirement`/`payer`.
		//
		// Shape:
		//   authHints: {
		//     oauth2: { requiredScope, tokenType?, authorizationServer?,
		//               tokenEndpoint?, registrationEndpoint? } | true,
		//     siwx:   true,
		//   }
		// Passing `true` for either method opts in with sensible defaults.
		authHints,
		// USE-17: Offer & Receipt extension. Defaults to `{}` which enables the
		// extension when OFFER_RECEIPT_SIGNING_PRIVATE_KEY (eip712) or
		// OFFER_RECEIPT_JWK (jws) is configured. Set `offerReceipt: false` to
		// opt out, or `offerReceipt: { includeTxHash: true }` on routes that
		// feed reputation systems where on-chain verifiability is more
		// important than payer privacy. `offerValiditySeconds` overrides the
		// 300-second default for how long signed offers stay valid.
		offerReceipt = {},
		// USE-13: Bazaar resource-level service metadata. Set per route so the
		// facilitator can group / search / icon-ify the catalog entry. Pass
		// `service: { serviceName, tags, iconUrl }` or use withService() from
		// api/_lib/x402/bazaar-helpers.js to merge with three.ws defaults.
		// Fields fall through to build402Body which gates each on the spec
		// validation rules (printable ASCII, length caps, https URL).
		service,
	} = spec;

	if (!route) throw new Error('paidEndpoint: route is required');
	if (!description) throw new Error('paidEndpoint: description is required');
	if (!bazaar) throw new Error('paidEndpoint: bazaar discovery extension is required');
	// Legacy flat blocks become the v2 `{ info, schema }` entry here, once, so the
	// live 402 matches what the discovery document already advertises.
	const bazaarEntry = normalizeBazaarEntry(bazaar, { method });
	if (typeof handler !== 'function') throw new Error('paidEndpoint: handler must be a function');
	if (accessControl != null && typeof accessControl !== 'function') {
		throw new Error('paidEndpoint: accessControl must be a function when provided');
	}
	if (siwx && typeof siwx.statement !== 'string') {
		throw new Error('paidEndpoint: siwx.statement is required when siwx is set');
	}

	const routeConfig = { path: route, method: method.toUpperCase(), requiredScope };
	const httpMethod = method.toUpperCase();
	const allowMethods = httpMethod === 'GET' ? 'GET,HEAD,OPTIONS' : `${httpMethod},OPTIONS`;
	const pidRequired = Boolean(paymentIdentifier.required);
	const pidTtlSeconds = paymentIdentifier.ttlSeconds;
	const pidExtension = paymentIdentifierExtension(pidRequired);

	// wrap() instruments the request for zauth Provider Hub telemetry (every
	// paidEndpoint route is a monitored x402 surface) and converts any uncaught
	// handler throw into the standard JSON error envelope. instrument() is
	// idempotent, so dispatchers that are already wrap()-ed (wk.js,
	// x402/service.js) don't double-report.
	return wrap(async function paidHandler(req, res) {
		const requestStartTime = Date.now();
		if (cors(req, res, { methods: allowMethods, origins: '*' })) return;
		const isHead = req.method === 'HEAD' && httpMethod === 'GET';
		// Discovery probes (x402scan, 402index, agent crawlers) hit paid routes
		// with whatever method they like and expect the 402 challenge — the
		// x402 discovery spec treats runtime 402 behavior as the source of
		// truth, and a 405 reads as "not an x402 endpoint". A request on the
		// wrong method that carries NO payment or auth credentials can only
		// ever want the challenge, so serve it; anything carrying credentials
		// intended to redeem the resource still gets the strict 405.
		const hasCredentials =
			!!req.headers?.['x-payment'] ||
			!!req.headers?.['payment-signature'] ||
			!!req.headers?.['sign-in-with-x'] ||
			!!req.headers?.authorization ||
			!!req.headers?.['x-api-key'];
		const challengeOnly = req.method !== httpMethod && !isHead && !hasCredentials;
		if (req.method !== httpMethod && !isHead && hasCredentials) {
			res.setHeader('allow', allowMethods);
			return error(res, 405, 'method_not_allowed', `use ${httpMethod}`);
		}

		const ip = clientIp(req);
		// Abuse guard, tier 1 — anonymous-flood protection on the discovery/probe
		// path. Authenticated and subscription callers (Bearer / SIWX / API key)
		// have their own access-control gating downstream, so they bypass this
		// per-IP cap; only unauthenticated traffic is bounded here. Non-critical:
		// a Redis outage must never block price discovery or a legitimate paid
		// retry — the fail-closed facilitator guard (tier 2) runs further down.
		const isAuthenticatedCaller =
			!!req.headers?.authorization ||
			!!req.headers?.['sign-in-with-x'] ||
			!!req.headers?.['x-api-key'];
		if (!isAuthenticatedCaller) {
			const probe = await limits.x402ProbeIp(ip);
			if (!probe.success) {
				return rateLimited(res, probe, 'too many requests — slow down and retry shortly');
			}
		}

		const resourceUrl =
			typeof resourceUrlBuilder === 'function'
				? resourceUrlBuilder(req)
				: resolveResourceUrl(req, route);
		// Keep this instance's sponsor floor state warm so the challenge below
		// reflects reality. Deliberately not awaited: at most one balance read per
		// 20s per instance, and a slow or failed RPC must never delay a 402.
		refreshSponsorFloorState();

		let requirements;
		try {
			requirements = buildRequirements({
				priceAtomics,
				networks,
				resourceUrl,
				payToOverride: payTo,
				acceptThree,
			});
		} catch (err) {
			return error(
				res,
				err.status || 500,
				err.code || 'misconfigured',
				err.message || 'paid endpoint misconfigured',
			);
		}

		// USE-21 auth-hints: append zero-amount accept entries for each declared
		// auth method and build the auth-hints extension. The free entries
		// reuse the Base USDC asset block so schema-checking clients accept
		// them; amount="0" entries can only be redeemed by presenting the
		// matching auth header, never via X-PAYMENT — verifyPayment enforces
		// this structurally (it excludes amount-0 / extra.authRequired entries
		// from requirement matching), so the guarantee does not depend on
		// these entries being appended after the payable ones. The auth-hints
		// extension maps each method to the index of its free entry so the
		// buyer client knows which entry corresponds to which auth method.
		let authHintsExtension = null;
		// X402_AUTH_HINT_ACCEPTS=false suppresses the whole advertisement (the
		// extension schema requires each declared method to map to a free
		// accepts[] entry, so the two can only ship together). External x402
		// directory validators reject challenges carrying amount="0" entries;
		// the auth bypass itself keeps working either way because the
		// access-control hook runs before the payment dance.
		if (authHints && env.X402_AUTH_HINT_ACCEPTS) {
			const baseTo = payTo?.base || env.X402_PAY_TO_BASE;
			if (baseTo) {
				const declarations = {};
				if (authHints.oauth2) {
					const oauthCfg = authHints.oauth2 === true ? {} : authHints.oauth2;
					const idx = requirements.length;
					requirements.push(
						freeEvmAcceptForAuth({
							network: NETWORK_BASE_MAINNET,
							asset: env.X402_ASSET_ADDRESS_BASE,
							payTo: baseTo,
							authType: 'oauth2',
						}),
					);
					declarations.oauth2 = { ...oauthCfg, acceptIndexes: [idx] };
				}
				if (authHints.siwx) {
					const idx = requirements.length;
					requirements.push(
						freeEvmAcceptForAuth({
							network: NETWORK_BASE_MAINNET,
							asset: env.X402_ASSET_ADDRESS_BASE,
							payTo: baseTo,
							authType: 'sign-in-with-x',
						}),
					);
					declarations.siwx = { acceptIndexes: [idx] };
				}
				if (declarations.oauth2 || declarations.siwx) {
					authHintsExtension = declareAuthHintsExtension(declarations);
				}
			}
		}

		// Build the builder-code extension once per challenge so the same block
		// is advertised in the 402 body AND passed to verifyPayment for echo
		// validation. If a route declares services, override the auto-declared
		// block from build402Body.
		const appCode = env.X402_BUILDER_CODE_APP;
		const builderCode =
			appCode && Array.isArray(services) && services.length
				? declareBuilderCodeExtension({ a: appCode, s: services })
				: appCode
					? declareBuilderCodeExtension({ a: appCode })
					: null;

		// SIWX extension advertised on every 402 when the endpoint opts in.
		// `requirements[].network` lists every CAIP-2 chain we'll accept a
		// signature for — the upstream helper turns it into supportedChains
		// and enriches the info block (domain/uri/nonce/issuedAt) per request.
		// Wrapped in try-catch: a failure here must never surface as 500 — the
		// 402 challenge is still valid without the SIWX extension.
		let siwxExtensions = null;
		if (siwx) {
			try {
				siwxExtensions = await declareSiwxExtensionFor({
					networks: requirements.map((r) => r.network),
					resourceUrl,
					statement: siwx.statement,
					expirationSeconds: siwx.expirationSeconds,
				});
			} catch (err) {
				console.error('[paidEndpoint] declareSiwxExtensionFor failed', err?.message || err);
			}
		}

		const extraExtensions = {
			[PAYMENT_IDENTIFIER]: pidExtension,
			...(builderCode ? { [BUILDER_CODE]: builderCode } : {}),
			...(siwxExtensions || {}),
			...(authHintsExtension || {}),
		};

		// USE-17: sign one offer per accepts[] entry (when issuer is
		// configured AND the route hasn't opted out). Failing here returns
		// null — we never want a missing signing key to break the 402 dance,
		// since the protocol stays valid without the extension.
		if (offerReceipt !== false) {
			try {
				const offersFragment = await buildOffersExtension(
					resourceUrl,
					requirements,
					offerReceipt || {},
				);
				if (offersFragment) Object.assign(extraExtensions, offersFragment);
			} catch (err) {
				console.error('[paidEndpoint] buildOffersExtension failed', err?.message || err);
			}
		}

		const challenge = {
			resourceUrl,
			accepts: requirements,
			description,
			mimeType,
			bazaar: bazaarEntry,
			extensions: extraExtensions,
			...(service?.serviceName ? { serviceName: service.serviceName } : {}),
			...(Array.isArray(service?.tags) && service.tags.length ? { tags: service.tags } : {}),
			...(service?.iconUrl ? { iconUrl: service.iconUrl } : {}),
		};

		// Credential-less request on the wrong method (see the 405 gate above):
		// answer with the challenge and stop — there is nothing to redeem, so
		// none of the bypass/SIWX/settlement paths below apply.
		if (challengeOnly) {
			res.setHeader('allow', allowMethods);
			return await send402(res, challenge);
		}

		// USE-21: auth-hints fast path. If the endpoint declared OAuth/SIWX as
		// payment alternatives and the request carries a valid Authorization
		// Bearer or SIGN-IN-WITH-X header, bypass the payment dance entirely.
		// Runs BEFORE the generic access-control hook so the auth-hints
		// principal is what reaches the handler. The SIWX path here does NOT
		// require a prior on-chain payment (unlike the USE-16 returning-buyer
		// SIWX flow further down).
		if (authHintsExtension) {
			const result = await authenticateAuthHintsRequest(req, {
				audience: env.MCP_RESOURCE,
				requiredScope: authHints?.oauth2?.requiredScope || requiredScope || null,
				resourceUrl,
			}).catch((err) => ({ ok: false, reason: 'auth_hints_failure', detail: err.message }));
			if (result && !result.ok) {
				return error(
					res,
					result.reason === 'insufficient_scope' ? 403 : 401,
					result.reason || 'auth_failed',
					result.detail || 'auth-hints verification failed',
				);
			}
			if (result?.ok) {
				let bypassResult;
				try {
					bypassResult = await handler({
						req,
						res,
						bypass: {
							reason: `auth-hints:${result.principal.method}`,
							callerId: result.principal.userId
								? `oauth:${result.principal.userId}`
								: `siwx:${result.principal.address}`,
							subscription: null,
							oauth:
								result.principal.method === 'oauth2'
									? {
											userId: result.principal.userId,
											scope: result.principal.scope,
											clientId: result.principal.clientId,
										}
									: null,
							siwx:
								result.principal.method === 'sign-in-with-x'
									? {
											address: result.principal.address,
											network: result.principal.network,
										}
									: null,
						},
						auth: result.principal,
						requirement: null,
						payer: null,
					});
				} catch (err) {
					if (err instanceof X402Error && err.status === 402) {
						return await send402(res, { ...challenge, error: err.message });
					}
					return respondError(res, err.status || 500, err.code || 'internal_error', err);
				}
				if (res.writableEnded) return;
				res.setHeader('x-payment-bypass', `auth-hints:${result.principal.method}`);
				res.setHeader('cache-control', 'no-store');
				res.setHeader('content-type', `${mimeType}; charset=utf-8`);
				res.end(
					typeof bypassResult === 'string' ? bypassResult : JSON.stringify(bypassResult),
				);
				logPaymentEvent({
					eventType: 'bypass_granted',
					route,
					resourceUrl,
					payer: result.principal.userId || result.principal.address || null,
					durationMs: Date.now() - requestStartTime,
					ipAddress: clientIp(req),
					userAgent: req.headers?.['user-agent']?.slice(0, 512) || null,
					metadata: { reason: `auth-hints:${result.principal.method}` },
				});
				return;
			}
		}

		// Access-control hook (USE-23). Runs before the 402 so internal /
		// subscription / OAuth callers can bypass payment entirely. Headers
		// from `acResult.headers` are applied in both grant + abort paths.
		if (accessControl) {
			let acResult;
			try {
				acResult = await accessControl(req, routeConfig);
			} catch (err) {
				return error(
					res,
					err.status || 500,
					err.code || 'access_control_failed',
					err.message || 'access control failed',
				);
			}
			if (acResult?.abort) {
				if (acResult.headers) {
					for (const [k, v] of Object.entries(acResult.headers)) res.setHeader(k, v);
				}
				return error(
					res,
					acResult.status || 403,
					acResult.code || 'access_denied',
					acResult.reason || 'access denied',
				);
			}
			if (acResult?.grantAccess) {
				let bypassResult;
				try {
					bypassResult = await handler({
						req,
						res,
						bypass: {
							reason: acResult.reason,
							callerId: acResult.callerId,
							subscription: acResult.subscription || null,
							oauth: acResult.oauth || null,
						},
						requirement: null,
						payer: null,
					});
				} catch (err) {
					if (err instanceof X402Error && err.status === 402) {
						return await send402(res, { ...challenge, error: err.message });
					}
					return respondError(res, err.status || 500, err.code || 'internal_error', err);
				}
				if (res.writableEnded) return;
				if (acResult.headers) {
					for (const [k, v] of Object.entries(acResult.headers)) res.setHeader(k, v);
				}
				res.setHeader('x-payment-bypass', acResult.reason || 'granted');
				res.setHeader('cache-control', 'no-store');
				res.setHeader('content-type', `${mimeType}; charset=utf-8`);
				res.end(
					typeof bypassResult === 'string' ? bypassResult : JSON.stringify(bypassResult),
				);
				logPaymentEvent({
					eventType: 'bypass_granted',
					route,
					resourceUrl,
					payer: acResult.callerId || null,
					durationMs: Date.now() - requestStartTime,
					ipAddress: clientIp(req),
					userAgent: req.headers?.['user-agent']?.slice(0, 512) || null,
					metadata: { reason: acResult.reason || 'access_control' },
				});
				return;
			}
		}

		const paymentHeader = req.headers['x-payment'] || req.headers['payment-signature'];

		// SIWX short-circuit. A returning wallet sends `SIGN-IN-WITH-X: <base64>`
		// instead of paying; we verify the CAIP-122 signature and skip the
		// facilitator round-trip entirely. Only runs when the endpoint opted
		// in and no X-PAYMENT was sent — paid requests still take precedence.
		if (siwx && !paymentHeader) {
			const auth = await authenticateSiwx({ req, resourceUrl });
			if (auth?.ok) {
				let result;
				try {
					result = await handler({
						req,
						res,
						requirement: null,
						payer: auth.address,
						siwx: { address: auth.address, network: auth.network },
					});
				} catch (err) {
					if (err instanceof X402Error && err.status === 402) {
						return await send402(res, { ...challenge, error: err.message });
					}
					return respondError(res, err.status || 500, err.code || 'internal_error', err);
				}
				if (res.writableEnded) return;
				res.setHeader('x-siwx-address', auth.address);
				res.setHeader('cache-control', 'no-store');
				res.setHeader('content-type', `${mimeType}; charset=utf-8`);
				res.end(typeof result === 'string' ? result : JSON.stringify(result));
				logPaymentEvent({
					eventType: 'siwx_access',
					route,
					resourceUrl,
					payer: auth.address,
					network: auth.network || null,
					durationMs: Date.now() - requestStartTime,
					ipAddress: clientIp(req),
					userAgent: req.headers?.['user-agent']?.slice(0, 512) || null,
				});
				return;
			}
			if (auth && !auth.ok) {
				// 402 from siwx means "valid signature, no grant" → re-issue the
				// challenge so the client can fall back to paying. Anything else
				// (parse / signature failure) is a hard client error.
				if (auth.status === 402) {
					return await send402(res, { ...challenge, error: auth.error });
				}
				return error(res, auth.status, auth.code, auth.error);
			}
			// auth === null → no SIGN-IN-WITH-X header → fall through to 402.
		}

		if (!paymentHeader) return await send402(res, challenge);

		// Abuse guard, tier 2 — only requests carrying an X-PAYMENT header reach the
		// facilitator /verify round-trip below, so this is where a junk-payment flood
		// would amplify one cheap inbound request into one outbound facilitator call
		// at our expense. Cap per-IP and globally; both CRITICAL (fail closed in
		// prod) — during a Redis outage, rejecting a payment retry (the buyer keeps
		// their funds and retries) beats letting the amplification run unbounded. The
		// global ceiling is a runaway/DDoS circuit breaker, tunable via
		// X402_VERIFY_GLOBAL_PER_HOUR as legitimate volume grows.
		const verifyIpLimit = await limits.x402VerifyIp(ip);
		if (!verifyIpLimit.success) {
			return rateLimited(res, verifyIpLimit, 'too many payment attempts — retry shortly');
		}
		const verifyGlobalLimit = await limits.x402VerifyGlobal();
		if (!verifyGlobalLimit.success) {
			return rateLimited(res, verifyGlobalLimit, 'payment system at capacity — retry shortly');
		}

		// USE-15: required-mode rejects the call before we burn an RPC round-trip.
		try {
			enforceRequired({ paymentHeader, required: pidRequired });
		} catch (err) {
			if (err instanceof X402Error && err.status >= 400 && err.status < 500) {
				return error(res, err.status, err.code, err.message);
			}
			throw err;
		}

		// USE-15: deduplicate before /verify. The hash covers method, URL and,
		// for every non-GET route, the request body: many paid routes are POST
		// (service proxies, pipelines, launches), and hashing the URL alone let
		// two different bodies under one payment identifier share a cached
		// response.
		const clientPaymentId = extractIdFromHeader(paymentHeader);
		let requestBody;
		try {
			requestBody = await paidRequestBody(req);
		} catch (err) {
			return respondError(res, err.status || 400, err.status === 413 ? 'payload_too_large' : 'bad_request', err);
		}
		const payloadHash = hashRequestPayload({
			method: req.method,
			url: req.url,
			body: requestBody,
		});
		// Bind the idempotency cache to the signed payment proof so a stolen or
		// guessed payment-identifier can't redeem a prior paid response for free.
		const paymentHash = hashPaymentProof(paymentHeader);
		// Always-on replay guard. The payment-identifier extension is client-
		// opt-in, so a payer who omits it would otherwise get NO server-side
		// replay protection: a captured X-PAYMENT header could be replayed to
		// re-run the handler (re-delivering the paid good, with side effects) and
		// re-hit /settle. The flow delivers BEFORE settling, so we can't lean on
		// on-chain nonce reuse to stop the re-delivery, and we don't trust the
		// external facilitator to reject the replay -- same defense-in-depth
		// stance as the amount/recipient/network checks in x402-spec.js. When the
		// client sends no id we fall back to the proof hash itself as the dedup
		// key (reproducible only by the original payer), making replay protection
		// unconditional. Entries are written only AFTER a successful settle, so a
		// transient verify/settle failure never locks a legitimate payer out of
		// retrying the same payment.
		const paymentId = clientPaymentId || (paymentHash ? `proof:${paymentHash}` : null);
		// Track whether THIS request owns the in-flight reservation, so we only
		// release it on a failure path (never delete another request's slot or a
		// stored response).
		let ownsReservation = false;
		if (paymentId) {
			const lookup = await checkCache({ route, paymentId, payloadHash, paymentHash });
			if (lookup.kind === 'hit') {
				return writeCachedResponse(res, lookup.entry);
			}
			if (lookup.kind === 'conflict') {
				return writeConflict(res, {
					route,
					attemptedHash: lookup.attemptedHash,
					existingHash: lookup.existingHash,
					reason: lookup.reason,
				});
			}
			if (lookup.kind === 'inflight') {
				return writeInflight(res);
			}
			// Atomically claim the slot. The check above + the deferred storeResponse
			// (written only AFTER settle) left a window where N concurrent requests
			// carrying the same X-PAYMENT all missed the cache, all ran the paid
			// handler (side effects) and all settled before the first response was
			// stored. The NX reservation closes it: only the winner proceeds; the rest
			// observe the in-flight marker (or, once it finishes, the cached response).
			ownsReservation = await reserveSlot({ route, paymentId, ttlSeconds: pidTtlSeconds });
			if (!ownsReservation) {
				const recheck = await checkCache({ route, paymentId, payloadHash, paymentHash });
				if (recheck.kind === 'hit') return writeCachedResponse(res, recheck.entry);
				if (recheck.kind === 'conflict') {
					return writeConflict(res, {
						route,
						attemptedHash: recheck.attemptedHash,
						existingHash: recheck.existingHash,
						reason: recheck.reason,
					});
				}
				return writeInflight(res);
			}
		}

		// Durable replay guard — the leg the cache above cannot cover. Cache
		// entries expire with pidTtlSeconds; a captured X-PAYMENT header replayed
		// after that expiry misses the cache entirely and re-enters the handler,
		// re-running its side effects and re-delivering the paid good. (The MONEY
		// leg is already safe: settle-credit.js refuses a second credit per
		// signature. Delivery is not, because the default path delivers before it
		// settles.) One indexed lookup here, BEFORE verify and before the handler,
		// keeps a replay away from the side effects; the atomic claim that closes
		// the concurrent-race window runs at the end of settlement below. Fails
		// OPEN on a DB outage — see api/_lib/x402/spent-payments.js for why this
		// control's failure policy is the inverse of settle-credit's.
		//
		// A proof that settled but whose work then failed is NOT a replay: the
		// buyer was charged and got nothing. Such a proof takes the paid-retry
		// lane instead: no second verify, no second settle, the stored
		// settlement is re-emitted, and the work runs again.
		// `spentKey` is the hash the durable row lives under (the canonical hash,
		// or the legacy one for a row written before canonicalization).
		let spentKey = paymentHash;
		let paidRetry = null;
		if (paymentHash) {
			let spent = await isPaymentSpent(paymentHash);
			const legacyHash = legacyPaymentProofHash(paymentHeader);
			if (!spent.spent && legacyHash && legacyHash !== paymentHash) {
				const legacy = await isPaymentSpent(legacyHash);
				if (legacy.spent) {
					spent = legacy;
					spentKey = legacyHash;
				}
			}
			if (
				spent.spent &&
				spent.retryable &&
				spent.endpoint === route &&
				spent.settlement?.payload &&
				spent.settlement.payload !== payloadHash
			) {
				// A paid retry re-runs the request that was paid for, never a
				// different one: same method, URL and body.
				if (ownsReservation) await releaseSlot({ route, paymentId });
				return error(res, 409, 'payment_retry_mismatch', 'a paid retry must repeat the original request exactly',
					paidFailureFields({ settlement: spent.settlement, retriesLeft: spent.retriesLeft }));
			}
			if (spent.spent && spent.retryable && spent.endpoint === route) {
				const retry = await claimPaidRetry({ paymentHash: spentKey, endpoint: route });
				// Lost the claim to a concurrent retry of the same header: re-read,
				// so the answer below is "in flight", not "exhausted".
				if (!retry.granted) spent = await isPaymentSpent(spentKey);
				if (retry.granted) {
					paidRetry = { record: retry.settlement || spent.settlement || {}, attempt: retry.attempt };
					logPaymentEvent({
						eventType: 'payment_paid_retry',
						route,
						resourceUrl,
						payer: paidRetry.record.payer || null,
						network: paidRetry.record.network || null,
						txHash: paidRetry.record.transaction || null,
						ipAddress: clientIp(req),
						userAgent: req.headers?.['user-agent']?.slice(0, 512) || null,
						metadata: { attempt: retry.attempt },
					});
				}
			}
			if (spent.spent && !paidRetry && spent.running) {
				// The paid work for this proof is running right now on another
				// request. Same answer as an in-flight idempotency slot.
				if (ownsReservation) await releaseSlot({ route, paymentId });
				return writeInflight(res);
			}
			if (spent.spent && !paidRetry && spent.outcome !== 'delivered' && spent.endpoint === route) {
				// Charged, failed, and out of retries (or the window closed). Still
				// a 409, but one that says the buyer paid, so a client escalates
				// with the settlement instead of paying again.
				if (ownsReservation) await releaseSlot({ route, paymentId });
				res.setHeader('x-x402-idempotent', 'replayed');
				return error(res, 409, 'payment_retries_exhausted', 'this payment settled but its retries are used up',
					paidFailureFields({ settlement: spent.settlement, retriesLeft: 0 }));
			}
			if (spent.spent && !paidRetry) {
				logPaymentEvent({
					eventType: 'payment_replay_rejected',
					route,
					resourceUrl,
					durationMs: Date.now() - requestStartTime,
					ipAddress: clientIp(req),
					userAgent: req.headers?.['user-agent']?.slice(0, 512) || null,
					metadata: { stage: 'pre_handler' },
				});
				recordPaymentMetric({
					kind: 'x402',
					status: 'failed',
					latencyMs: Date.now() - requestStartTime,
					reason: 'payment_replayed',
				});
				if (ownsReservation) await releaseSlot({ route, paymentId });
				return writeReplayed(res, { route });
			}
		}

		let verified;
		try {
			verified = paidRetry
				? verifiedFromRecord(paidRetry.record, requirements)
				: await verifyPayment({ paymentHeader, requirements, builderCode });
		} catch (err) {
			// A failed verify is the amplification vector this family guards against: a
			// junk X-PAYMENT header turns one cheap inbound request into one outbound
			// facilitator call at our expense. So failure, not mere attempt, is what the
			// per-IP verify bucket meters. Burn the extra penalty tokens here. A client
			// that keeps paying successfully is never throttled for it, while a flood of
			// invalid proofs drains its bucket and gets cut off at the pre-verify gate
			// above, before the next facilitator round-trip. Rejected proofs (402) and
			// upstream verify faults (502) both count, because an attacker chooses the
			// shape of the garbage they send; exempting either would reopen the vector.
			await limits.x402VerifyPenalty(ip);
			// Verify is a payment outcome too — record it so the invalid/rejected-
			// payment rate is visible alongside settlements. A 402 here is a rejected
			// proof (insufficient/invalid), distinct from an upstream verify fault.
			// The Axiom metric is fire-and-forget and unconfigured in most deploys,
			// so ALSO write the durable audit event: the verify-reject rate is one
			// of the three panels /api/ops/payment-outcomes exists to show, and a
			// griefing wave (junk X-PAYMENT floods) is invisible without it.
			logPaymentEvent({
				eventType: 'payment_verify_rejected',
				route,
				resourceUrl,
				durationMs: Date.now() - requestStartTime,
				ipAddress: clientIp(req),
				userAgent: req.headers?.['user-agent']?.slice(0, 512) || null,
				metadata: {
					reason: err.code || (err.status === 402 ? 'verify_rejected' : 'verify_failed'),
					kind: err.status === 402 ? 'rejected_proof' : 'upstream_fault',
					// The facilitator's own words (ata_create_wrong_account,
					// transfer_wrong_mint, ...). The code above is the same
					// invalid_payment for every rejected proof, which names the
					// class and hides the cause.
					detail: String(err.message || '').slice(0, 300) || null,
				},
			});
			recordPaymentMetric({
				kind: 'x402',
				status: 'failed',
				latencyMs: Date.now() - requestStartTime,
				reason: err.code || (err.status === 402 ? 'verify_rejected' : 'verify_failed'),
			});
			if (ownsReservation) await releaseSlot({ route, paymentId });
			if (err.status === 402) return await send402(res, { ...challenge, error: err.message });
			return respondError(res, err.status || 502, err.code || 'verify_failed', err);
		}

		// Settle the verified payment and build the x-payment-response header
		// (signed receipts + SIWX grant). Invoked with the response NOT yet
		// flushed in BOTH paths: settle-then-stream calls it before the handler
		// runs; deliver-then-settle calls it after the handler returned a value.
		// On any settle/SIWX fault it writes the error response and returns null,
		// and the caller returns immediately.
		//
		// On a paid retry the settlement already happened on the first attempt:
		// nothing is settled again and no second receipt is issued; the stored
		// settlement and its original x-payment-response are reused, and only the
		// idempotent SIWX grant is re-run.
		//
		// `claimOutcome` is what the durable spent-payment claim records:
		// 'delivered' when the good ships right after this returns (default
		// path), 'running' when the handler still has to run (streaming path).
		async function settleAndBuildResponse({ claimOutcome = 'delivered' } = {}) {
			let settled;
			let paymentResponseHeader;
			if (paidRetry) {
				settled = settledFromRecord(paidRetry.record);
				paymentResponseHeader = paidRetry.record.header || encodePaymentResponseHeader(settled);
			} else {
				try {
					settled = await settlePayment({ verified });
				} catch (err) {
					logPaymentEvent({
						eventType: 'payment_failed',
						route,
						resourceUrl,
						payer: verified.payer || null,
						network: verified.requirement?.network || null,
						amountAtomics: verified.requirement?.amount || null,
						asset: verified.requirement?.asset || null,
						settlementStatus: 'failed',
						durationMs: Date.now() - requestStartTime,
						ipAddress: clientIp(req),
						userAgent: req.headers?.['user-agent']?.slice(0, 512) || null,
						metadata: { error: err.message, code: err.code },
					});
					recordPaymentMetric({
						kind: 'x402',
						status: 'failed',
						network: verified.requirement?.network,
						amountUsd: atomicsToUsd(verified.requirement?.amount),
						latencyMs: Date.now() - requestStartTime,
						reason: err.code || 'settle_failed',
					});
					if (ownsReservation) await releaseSlot({ route, paymentId });
					respondError(res, err.status || 502, err.code || 'settle_failed', err);
					return null;
				}
				paymentResponseHeader = encodePaymentResponseHeader(settled, await buildResponseExtensions(settled));
			}
			const record = settlementRecord(settled, verified, paymentResponseHeader, payloadHash);

			// Record the SIWX grant so the wallet can re-access via signature next
			// time. siwx-storage.recordPayment is idempotent (upsert on PK), so a
			// retried grant is safe. The on-chain payment is final; if Neon hiccups
			// the buyer gets a paid failure that says to retry with the same
			// payment, which re-runs this write without a second charge.
			if (siwx && verified.payer) {
				try {
					await recordSiwxPayment({
						resourceUrl,
						payer: normalizeAddress(verified.requirement.network, verified.payer),
						network: verified.requirement.network,
						ttlSeconds: siwx.ttlSeconds ?? null,
					});
					logPaymentEvent({
						eventType: 'siwx_grant',
						route,
						resourceUrl,
						payer: verified.payer,
						network: verified.requirement.network,
						ipAddress: clientIp(req),
						userAgent: req.headers?.['user-agent']?.slice(0, 512) || null,
						metadata: { ttlSeconds: siwx.ttlSeconds ?? null },
					});
				} catch (err) {
					if (ownsReservation) await releaseSlot({ route, paymentId });
					await failAfterSettle({ status: 502, code: 'siwx_record_failed', err, record, claimed: Boolean(paidRetry) });
					return null;
				}
			}

			// Durable spent-payment claim. Runs LAST, once settlement and every
			// downstream step above succeeded. Atomic on the primary key: of any
			// set of concurrent requests carrying one X-PAYMENT header exactly one
			// claim wins, which closes the race the pre-handler lookup alone
			// cannot. A losing claim is a replay that got past the lookup: refuse
			// the response rather than deliver the good twice. Fails OPEN on a DB
			// outage (the cache guard and settle-credit still apply). A paid retry
			// already holds the row through claimPaidRetry.
			if (!paidRetry) {
				const claim = await claimSpentPayment({
					paymentHash,
					endpoint: route,
					amountAtomics: verified.requirement?.amount ?? null,
					outcome: claimOutcome,
					settlement: record,
				});
				if (claim.replay) {
					logPaymentEvent({
						eventType: 'payment_replay_rejected',
						route,
						resourceUrl,
						payer: settled.payer || verified.payer || null,
						network: settled.network || verified.requirement?.network || null,
						amountAtomics: verified.requirement?.amount || null,
						asset: verified.requirement?.asset || null,
						txHash: settled.transaction || null,
						settlementStatus: 'failed',
						durationMs: Date.now() - requestStartTime,
						ipAddress: clientIp(req),
						userAgent: req.headers?.['user-agent']?.slice(0, 512) || null,
						metadata: { stage: 'post_settle' },
					});
					recordPaymentMetric({
						kind: 'x402',
						status: 'failed',
						network: verified.requirement?.network,
						amountUsd: atomicsToUsd(verified.requirement?.amount),
						latencyMs: Date.now() - requestStartTime,
						reason: 'payment_replayed',
					});
					if (ownsReservation) await releaseSlot({ route, paymentId });
					writeReplayed(res, { route });
					return null;
				}
			}

			return { settled, paymentResponseHeader, record };
		}

		// USE-17: issue a signed receipt for the settled payment and stash it in
		// the response extensions envelope. Persist asynchronously so the
		// /api/x402/my-receipts buyer-lookup path can serve it later: the
		// recordReceipt write is fire-and-forget so a Neon hiccup never surfaces
		// as a 5xx on a payment that already settled on-chain.
		async function buildResponseExtensions(settled) {
			let responseExtensions;
			if (offerReceipt !== false) {
				try {
					// Facilitators may omit payer/network from the settle response (backward-
					// compat). Fall back to verified context so the receipt is still issued.
					// BSC `direct` flows have verified.payer = null (contract event, no signed
					// payload) — buildReceiptExtension returns null in that case gracefully.
					const receiptSettled = {
						...settled,
						payer: settled.payer || verified.payer || null,
						network: settled.network || verified.requirement?.network || null,
					};
					const receiptBuilt = await buildReceiptExtension(
						resourceUrl,
						receiptSettled,
						offerReceipt || {},
					);
					if (receiptBuilt) {
						responseExtensions = receiptBuilt.extensionFragment;
						// Store the SAME settlement context the receipt was issued
						// against: `settled` alone can be missing the payer (some
						// facilitators omit it), and a payer-less row is dropped by
						// the storage layer, silently losing a receipt the buyer
						// already holds. Amount/asset come from the verified
						// requirement so the buyer can see what each call cost.
						recordReceipt({
							resourceUrl,
							signedReceipt: receiptBuilt.signedReceipt,
							settled: receiptSettled,
							payment: {
								amountAtomics: verified.requirement?.amount || null,
								asset: verified.requirement?.asset || null,
							},
						});
					}
				} catch (err) {
					// A receipt sign failure must not break the 200 — the payment settled
					// and the work ran. Log and continue with an unsigned response.
					console.error('x402_receipt_sign_failed', err);
				}
			}

			// New-stack receipt: keyed by X402_RECEIPT_SIGNING_KEY. Returns null when
			// unset (byte-identical to current behaviour) or when payer/network absent
			// (e.g. BSC direct with no decoded event payer). Merged as `signedReceipt`
			// alongside any `info.receipt` produced by the old-stack above.
			try {
				const sr = await signReceipt({
					resourceUrl,
					payer: settled.payer || verified.payer || null,
					network: settled.network || verified.requirement?.network || null,
					txHash: settled.transaction,
					includeTxHash: offerReceipt?.includeTxHash === true,
				});
				if (sr) {
					responseExtensions = responseExtensions ?? {};
					const existing = responseExtensions['offer-receipt'];
					responseExtensions['offer-receipt'] = existing
						? { ...existing, signedReceipt: sr }
						: { signedReceipt: sr };
				}
			} catch (err) {
				console.error('x402_receipt_sign_failed', err);
			}
			return responseExtensions;
		}

		// The buyer was charged and the work did not complete. Record the failure
		// against the spent payment (opening its retry window), log it, and answer
		// with the paid-failure fields. `claimed` is false only on a first attempt
		// that failed before its claim was taken (the SIWX grant write), which
		// writes the row here.
		async function failAfterSettle({ status, code, err, record, claimed }) {
			if (!claimed) {
				const claim = await claimSpentPayment({
					paymentHash,
					endpoint: route,
					amountAtomics: verified.requirement?.amount ?? null,
					outcome: 'failed_after_settle',
					settlement: record,
					lastError: err?.message || code,
				});
				// Another request already holds this proof's row; never overwrite
				// its outcome from here.
				if (claim.replay) {
					writeReplayed(res, { route });
					return;
				}
			}
			const state = await markFailedAfterSettle({
				paymentHash: spentKey,
				settlement: record,
				lastError: err?.message || code,
			});
			logPaymentEvent({
				eventType: 'payment_failed_after_settle',
				route,
				resourceUrl,
				payer: record.payer,
				network: record.network,
				amountAtomics: record.amount,
				asset: record.asset,
				txHash: record.transaction,
				settlementStatus: 'success',
				durationMs: Date.now() - requestStartTime,
				ipAddress: clientIp(req),
				userAgent: req.headers?.['user-agent']?.slice(0, 512) || null,
				metadata: { code, error: String(err?.message || '').slice(0, 300), retries_left: state.retriesLeft, retry: paidRetry?.attempt ?? 0 },
			});
			recordPaymentMetric({
				kind: 'x402',
				status: 'failed',
				network: record.network,
				amountUsd: atomicsToUsd(record.amount),
				latencyMs: Date.now() - requestStartTime,
				reason: 'failed_after_settle',
			});
			if (res.headersSent) {
				// A stream that already began cannot carry a JSON error; end it. The
				// row says failed, so the same payment can still be retried.
				if (!res.writableEnded) res.end();
				return;
			}
			writePaidFailure(res, { status, code, err, record, state });
		}

		// Success telemetry for a settled payment — logged once the good has been
		// delivered (after res.end in the buffered path, after the handler streamed
		// in the streaming path).
		//
		// A `status:'pending'` settlement is recorded as PENDING, not success. The
		// good ships either way (the transaction is broadcast and the buyer holds
		// its hash), but the books are not closed until
		// /api/cron/x402-settlement-reconcile confirms the signature, and telemetry
		// that called it settled would overstate revenue by exactly the payments
		// still in flight.
		function recordSettledSuccess(settled) {
			const pending = settled.status === 'pending';
			logPaymentEvent({
				eventType: 'payment_settled',
				route,
				resourceUrl,
				payer: settled.payer || verified.payer || null,
				network: settled.network || verified.requirement?.network || null,
				amountAtomics: verified.requirement?.amount || null,
				asset: verified.requirement?.asset || null,
				txHash: settled.transaction || null,
				settlementStatus: pending ? 'pending' : 'success',
				facilitatorResponse: settled,
				durationMs: Date.now() - requestStartTime,
				ipAddress: clientIp(req),
				userAgent: req.headers?.['user-agent']?.slice(0, 512) || null,
			});
			// Axiom payment metric — success rate + per-network latency the audit DB
			// can't aggregate live. Fire-and-forget no-op until AXIOM_* is set; carries
			// only on-chain identifiers (route, network, tx signature), never PII.
			recordPaymentMetric({
				kind: 'x402',
				status: 'ok',
				network: settled.network || verified.requirement?.network,
				amountUsd: atomicsToUsd(verified.requirement?.amount),
				latencyMs: Date.now() - requestStartTime,
				signature: settled.transaction || undefined,
			});

			// Post-settlement accrual hook (royalties). Fire-and-forget: the
			// payment is final and the good is already delivered by the time any
			// caller observes this, so a ledger hiccup must never surface here.
			if (typeof onSettled === 'function') {
				Promise.resolve()
					.then(() =>
						onSettled({
							payer: settled.payer || verified.payer || null,
							network: settled.network || verified.requirement?.network || null,
							txHash: settled.transaction || null,
							amountAtomics: verified.requirement?.amount || null,
							asset: verified.requirement?.asset || null,
							resourceUrl,
						}),
					)
					.catch((err) => console.error(`paidEndpoint(${route}): onSettled hook failed`, err));
			}
		}

		// STREAMING routes deliver the good by flushing their own body (binary
		// download, res.pipe, SSE). Settle FIRST and emit the payment-response
		// header up-front — headers must precede the streamed body — so the
		// buyer is charged before a single byte of the good ships. A streamed
		// body isn't buffered, so no idempotency cache entry is stored; the
		// reservation is released once the handler finishes.
		if (streaming) {
			const outcome = await settleAndBuildResponse({ claimOutcome: 'running' });
			if (!outcome) return;
			const { settled, paymentResponseHeader, record } = outcome;

			res.setHeader('x-payment-response', paymentResponseHeader);
			res.setHeader('cache-control', 'no-store');

			let result;
			try {
				result = await handler({
					req,
					res,
					requirement: verified.requirement,
					payer: verified.payer,
					settled,
				});
			} catch (err) {
				if (ownsReservation) await releaseSlot({ route, paymentId });
				// The handler finished its body and then threw: the good shipped, so
				// the payment is spent like any delivered one.
				if (res.writableEnded) {
					await markDelivered(spentKey);
					recordSettledSuccess(settled);
					return;
				}
				// The payment already settled on-chain and the good did not ship.
				// Never answer "pay again": record the failure against this proof
				// and tell the buyer the same payment re-runs the work. A 402 thrown
				// by the handler is reported as a 500 here, because a 402 now would
				// prompt the client to pay a second time.
				const status = err?.status && err.status !== 402 ? err.status : 500;
				await failAfterSettle({ status, code: err?.code || 'internal_error', err, record, claimed: true });
				return;
			}

			if (ownsReservation) await releaseSlot({ route, paymentId });
			// A streaming handler that returned a value instead of flushing gets
			// the same buffered emission as the default path (content-type from the
			// route mime), so streaming is a superset — not a different contract.
			if (!res.writableEnded) {
				res.setHeader('content-type', `${mimeType}; charset=utf-8`);
				res.end(typeof result === 'string' ? result : JSON.stringify(result));
			}
			await markDelivered(spentKey);
			recordSettledSuccess(settled);
			return;
		}

		let result;
		try {
			result = await handler({
				req,
				res,
				requirement: verified.requirement,
				payer: verified.payer,
			});
		} catch (err) {
			if (ownsReservation) await releaseSlot({ route, paymentId });
			// A paid retry is past settlement: the buyer paid on the first attempt,
			// so this failure keeps the retry lane open rather than asking for a
			// new payment.
			if (paidRetry) {
				const status = err?.status && err.status !== 402 ? err.status : 500;
				const record = settlementRecord(settledFromRecord(paidRetry.record), verified, paidRetry.record.header, payloadHash);
				await failAfterSettle({ status, code: err?.code || 'internal_error', err, record, claimed: true });
				return;
			}
			if (err instanceof X402Error && err.status === 402) {
				return await send402(res, { ...challenge, error: err.message });
			}
			// Deliver-then-settle: nothing was settled, so the buyer was not
			// charged and the same payment can be sent again.
			return respondError(res, err.status || 500, err.code || 'internal_error', err, { paid: false, retry_safe: true });
		}

		// Deliver-then-settle: the handler MUST return a value and leave the
		// response unflushed so settlement runs below before the body ships. A
		// handler that ended its own response has delivered the good WITHOUT
		// settling — the buyer would get it for free. Fail loudly: release the
		// slot, record the leak, and throw so wrap() alerts. A route that needs
		// to write its own body must set `streaming: true` (settle-then-stream)
		// so payment is captured before delivery.
		if (res.writableEnded) {
			if (ownsReservation) await releaseSlot({ route, paymentId });
			logPaymentEvent({
				eventType: 'payment_unsettled_flush',
				route,
				resourceUrl,
				payer: verified.payer || null,
				network: verified.requirement?.network || null,
				amountAtomics: verified.requirement?.amount || null,
				asset: verified.requirement?.asset || null,
				settlementStatus: 'failed',
				durationMs: Date.now() - requestStartTime,
				ipAddress: clientIp(req),
				userAgent: req.headers?.['user-agent']?.slice(0, 512) || null,
				metadata: { reason: 'handler flushed response before settlement; set streaming:true to settle first' },
			});
			recordPaymentMetric({
				kind: 'x402',
				status: 'failed',
				network: verified.requirement?.network,
				amountUsd: atomicsToUsd(verified.requirement?.amount),
				latencyMs: Date.now() - requestStartTime,
				reason: 'unsettled_flush',
			});
			throw new Error(
				`paidEndpoint(${route}): handler flushed its response before settlement — set streaming:true for routes that write their own body`,
			);
		}

		const outcome = await settleAndBuildResponse();
		if (!outcome) return;
		const { settled, paymentResponseHeader } = outcome;
		if (paidRetry) await markDelivered(spentKey);

		// Roadmap phase 4: per-job metering. The settlement already landed, so
		// the hook can bind the payment facts (payer, amount, tx) to the exact
		// job core and sign the receipt. Runs before the flush so the receipt
		// travels inside the response body it attests to.
		if (typeof metered === 'function') {
			try {
				const metering = await metered({
					req,
					result,
					settled,
					payer: settled.payer || verified.payer || null,
					requirement: verified.requirement,
				});
				if (
					metering &&
					typeof metering === 'object' &&
					result &&
					typeof result === 'object' &&
					!Array.isArray(result)
				) {
					result = { ...result, ...metering };
				}
			} catch (err) {
				// A metering failure must never break a settled response: the buyer
				// paid and the work ran. Log and ship the un-metered result.
				console.error(`paidEndpoint(${route}): metered hook failed`, err);
			}
		}

		const contentType = `${mimeType}; charset=utf-8`;
		const body = typeof result === 'string' ? result : JSON.stringify(result);

		res.setHeader('x-payment-response', paymentResponseHeader);
		res.setHeader('cache-control', 'no-store');
		res.setHeader('content-type', contentType);
		res.end(body);

		recordSettledSuccess(settled);

		if (paymentId) {
			await storeResponse({
				route,
				paymentId,
				payloadHash,
				paymentHash,
				status: 200,
				body,
				contentType,
				paymentResponseHeader,
				ttlSeconds: pidTtlSeconds,
			});
		}
	});
}
