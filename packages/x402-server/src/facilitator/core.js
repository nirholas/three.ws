// createFacilitator: the three.ws Solana x402 "exact" facilitator as a library.
//
// This is the code that settles payments in production at three.ws, with the
// platform couplings (environment, RPC helper, database) replaced by options. It
// validates a buyer-signed SPL TransferChecked, co-signs it with the sponsor
// fee-payer, broadcasts it, and answers success, settlement_pending, or a refusal
// with a machine-readable reason. Guards are individually configurable:
//
//   sponsorSolFloorLamports   refuse to settle when the fee wallet would fall below it
//   feeBudget                 rolling-window cap on sponsor SOL burned per period
//   minSponsoredSettleAtomic  refuse sponsored settles too small to cover their own fee
//   payToAllowlist            the only recipients that may be settled to
//   settleableMints           the only mints that may be settled
//   maxCuLimit / maxCuPriceMicroLamports / maxPriorityLamports   priority-fee ceilings
//
// Everything is read through the options at call time, so an operator can rotate a
// value without rebuilding the facilitator.

import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';
import {
	getAssociatedTokenAddressSync,
	ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

import {
	DEFAULT_POLICY,
	ataRentLamports,
	blockhashIsLive,
	isFeePayerRentFailure,
	txBase64FromPayload,
	validateRingTransaction,
	verifyBuyerSignatures,
} from './validate.js';
import { defaultTokenPrograms } from './tokens.js';
import {
	MemoryDecisionLog,
	MemoryPendingStore,
	SETTLEMENT_PENDING_REASON,
	pendingSettlementKey,
	recordPendingOrTerminal,
} from './store.js';
import { createFeeBudget } from './guards.js';
import { createFailoverConnection } from './connection.js';

const call = (v) => (typeof v === 'function' ? v() : v);

/**
 * @param {import('./index.js').FacilitatorOptions} options
 */
export function createFacilitator(options = {}) {
	const clock = options.clock?.now ? () => options.clock.now() : Date.now;

	const g = options.guards || {};
	const num = (v, d) => {
		const n = Number(call(v));
		return Number.isFinite(n) ? n : d;
	};
	// Getters, not snapshots: a function-valued guard is re-read on every use.
	const guards = {
		get sponsorSolFloorLamports() {
			return Math.max(0, num(g.sponsorSolFloorLamports, 20_000_000));
		},
		get minSponsoredSettleAtomic() {
			return Math.max(0, num(g.minSponsoredSettleAtomic, 1000));
		},
		get confirmTimeoutMs() {
			return g.confirmTimeoutMs ?? 12_000;
		},
	};
	const policy = () => ({
		maxCuLimit: num(g.maxCuLimit, DEFAULT_POLICY.maxCuLimit),
		maxCuPriceMicroLamports: num(g.maxCuPriceMicroLamports, DEFAULT_POLICY.maxCuPriceMicroLamports),
		maxPriorityLamports: num(g.maxPriorityLamports, DEFAULT_POLICY.maxPriorityLamports),
	});

	const feeBudget = g.feeBudget?.lamports
		? createFeeBudget({ lamports: g.feeBudget.lamports, windowMs: g.feeBudget.windowMs, clock })
		: null;

	const tokenPrograms = options.tokenPrograms || defaultTokenPrograms();
	const cfgFeeMeter = options.feeMeter || null;

	// Pending store: undefined gets the in-process default, null means none (the
	// caller supplies one per settle, as the three.ws API does with Postgres).
	const cfgStore = options.store === undefined ? new MemoryPendingStore({ clock }) : options.store;
	const decisionLog =
		options.decisionLog === undefined ? new MemoryDecisionLog({ clock }) : options.decisionLog;

	let _connection = null;
	function getConnection() {
		const c = call(options.connection);
		if (c) return c;
		if (!_connection) {
			if (!options.rpcUrls?.length) {
				throw new Error('facilitator: provide a connection or rpcUrls');
			}
			_connection = createFailoverConnection(options.rpcUrls);
		}
		return _connection;
	}

	function feePayerSigner() {
		return call(options.feePayer) || null;
	}
	function sponsorAddress() {
		const explicit = call(options.sponsorAddress);
		if (explicit) return String(explicit);
		let signer = null;
		try {
			signer = feePayerSigner();
		} catch {
			signer = null;
		}
		return signer?.publicKey ? signer.publicKey.toBase58() : null;
	}
	function loadFeePayer() {
		const signer = feePayerSigner();
		if (!signer) throw new Error('facilitator: no fee payer configured (the sponsor key that co-signs and pays SOL)');
		const advertised = call(options.sponsorAddress);
		if (advertised && signer.publicKey.toBase58() !== String(advertised)) {
			throw new Error(
				`facilitator: fee-payer pubkey ${signer.publicKey.toBase58()} != advertised sponsor ${advertised}`,
			);
		}
		return signer;
	}
	// A signer is either a Keypair (signs in process) or an object exposing
	// signTransaction(tx), so a KMS or hardware-backed key never has to be loaded.
	async function cosign(signer, tx) {
		if (typeof signer.signTransaction === 'function') {
			const signed = await signer.signTransaction(tx);
			return signed || tx;
		}
		tx.sign([signer]);
		return tx;
	}

	function payToAllowlist() {
		return new Set(Array.from(call(options.payToAllowlist) || []).filter(Boolean).map(String));
	}
	function settleableMints() {
		return new Set(Array.from(call(options.settleableMints) || []).filter(Boolean).map(String));
	}
	const validationPolicy = () => ({
		settleableMints: Array.from(settleableMints()),
		policy: policy(),
		tokenPrograms,
	});

	// ── Sponsor SOL guard ────────────────────────────────────────────────────────
	// Cache the sponsor SOL balance briefly so a high-throughput settle stream does
	// not hit getBalance on every payment. The floor check is the hard stop that
	// keeps the loop from ever draining our SOL: below the floor, settle refuses and
	// the paying loop stalls until the sponsor is topped up.
	const _solCache = new Map(); // pubkeyB58 -> { lamports, at }
	const SOL_CACHE_MS = 20_000;

	// Last observed floor state, readable synchronously. buildRequirements (the
	// 402 challenge builder) is sync and hot, so it cannot await a balance read,
	// but it CAN consult what the settle path most recently observed and stop
	// advertising a Solana accept that is guaranteed to die at settle. Validity is
	// deliberately longer than the balance cache: during a dry spell settles keep
	// probing (refreshing this), and 60s of staleness only delays re-advertising
	// by less than the treasury-topup cadence that refunds the wallet.
	const FLOOR_STATE_MS = 60_000;
	let _floorState = { below: false, at: 0 };

	function sponsorKnownBelowFloor(now = clock()) {
		return _floorState.below && now - _floorState.at < FLOOR_STATE_MS;
	}

	function noteFloorState(lamports, now) {
		_floorState = { below: lamports < guards.sponsorSolFloorLamports, at: now };
	}

	/**
	 * Record floor state only for the wallet the 402 challenge actually advertises.
	 *
	 * `_floorState` gates whether buildRequirements keeps offering the SPONSORED
	 * Solana accept, so it is only meaningful for X402_FEE_PAYER_SOLANA. Recording
	 * it from any fee wallet let a healthy self-pay buyer stamp `below:false` and
	 * re-advertise a starved sponsor for the full FLOOR_STATE_MS, which is how a
	 * dry sponsor kept handing out accepts that could not settle (2026-09).
	 */
	function noteFloorStateFor(pubkeyB58, lamports, now) {
		if (pubkeyB58 === sponsorAddress()) noteFloorState(lamports, now);
	}

	/**
	 * Trip the floor guard from a settle failure instead of a balance read.
	 *
	 * The guard was only ever written by getBalance, which is exactly the call that
	 * stops answering when the Solana RPC lanes are over quota, and
	 * refreshSponsorFloorState fails open on that error by design. So the two
	 * failures compounded: on 2026-08-28 all four paid lanes were exhausted at once
	 * while the sponsor sat at 0.000899 SOL against a 0.02 floor, the guard never
	 * learned it, and the ring spent three hours making payments that could not
	 * settle. 95 attempts, 0 settled, every one of them dying on this exact error.
	 *
	 * A rent-exemption failure on our own fee payer is strictly better evidence than
	 * the balance read it replaces: it is free, it is the chain's own verdict, and
	 * it arrives precisely when the RPC is too degraded to answer anything else.
	 *
	 * Only OUR sponsor counts. In a self-pay settle the buyer is the fee payer, and
	 * tripping the platform-wide guard because one buyer is broke would withdraw the
	 * Solana accept from every 402 challenge on the site.
	 * @param {unknown} simErr
	 * @param {string|null|undefined} feePayer the transaction's fee payer
	 * @param {number} [now]
	 * @returns {boolean} true when the guard was tripped
	 */
	function noteSponsorRentFailure(simErr, feePayer, now = clock()) {
		if (!isFeePayerRentFailure(simErr)) return false;
		const sponsor = sponsorAddress();
		if (!sponsor || !feePayer || String(feePayer) !== String(sponsor)) return false;
		_floorState = { below: true, at: now };
		return true;
	}

	// Keep the floor state warm on instances that never settle.
	//
	// The state above is per-process and was only written by the settle path, so a
	// Cloud Run instance serving nothing but 402 challenges never learned the
	// sponsor was dry and kept advertising a Solana accept that could not settle.
	// Callers on the challenge path invoke this WITHOUT awaiting: it refreshes at
	// most once per SOL_CACHE_MS per instance, swallows every error (an RPC blip
	// must never affect a challenge), and leaves the state untouched on failure so
	// the fail-open default stands. First request after a cold start still
	// advertises Solana; every request after it is accurate.
	let _floorRefreshInFlight = null;

	function refreshSponsorFloorState(now = clock()) {
		const pubkey = sponsorAddress();
		if (!pubkey) return;
		if (_floorRefreshInFlight) return;
		const hit = _solCache.get(pubkey);
		if (hit && hit.lamports != null && now - hit.at < SOL_CACHE_MS) return;

		_floorRefreshInFlight = (async () => {
			try {
				const conn = getConnection();
				const lamports = await conn.getBalance(new PublicKey(pubkey), 'confirmed');
				_solCache.set(pubkey, { lamports, at: clock() });
				noteFloorState(lamports, clock());
			} catch {
				/* RPC unreachable: keep the last known state, fail open */
			} finally {
				_floorRefreshInFlight = null;
			}
		})();
	}

	async function sponsorSolLamports(conn, feePayerPubkey, now = clock()) {
		const key = feePayerPubkey.toBase58();
		const hit = _solCache.get(key);
		if (hit && hit.lamports != null && now - hit.at < SOL_CACHE_MS) return hit.lamports;
		const lamports = await conn.getBalance(feePayerPubkey, 'confirmed');
		_solCache.set(key, { lamports, at: now });
		noteFloorStateFor(key, lamports, now);
		return lamports;
	}

	// Debit the cache right after a settle so the next check sees the balance
	// approaching the floor without another RPC round-trip.
	function bumpSolCache(pubkeyB58, deltaLamports) {
		const hit = _solCache.get(pubkeyB58);
		if (hit && hit.lamports != null) {
			hit.lamports = Math.max(0, hit.lamports - deltaLamports);
			noteFloorStateFor(pubkeyB58, hit.lamports, clock());
		}
	}

	// How long a settle blocks waiting for confirmation before it answers
	// `settlement_pending` and lets the reconcile cron finish the job. The old
	// 30-second wait was the only thing between a slow slot and a 502, so it had to
	// be long; now that an unresolved wait is a third outcome rather than a failure,
	// holding the buyer's connection open for half a minute buys nothing. 12s clears
	// the overwhelming majority of Solana confirmations inline and caps the settle
	// leg of a paid request at a latency a client library will sit through.
	// Read per call, not at import: the confirmation window is the one settle
	// tunable an operator reaches for DURING an incident (a degraded RPC wants a
	// shorter wait so more settles go pending and reconcile out of band), and a
	// module-load constant would need a redeploy to move.
	function settleConfirmTimeoutMs() {
		const raw = Number(typeof guards.confirmTimeoutMs === 'function' ? guards.confirmTimeoutMs() : guards.confirmTimeoutMs);
		return Number.isFinite(raw) && raw > 0 ? raw : 12_000;
	}
	// Status poll cadence. Tightened with the timeout above: at 1200ms a transaction
	// that confirms in 500ms still paid up to a full extra second of latency.
	const CONFIRM_POLL_MS = 800;

	// Wait for a signature's fate.
	//
	// Three answers, not two, because "we do not know yet" is a real state and the
	// caller's response to it differs completely from a rejection:
	//   { confirmed: true }                    landed, no error.
	//   { confirmed: false, terminal: true }   landed and FAILED on chain. It ran
	//                                            and reverted, so there is nothing
	//                                            to wait for; report the failure.
	//   { confirmed: false, terminal: false }  the wait ran out, or the RPC could
	//                                            not answer. The transaction may
	//                                            still land. NEVER report failure
	//                                            here: this is `settlement_pending`.
	//
	// A transaction that was dropped without landing looks identical to the third
	// case from inside the wait, and it is the reconcile pass
	// (probeSettlementSignature) that later distinguishes the two, once the
	// blockhash can no longer be valid.
	async function confirmSignature(conn, signature, timeoutMs) {
		const deadline = clock() + (timeoutMs ?? settleConfirmTimeoutMs());
		let lastRpcError = null;
		for (;;) {
			try {
				const { value } = await conn.getSignatureStatuses([signature]);
				const st = value?.[0];
				if (st) {
					if (st.err) {
						// An on-chain error is definitive: this transaction ran and reverted.
						return { confirmed: false, terminal: true, err: JSON.stringify(st.err) };
					}
					if (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized') {
						return { confirmed: true };
					}
				}
				lastRpcError = null;
			} catch (err) {
				// An RPC that cannot answer tells us nothing about the transaction. Keep
				// polling until the deadline, then report UNKNOWN, not failure.
				lastRpcError = String(err?.message || err).slice(0, 160);
			}
			if (clock() > deadline) {
				return {
					confirmed: false,
					terminal: false,
					err: lastRpcError ? `confirm_rpc_unavailable:${lastRpcError}` : 'confirm_timeout',
				};
			}
			await new Promise((r) => setTimeout(r, CONFIRM_POLL_MS));
		}
	}

	// Finish a settle whose transaction is already on the wire: re-await THIS
	// signature instead of verifying, co-signing, and broadcasting a second
	// transaction.
	//
	// Reached from the pending-store hit at the top of settleRingPayment, i.e. a
	// retry of a payload we have already broadcast. Re-sending there is what the
	// pending state exists to prevent: the original may land at any moment, and a
	// second transfer of the same funds is a double charge. (The reconcile cron
	// answers the same question out of band, without a payload in hand, through
	// probeSettlementSignature.)
	async function awaitBroadcastSettlement({
		connection,
		signature,
		network,
		payer,
		decoded,
		pendingStore,
		key,
		meta,
	}) {
		const conf = await confirmSignature(connection, signature);
		if (conf.confirmed) {
			if (pendingStore && key) await pendingStore.delete(key);
			return {
				success: true,
				transaction: signature,
				network,
				payer,
				feeLamports: decoded?.estFeeLamports ?? meta?.feeLamports ?? 0,
				feePayer: decoded?.feePayer ?? meta?.feePayer ?? null,
				selfPay: decoded?.selfPay ?? false,
				reconciled: true,
			};
		}
		if (conf.terminal) {
			if (pendingStore && key) await pendingStore.delete(key);
			return { success: false, reason: `not_confirmed:${conf.err}`, transaction: signature };
		}
		// Still unknown. Re-record (refreshing the row's error detail) and stay pending.
		return recordPendingOrTerminal({
			store: pendingStore,
			key,
			signature,
			network,
			payer,
			meta,
			cause: conf.err,
		});
	}

	// Settle a validated ring payment: co-sign with the sponsor, broadcast over our
	// RPC, confirm. Returns the x402-wire settle shape { success, transaction,
	// network, payer } plus feeLamports for the burn meter and feePayer/selfPay for
	// per-wallet fee attribution. Never throws for a rejected payment, a refusal
	// is a clean { success:false, reason }.
	//
	// `feeMeter` is the optional wallet fee governor hook (wallet-fee-meter.js):
	// called after the hard SOL floor passes, with the wallet that will actually
	// pay this transaction's fee. A { ok:false } verdict refuses the settle before
	// any co-sign/broadcast; a hook error fails OPEN, the floor is the hard
	// protection, the meter is pacing.
	//
	// `pendingStore` is the x402 PendingSettlementStore (pending-settlements.js).
	// With one supplied, a confirmation wait that ends UNKNOWN records the broadcast
	// signature and answers `settlement_pending` instead of a failure the buyer's
	// payment contradicts, and a retry of the same payload reconciles against that
	// signature rather than broadcasting a second transaction. Without one the
	// behaviour is the old binary, which is why the endpoint always passes it.
	async function settleInner({
		paymentPayload,
		requirement,
		conn,
		feePayer,
		feeMeter,
		pendingStore,
		idempotencyKey,
	}) {
		const network = requirement.network;
		const connection = conn || getConnection();

		const txBase64 = txBase64FromPayload(paymentPayload);
		if (!txBase64) return { success: false, reason: 'missing_transaction' };

		// The sponsor pubkey only authorizes SPONSOR-mode payments; a self-pay tx
		// carries its own fee payer and needs no sponsor key at all.
		const signerNow = feePayer || null;
		const sponsorPubkey = signerNow?.publicKey?.toBase58() || sponsorAddress() || null;
		const program = await resolveRingTokenProgram(connection, requirement);
		if (!program.ok) return { success: false, reason: program.reason };
		const validation = validateRingTransaction({
			txBase64,
			requirement,
			feePayerPubkey: sponsorPubkey,
			allowlist: payToAllowlist(),
			tokenProgramId: program.tokenProgramId,
			...validationPolicy(),
		});
		if (!validation.ok) return { success: false, reason: validation.reason };
		const decoded = validation.decoded;
		let { tx } = decoded;
		const { payer, estFeeLamports, selfPay } = decoded;
		const sigCheck = verifyBuyerSignatures(decoded);
		if (!sigCheck.ok) return { success: false, reason: sigCheck.reason };

		// Metadata every pending record and reconcile pass needs, assembled once.
		const pendingKey = pendingSettlementKey(txBase64);
		const pendingMeta = {
			network,
			payer,
			payTo: requirement.payTo,
			mint: requirement.asset,
			amountAtomic: decoded.amountAtomic,
			feeLamports: estFeeLamports,
			feePayer: decoded.feePayer,
			// The caller's settle idempotency key, stored so the reconcile pass claims
			// the settle credit under the SAME key the resource server used. Without it
			// the credit gate reads the reconciled claim as a different payment reusing
			// the signature and refuses it (settle-credit.js classify()).
			idempotencyKey: idempotencyKey || null,
		};

		// A retry of a payload we ALREADY broadcast: re-await that signature. Placed
		// before the balance reads, the fee meter, the co-sign, and the broadcast
	// because none of them should run twice. The first attempt already spent
		// (or committed to spending) this transaction's fee, and a second broadcast
		// of a different transaction for the same authorization is a double charge.
		if (pendingStore && pendingKey) {
			const cachedSignature = await pendingStore.get(pendingKey);
			if (cachedSignature) {
				return awaitBroadcastSettlement({
					connection,
					signature: cachedSignature,
					network,
					payer,
					decoded,
					pendingStore,
					key: pendingKey,
					meta: pendingMeta,
				});
			}
		}

		// Anti fee-burn: a sponsor-mode settle must move at least enough to cover the
		// SOL fee we're about to burn co-signing it. Blocks the dust-transfer grief
		// (1-atomic allowlisted transfers spammed to pump down sponsor SOL). Self-pay
		// settles pay their own fee, so a dust self-pay costs us nothing, exempt them.
		if (!selfPay && decoded.amountAtomic < guards.minSponsoredSettleAtomic) {
			return {
				success: false,
				reason: `amount_below_min_settle:${decoded.amountAtomic}<${guards.minSponsoredSettleAtomic}`,
			};
		}

		// Hard stop: never settle if the fee-paying wallet is below its SOL floor.
		// Self-pay → the payer pays its own fee; sponsor mode → the sponsor pays.
		const feeWallet = new PublicKey(decoded.feePayer);
		const solLamports = await sponsorSolLamports(connection, feeWallet);
		// The floor is a reserve protecting OUR sponsor wallet from being drained by
		// the paying loop. In self-pay the fee wallet is the buyer's own, so holding
		// their balance to our reserve would refuse a perfectly good payment for the
		// crime of not keeping 0.02 SOL spare. They only have to afford the fee they
		// are about to pay, which the affordability check below enforces.
		const floorFor = selfPay ? 0 : guards.sponsorSolFloorLamports;
		if (solLamports < floorFor) {
			return {
				success: false,
				reason: `fee_wallet_below_floor:${solLamports}<${floorFor}`,
				sponsorSolLamports: solLamports,
				feePayer: decoded.feePayer,
				payer,
				selfPay,
			};
		}

		// The floor is a reserve that must SURVIVE this settle, so the wallet has to
		// clear it by the cost of the settle itself, not merely sit above it.
		// estFeeLamports carries the ATA-create rent (~0.00204 SOL) when the recipient
		// has no token account for this mint yet, which is the normal state the first
		// time a resource is paid in a new token. Comparing the bare balance let such
		// a settle pass the gate and then die on chain with InsufficientFundsForRent,
		// a confusing failure at exactly the moment a new payment token goes live.
		if (solLamports - estFeeLamports < floorFor) {
			return {
				success: false,
				// Distinct reason per mode, because the two mean opposite things to the
				// person reading the error. In sponsor mode WE are short and the buyer
				// should retry later; in self-pay the BUYER's own wallet cannot cover
				// the network fee, and telling them we are topping up our wallet would
				// send them away waiting for something that will never help.
				reason: selfPay
					? `buyer_cannot_cover_fee:${solLamports}<${estFeeLamports}`
					: `fee_wallet_cannot_cover_settle:${solLamports}-${estFeeLamports}<${floorFor}`,
				sponsorSolLamports: solLamports,
				estFeeLamports,
				feePayer: decoded.feePayer,
				payer,
				selfPay,
			};
		}

		// Rolling fee budget: bounds the RATE of sponsor SOL burn, where the floor
		// above bounds the balance. Self-pay settles spend the buyer's own SOL.
		if (feeBudget && !selfPay && !feeBudget.allows(estFeeLamports)) {
			return {
				success: false,
				reason: `fee_budget_exhausted:${feeBudget.used()}+${estFeeLamports}>${feeBudget.lamports}`,
				sponsorSolLamports: solLamports,
				feePayer: decoded.feePayer,
				payer,
				selfPay,
			};
		}

		// Wallet fee governor: admit this settle only if the fee-paying wallet still
		// has daily fee budget. Governs every tenant of a shared wallet at the one
		// choke point they all pass through, instead of throttling one pipeline while
		// the others drain the same runway.
		const meterHook = feeMeter || cfgFeeMeter;
		if (meterHook) {
			let meterVerdict = null;
			try {
				meterVerdict = await meterHook({
					feeWalletB58: decoded.feePayer,
					buyerB58: decoded.payer,
					solLamports,
					estFeeLamports,
					selfPay,
				});
			} catch { /* meter fault → fail open; the SOL floor above is the hard stop */ }
			if (meterVerdict && meterVerdict.ok === false) {
				return {
					success: false,
					reason: meterVerdict.reason || 'fee_runway_exhausted',
					sponsorSolLamports: solLamports,
					feePayer: decoded.feePayer,
					// Recorded so the facilitator's reject book names WHO was refused.
					// Without it, 43,848 governor refusals in a day logged payer NULL and
					// the flood could only be traced through the matching verify rows.
					payer,
					selfPay,
				};
			}
		}

		// Sponsor mode co-signs the fee payer (buyer already signed); a self-pay tx is
		// already fully signed and just needs broadcasting.
		if (!selfPay) {
			let sponsor;
			try {
				sponsor = feePayer || loadFeePayer();
			} catch (err) {
				return { success: false, reason: `sponsor_key_unconfigured:${err.message}` };
			}
			try {
				tx = await cosign(sponsor, tx);
			} catch (err) {
				return { success: false, reason: `cosign_failed:${err.message}` };
			}
		}

		let signature;
		// Set only when the preflight-off resend below is attempted and also fails, so
		// the reported reason distinguishes "our read node was stale" from "the payment
		// was genuinely unsendable".
		let preflightRetryNote = '';
		let preflightBlockhashRejected = false;
		try {
			signature = await connection.sendRawTransaction(tx.serialize(), {
				skipPreflight: false,
				maxRetries: 5,
			});
		} catch (err) {
			const m = String(err?.message || err);
			const sig = tx.signatures?.[0] ? bs58.encode(tx.signatures[0]) : null;
			// A resent settle (idempotent replay) hits "already processed", the prior
			// broadcast landed. Recover the signature from the tx and report success.
			if (/already been processed|AlreadyProcessed|already processed/i.test(m)) {
				if (sig) {
					return {
						success: true,
						transaction: sig,
						network,
						payer,
						feeLamports: estFeeLamports,
						feePayer: decoded.feePayer,
						selfPay,
						replayed: true,
					};
				}
			}
			// web3.js drops the structured preflight cause (res.error.data.err), so on
			// some RPCs a duplicate-signature rejection arrives as a bare "Transaction
			// simulation failed" with empty logs, including our own maxRetries resend
			// racing the first landing. Probe the signature: if it already landed with no
			// error, this IS this payment's settlement, not a stranger's. The x402
			// authorization is single-use (payment-identifier-server.js reserves a SHA-256
			// lock on the signed X-PAYMENT before settle, and the on-chain nonce is consumed
			// on first settle), so no other payment can reproduce this exact signature.
			// Failing closed here 502'd payments that had actually settled, the dominant
			// settle_failed wave. Recover success identically to the message-matched
			// idempotent-replay branch above; the buyer is owed the product, not a 502.
			// Only a blockhash rejection proves the transaction never reached a validator.
			// Every other failure leaves its fate UNKNOWN, including an RPC whose reply
			// web3.js could not even parse ("Expected the value to satisfy a union of
			// `type | type`", seen when a fallback endpoint answers in a non-standard
			// shape). That class skipped the probe entirely and reported failure on a
			// payment that may well have settled, so probe on everything except the one
			// provably-never-landed case.
			const provablyNeverLanded = /blockhash not found/i.test(m);
			let alreadyLanded = false;
			if (sig && !provablyNeverLanded) {
				try {
					// searchTransactionHistory so a tx that landed a moment earlier and aged
					// out of the recent-status cache is still found, else the probe returns
					// null and we wrongly fail a settled payment.
					const st = (await connection.getSignatureStatuses([sig], { searchTransactionHistory: true }))
						?.value?.[0];
					alreadyLanded = st != null && st.err == null;
				} catch { /* probe is best-effort; the generic reason below stands */ }
			}
			if (alreadyLanded) {
				return {
					success: true,
					transaction: sig,
					network,
					payer,
					feeLamports: estFeeLamports,
					feePayer: decoded.feePayer,
					selfPay,
					replayed: true,
				};
			}
			// A preflight "blockhash not found" is usually a FALSE rejection, not a dead
			// transaction. The buyer builds and signs the payment against THEIR RPC, so the
			// blockhash it carries is real; we then preflight it on whichever node our
			// rotating pool happens to answer with, and a node lagging even a few slots
			// behind the buyer's has simply never seen that hash. web3.js surfaces that as a
			// hard send failure, so a perfectly valid payment was reported broadcast_failed
			// and the buyer 502'd having already been charged for the handler.
			// Re-sending with preflight OFF hands the decision to the validator instead of
			// our read node: if the hash is live the settle lands, and if it genuinely
			// expired the transaction is dropped without landing and without a fee, so the
			// only cost is the confirm wait below. Resending the identical signed bytes is
			// idempotent (Solana dedupes by signature), so this cannot double-settle.
			if (provablyNeverLanded) {
				preflightBlockhashRejected = true;
				try {
					signature = await connection.sendRawTransaction(tx.serialize(), {
						skipPreflight: true,
						maxRetries: 5,
					});
				} catch (retryErr) {
					preflightRetryNote = ` preflight_retry_failed:${String(retryErr?.message || retryErr).slice(0, 120)}`;
				}
			}
			// Only report a broadcast failure if the preflight-off resend above did not
			// produce a signature; otherwise fall through to the confirm step below.
			if (signature == null) {
				// The dominant broadcast failure reaches production logs with NO cause at all:
				// web3.js renders the preflight rejection as "Transaction simulation failed.
				// Logs: []" and drops the structured cause (res.error.data.err), while its own
				// getLogs() only reads back a LANDED transaction, useless for a tx that never
				// landed. Re-simulate on the failure path to recover that cause. Deliberately
				// replaceRecentBlockhash:false, unlike the assertSettleable pre-check: the point
				// is to see whether the blockhash this send actually carried was unknown to the
				// endpoint that answered, which is how a rotating multi-RPC pool fails when the
				// hash is fetched from one node and the send lands on another.
				let cause = '';
				if (!/Logs: \[[^\]]/.test(m)) {
					try {
						const sim = await connection.simulateTransaction(tx, {
							sigVerify: false,
							replaceRecentBlockhash: false,
							commitment: 'confirmed',
						});
						const simErr = sim?.value?.err ?? null;
						const simLogs = Array.isArray(sim?.value?.logs) ? sim.value.logs : [];
						if (simErr) {
							cause = ` cause:${typeof simErr === 'object' ? JSON.stringify(simErr) : String(simErr)}`;
						} else {
							// The re-simulation came back CLEAN: this transaction is valid, and the
							// node that answered the send rejected it anyway. Left unmarked this was
							// the worst log line in the settle path, a "Logs: []" failure with no
							// cause appended, indistinguishable from "the cause probe found nothing"
							// and from a real program error. It names the actual condition instead:
							// our rotating pool asked one node to preflight a transaction another
							// node's blockhash built, which is the expected failure shape while the
							// paid RPC tier is exhausted and traffic is riding throttled free nodes.
							cause = ' cause:resim_clean_preflight_false_negative';
						}
						if (simLogs.length) cause += ` logs:${simLogs.slice(-3).join(' | ')}`;
					} catch (reSimErr) {
						cause = ` cause_probe_failed:${String(reSimErr?.message || reSimErr).slice(0, 120)}`;
					}
				}
				// web3.js appends the LAST simulation-log lines to the message, so the
				// failure cause sits at the END. A head-only truncation kept only the
				// ComputeBudget preamble and hid the failing instruction from every
				// production log. Keep the head (error class) and the tail (cause).
				const detail = `${m}${cause}${preflightRetryNote}`.replace(/\s+/g, ' ').trim();
				const full = `broadcast_failed:${detail}`;
				const reason = full.length <= 480 ? full : `${full.slice(0, 200)} … ${full.slice(-276)}`;
				return { success: false, reason };
			}
		}

		// The broadcast committed the sponsor to this fee whether or not the wait
		// below resolves, so the budget is charged here.
		if (feeBudget && !selfPay) feeBudget.record(estFeeLamports);

		const conf = await confirmSignature(connection, signature);
		if (!conf.confirmed) {
			// Landed and reverted, or provably dropped: a real failure.
			if (conf.terminal) {
				if (pendingStore && pendingKey) await pendingStore.delete(pendingKey);
				return { success: false, reason: `not_confirmed:${conf.err}`, transaction: signature };
			}
			// A send our node rejected as "blockhash not found" and that still has not
			// landed is pending only if that blockhash can still be included. A dead
			// or made-up hash never lands, and answering pending would deliver the paid
			// good for a payment that can never settle, as often as the buyer likes.
			if (preflightBlockhashRejected) {
				const live = await blockhashIsLive(connection, tx.message.recentBlockhash, { recheckMs: 0 });
				if (live === false) {
					if (pendingStore && pendingKey) await pendingStore.delete(pendingKey);
					return { success: false, reason: 'blockhash_expired', transaction: signature };
				}
			}
			// Outcome unknown. The transaction is broadcast and may land at any moment,
			// so reporting failure here would tell a buyer who is about to be charged
			// that they were not. Record the signature and answer `settlement_pending`;
			// the caller's retry reconciles against it and the reconcile cron closes the
			// books either way. The fee cache is deliberately NOT bumped: whether the
			// fee was burned is exactly what we do not know yet, and the reconcile pass
			// meters it once the chain answers.
			return recordPendingOrTerminal({
				store: pendingStore,
				key: pendingKey,
				signature,
				network,
				payer,
				meta: pendingMeta,
				cause: conf.err,
			});
		}

		if (pendingStore && pendingKey) await pendingStore.delete(pendingKey);
		bumpSolCache(feeWallet.toBase58(), estFeeLamports);

		// Best-effort: read the real network fee for accurate burn accounting.
		let feeLamports = estFeeLamports;
		try {
			const parsed = await connection.getParsedTransaction(signature, {
				maxSupportedTransactionVersion: 1,
				commitment: 'confirmed',
			});
			if (parsed?.meta?.fee != null) {
				feeLamports =
					parsed.meta.fee + (decoded.ataCreatePresent ? ataRentLamports(decoded.tokenProgram) : 0);
			}
		} catch { /* estimate stands */ }

		return {
			success: true,
			transaction: signature,
			network,
			payer,
			feeLamports,
			feePayer: decoded.feePayer,
			selfPay,
		};
	}

	// Prove a shape-valid payment can ACTUALLY settle before /verify returns valid.
	//
	// validateRingTransaction() is a static decode: it proves the tx is SHAPED right
	// (amount ≥ required, correct mint/recipient/authority, bounded fee) but not that
	// broadcasting it would succeed. Without this check a buyer can sign a perfectly-
	// formed TransferChecked from a source ATA holding ZERO USDC, static validation
	// passes, the paid flow (verify → run handler → settle) executes the expensive
	// handler and pays the upstream provider, then settle reverts `insufficient funds`
	// and the buyer gets a 502 having paid nothing. The platform ate the provider cost.
	// This closes that deliver-before-settle drain: the handler never runs unless the
	// payment can settle. Third-party facilitators simulate on /verify for the
	// same reason; a self-hosted one must not be weaker.
	//
	// Primary check is a full simulation (sigVerify:false so the sponsor's co-signature
	// isn't required yet; replaceRecentBlockhash:true so an aged blockhash isn't the
	// failure), it catches a zero/low source balance, a frozen ATA, and an unfundable
	// fee payer in one RPC. If simulation itself is unavailable (RPC blip) we fall back
	// to a direct source-ATA balance read so the zero-balance vector stays closed, and
	// fail CLOSED only when neither can run, an unverifiable payment must never reach
	// the handler.
	async function assertSettleable({ tx, connection, requirement, decoded }) {
		try {
			const sim = await connection.simulateTransaction(tx, {
				sigVerify: false,
				replaceRecentBlockhash: true,
				commitment: 'confirmed',
			});
			const simErr = sim?.value?.err ?? null;
			if (simErr) {
				const s = typeof simErr === 'object' ? JSON.stringify(simErr) : String(simErr);
				// A dry sponsor is a platform condition, not this payment's fault: record
				// it so the 402 challenge stops advertising a Solana accept that cannot
				// settle, rather than rejecting one payment and inviting the next.
				const sponsorDry = noteSponsorRentFailure(simErr, decoded?.feePayer);
				// Give the fee-payer verdict its own reason CLASS, because every consumer
				// of this string groups on the token before the first ':'. /api/healthz
				// exposes only that prefix, and isRailFault() in ops/x402-settle-health.js
				// matches /simulation/, so folding this into `simulation_failed` filed
				// the platform's own unfundable sponsor under the same bucket as a buyer
				// signing from an empty ATA, AND counted it as a rail fault. Measured in
				// production on 2026-09-09: `simulation_failed` sat at the top of the
				// verify book with 1,438 rejects in 24h and every single row was
				// {"InsufficientFundsForRent":{"account_index":0}} on our sponsor, a
				// wallet 0.00083 SOL under its floor. Read as a rail fault it points an
				// operator at the RPC lanes, which is the one thing this class is never
				// about. Account index 0 is the fee payer by definition, so the split is
				// exact, not a heuristic: `sponsor_fee_unfunded` is ours to fund,
				// `payer_fee_unfunded` is the buyer's own wallet and needs nothing.
				if (isFeePayerRentFailure(simErr)) {
					const cls = sponsorDry ? 'sponsor_fee_unfunded' : 'payer_fee_unfunded';
					const who = decoded?.feePayer ? String(decoded.feePayer) : 'unknown';
					return { ok: false, reason: `${cls}:${who}`.slice(0, 160) };
				}
				return { ok: false, reason: `simulation_failed:${s}`.slice(0, 160) };
			}
			return { ok: true };
		} catch (simUnavailable) {
			// Simulation RPC unreachable, do not fail open. Read the source ATA balance
			// directly; this alone still stops a transfer signed from a zero-balance ATA.
			try {
				const mint = new PublicKey(decoded.mint);
				const authority = new PublicKey(decoded.payer);
				const sourceAta = getAssociatedTokenAddressSync(
					mint, authority, false, new PublicKey(decoded.tokenProgram), ASSOCIATED_TOKEN_PROGRAM_ID,
				);
				const bal = await connection.getTokenAccountBalance(sourceAta, 'confirmed');
				const have = BigInt(bal?.value?.amount ?? '0');
				const need = BigInt(requirement.amount);
				if (have < need) {
					return { ok: false, reason: `insufficient_source_balance:${have}<${need}` };
				}
				return { ok: true };
			} catch (balUnavailable) {
				return {
					ok: false,
					reason: `settle_precheck_unavailable:${String(
						balUnavailable?.message || simUnavailable?.message || balUnavailable,
					).slice(0, 100)}`,
				};
			}
		}
	}

	// Resolve the token program for the requirement's mint before static validation.
	// The two mints the platform settles are seeded, so this is a map read on the hot
	// path. A deployment that points THREE_TOKEN_MINT or X402_ASSET_MINT_SOLANA at a
	// different mint costs one cached account read. Mints outside that set are left
	// unresolved on purpose: the requirement is caller-supplied, and validation
	// refuses them as `mint_not_settleable` without spending an RPC call on junk.
	async function resolveRingTokenProgram(connection, requirement) {
		const mint = String(requirement?.asset || '');
		const known = tokenPrograms.known(mint);
		if (known) return { ok: true, tokenProgramId: known };
		const settleable = Array.from(settleableMints());
		if (!settleable.includes(mint)) return { ok: true, tokenProgramId: null };
		try {
			return { ok: true, tokenProgramId: await tokenPrograms.resolve(connection, mint) };
		} catch (err) {
			return {
				ok: false,
				reason: `token_program_unresolved:${String(err?.code || err?.message || err).slice(0, 100)}`,
			};
		}
	}

	// Verify shape for /verify, validate statically, then prove settleability on-chain
	// WITHOUT broadcasting. Async: the settleability proof is one RPC round-trip.
	async function verifyInner({ paymentPayload, requirement, feePayerPubkey, conn }) {
		const txBase64 = txBase64FromPayload(paymentPayload);
		if (!txBase64) return { isValid: false, invalidReason: 'missing_transaction' };
		const connection =
			conn || getConnection();
		const program = await resolveRingTokenProgram(connection, requirement);
		if (!program.ok) return { isValid: false, invalidReason: program.reason };
		const validation = validateRingTransaction({
			txBase64,
			requirement,
			feePayerPubkey: feePayerPubkey || sponsorAddress() || null,
			allowlist: payToAllowlist(),
			tokenProgramId: program.tokenProgramId,
			...validationPolicy(),
		});
		if (!validation.ok) return { isValid: false, invalidReason: validation.reason };

		const sigCheck = verifyBuyerSignatures(validation.decoded);
		if (!sigCheck.ok) return { isValid: false, invalidReason: sigCheck.reason };
		// The settleability simulation swaps in a fresh blockhash, so it cannot see a
		// dead one. Refuse it here, before the paid handler runs.
		if ((await blockhashIsLive(connection, validation.decoded.tx.message.recentBlockhash)) === false) {
			return { isValid: false, invalidReason: 'blockhash_expired' };
		}

		const settleable = await assertSettleable({
			tx: validation.decoded.tx,
			connection,
			requirement,
			decoded: validation.decoded,
		});
		if (!settleable.ok) return { isValid: false, invalidReason: settleable.reason };

		return {
			isValid: true,
			network: requirement.network,
			asset: validation.decoded.mint,
			payer: validation.decoded.payer,
		};
	}
	// A transaction can only be included while its blockhash is live (150 slots,
	// ~60-90s). Past that a signature the ledger has never seen can never appear, so
	// "not found" stops meaning "not yet" and starts meaning "dropped". Held well
	// clear of the real limit so a lagging history index is never mistaken for a
	// dropped payment.
	const SETTLEMENT_DROP_HORIZON_MS = 180_000;

	// The reconcile pass's read: what does the chain say about a signature we
	// broadcast and never confirmed?
	//
	// Strictly read-only: it never signs, re-sends, or touches a wallet. Returns
	// the state the pending row should take:
	//   'confirmed': landed, no error. feeLamports carries the real fee when the
	//                 parsed transaction is available, so the burn meter records
	//                 what was actually spent rather than the estimate.
	//   'failed':    landed with an on-chain error.
	//   'abandoned': no trace, and too old for its blockhash to still be valid.
	//   'pending':   no trace yet, still inside the horizon, or the RPC could not
	//                 answer. Ask again next pass.
	async function probeSettlementSignature({ conn, signature, broadcastAtMs }) {
		const connection = conn || getConnection();
		let status;
		try {
			status = (
				await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })
			)?.value?.[0];
		} catch (err) {
			return { state: 'pending', error: `probe_rpc_failed:${String(err?.message || err).slice(0, 160)}` };
		}

		if (status && status.err) {
			return { state: 'failed', error: JSON.stringify(status.err).slice(0, 400) };
		}
		if (status && !status.err) {
			let feeLamports = null;
			try {
				const parsed = await connection.getParsedTransaction(signature, {
					maxSupportedTransactionVersion: 1,
					commitment: 'confirmed',
				});
				if (parsed?.meta?.fee != null) feeLamports = parsed.meta.fee;
			} catch { /* the stored estimate stands */ }
			return { state: 'confirmed', feeLamports };
		}

		const ageMs = broadcastAtMs ? clock() - broadcastAtMs : 0;
		if (ageMs > SETTLEMENT_DROP_HORIZON_MS) {
			return { state: 'abandoned', error: `not_found_after_${Math.round(ageMs / 1000)}s` };
		}
		return { state: 'pending', error: 'not_found_yet' };
	}
	function emit(action, input, result) {
		const requirement = input.requirement || {};
		const ok = action === 'verify' ? Boolean(result.isValid) : Boolean(result.success);
		const entry = {
			action,
			ok,
			reason: ok ? null : (result.invalidReason || result.reason || null),
			pending: Boolean(result.pending),
			network: requirement.network || null,
			payTo: requirement.payTo || null,
			mint: requirement.asset || null,
			amountAtomic: Number(requirement.amount) || null,
			payer: result.payer || null,
			txSig: result.transaction || null,
			feeLamports: result.feeLamports ?? null,
			feePayer: result.feePayer || null,
		};
		try {
			decisionLog?.log(entry);
			options.onDecision?.(entry);
		} catch { /* a log sink fault must never change a settle outcome */ }
	}

	async function verifyRingPayment(input) {
		const result = await verifyInner(input);
		emit('verify', input, result);
		return result;
	}

	async function settleRingPayment(input) {
		const result = await settleInner({
			...input,
			pendingStore: input.pendingStore !== undefined ? input.pendingStore : cfgStore,
		});
		emit('settle', input, result);
		return result;
	}

	return {
		SETTLEMENT_PENDING_REASON,
		guards,
		feeBudget,
		decisionLog,
		tokenPrograms,
		getConnection,
		loadFeePayer,
		sponsorAddress,
		payToAllowlist,
		settleableMints,
		verifyRingPayment,
		settleRingPayment,
		probeSettlementSignature,
		sponsorKnownBelowFloor,
		noteSponsorRentFailure,
		refreshSponsorFloorState,
		sponsorSolLamports,
		isFeePayerRentFailure,
		blockhashIsLive,
		txBase64FromPayload,
		verifyBuyerSignatures,
		validateRingTransaction(args) {
			return validateRingTransaction({
				allowlist: payToAllowlist(),
				feePayerPubkey: sponsorAddress(),
				...validationPolicy(),
				...args,
			});
		},
		/** The settle drop horizon the reconcile pass uses, in ms. */
		settlementDropHorizonMs: SETTLEMENT_DROP_HORIZON_MS,
	};
}
