/**
 * One-call provably-fair vanity client: request → open the seal → verify.
 *
 * `grindVerifiedVanity` drives the full trustless flow against three.ws's
 * `/api/x402/vanity-verifiable` endpoint:
 *   1. generate a fresh X25519 recipient keypair (so the secret is ECIES-sealed
 *      and never travels in plaintext) and a fresh clientSeed (your entropy in
 *      the mix);
 *   2. pay-per-call with your x402-capable fetch and pull back the signed receipt;
 *   3. open the sealed envelope locally with the X25519 secret;
 *   4. independently verify every protocol claim (including that the key you
 *      just opened IS the ground key) before handing you the secret.
 *
 * If verification fails, it THROWS rather than return an unverified key: the
 * whole point is that you never accept a key you couldn't prove was honest.
 *
 * Bring your own x402 fetch (e.g. `wrapFetchWithPayment` from @x402/fetch, or
 * the SDK's payExact-driven fetch). This module stays payment-rail-agnostic.
 */

import bs58 from "bs58";
import {
  verifyVanityReceipt,
  fetchServiceKey,
  THREE_VANITY_ENDPOINT,
  THREE_VANITY_WELL_KNOWN,
  type VanityReceipt,
  type VerifyResult,
} from "./verify.js";
import { openSealedJson, generateRecipientKeypair, type SealedEnvelope } from "./sealed.js";
import { ReceiptVerificationError, RequestFailedError } from "../errors.js";

export interface SealedBundle {
  format: string;
  secretKeyBase58: string;
  secretKey: number[];
  seed: string;
}

export interface GrindVerifiedResult {
  /** Base58 Solana address. */
  address: string;
  /** 64-byte secret key (Solana / Phantom import format). */
  secretKey: Uint8Array;
  /** Base58 secret key. */
  secretKeyBase58: string;
  /** The full signed receipt. Keep it; anyone can re-verify it later. */
  receipt: VanityReceipt;
  /** The per-check verification audit (all passed, or this would have thrown). */
  verification: VerifyResult;
}

export interface GrindVerifiedOptions {
  prefix?: string;
  suffix?: string;
  ignoreCase?: boolean;
  /** Your own entropy (hex/Base58). A fresh random one is used when omitted. */
  clientSeed?: string;
  /** x402-capable fetch (paywall-aware). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Override the endpoint (e.g. devnet/staging). */
  endpoint?: string;
  /** Override the pinned service key. By default the live key is fetched from
   *  the well-known document and pinned, so verification never depends on a
   *  possibly-stale SDK constant. Pass `false` to skip the fetch and use the
   *  built-in pin, or a string to pin an explicit key. */
  servicePublicKey?: string | false;
  /** Well-known URL to resolve the live service key from (default three.ws). */
  wellKnownUrl?: string;
}

function randomClientSeedHex(): string {
  const b = new Uint8Array(32);
  (globalThis.crypto as Crypto).getRandomValues(b);
  return bs58.encode(b); // Base58; the endpoint accepts hex or Base58.
}

/**
 * Request a provably-fair vanity wallet, open the seal locally, and verify it.
 * Throws if the receipt does not verify against the pinned service key.
 */
export async function grindVerifiedVanity(
  opts: GrindVerifiedOptions = {},
): Promise<GrindVerifiedResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const endpoint = opts.endpoint ?? THREE_VANITY_ENDPOINT;

  // 1. Fresh X25519 recipient + clientSeed: the buyer contributes entropy and
  //    the secret is sealed to a key only the buyer holds.
  const recipient = generateRecipientKeypair();
  const clientSeed = opts.clientSeed ?? randomClientSeedHex();

  const url = new URL(endpoint);
  if (opts.prefix) url.searchParams.set("prefix", opts.prefix);
  if (opts.suffix) url.searchParams.set("suffix", opts.suffix);
  if (opts.ignoreCase) url.searchParams.set("ignoreCase", "1");
  url.searchParams.set("clientSeed", clientSeed);
  url.searchParams.set("sealTo", recipient.publicKey);

  // 2. Pay + fetch the signed receipt.
  const res = await doFetch(url.toString(), { headers: { accept: "application/json" } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new RequestFailedError(url.toString(), res.status, text.slice(0, 300));
  }
  const receipt = (await res.json()) as VanityReceipt & {
    sealedSecret?: SealedEnvelope;
    secretKeyBase58?: string;
    secretKey?: number[];
    seed?: string;
  };

  // 3. Open the sealed envelope locally (or read the plaintext if unsealed).
  let secretKeyBase58: string;
  let secretKey: Uint8Array;
  let openedSeed: Uint8Array | undefined;
  if (receipt.sealed && receipt.sealedSecret) {
    const bundle = openSealedJson<SealedBundle>(receipt.sealedSecret, recipient.secretKey);
    secretKeyBase58 = bundle.secretKeyBase58;
    secretKey = Uint8Array.from(bundle.secretKey);
    openedSeed = secretKey.slice(0, 32);
  } else if (receipt.secretKeyBase58) {
    secretKeyBase58 = receipt.secretKeyBase58;
    secretKey = Uint8Array.from(receipt.secretKey ?? bs58.decode(receipt.secretKeyBase58));
    openedSeed = secretKey.slice(0, 32);
  } else {
    throw new ReceiptVerificationError(["secret: receipt carried neither a sealed envelope nor a plaintext secret"]);
  }

  // 4. Independently verify EVERY claim, including custody of THIS key.
  //    Pin against the LIVE well-known key by default (so a stale SDK constant
  //    never causes a false negative or a false positive); callers can override
  //    with an explicit key or `false` to use the built-in pin.
  let servicePublicKey: string | undefined;
  if (opts.servicePublicKey === false) {
    servicePublicKey = undefined; // fall back to the SDK's built-in pin
  } else if (typeof opts.servicePublicKey === "string") {
    servicePublicKey = opts.servicePublicKey;
  } else {
    servicePublicKey = await fetchServiceKey(opts.wellKnownUrl ?? THREE_VANITY_WELL_KNOWN);
  }

  const verification = verifyVanityReceipt(receipt, {
    servicePublicKey,
    openedSecretSeed: openedSeed,
  });
  if (!verification.valid) {
    const failed = verification.checks.filter((c) => !c.pass).map((c) => `${c.id}: ${c.detail}`);
    throw new ReceiptVerificationError(failed);
  }

  return {
    address: receipt.address,
    secretKey,
    secretKeyBase58,
    receipt,
    verification,
  };
}
