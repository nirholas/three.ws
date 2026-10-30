// Pins the @noble-backed primitives in src/vanity against Node's built-in
// crypto, so a @noble major bump cannot silently change a derived seed, a
// commitment, or the ability to open a sealed envelope.

import { describe, it, expect } from "@jest/globals";
import { createCipheriv, createHash, createHmac, hkdfSync } from "node:crypto";
import bs58 from "bs58";
import { x25519 } from "@noble/curves/ed25519.js";
import { candidateSeed, commitToSeed, deriveMasterSeed } from "../../src/vanity/verify.js";
import {
  generateRecipientKeypair,
  openSealed,
  openSealedJson,
  SEALED_ENVELOPE_SCHEME,
} from "../../src/vanity/sealed.js";

const enc = new TextEncoder();
const hex = (b: Uint8Array | Buffer) => Buffer.from(b).toString("hex");
const b64url = (b: Uint8Array | Buffer) => Buffer.from(b).toString("base64url");

describe("vanity verification primitives match Node crypto", () => {
  const serverSeed = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
  const clientSeed = Uint8Array.from({ length: 16 }, (_, i) => 200 - i);
  const requestNonce = Uint8Array.from({ length: 12 }, (_, i) => i * 7);

  it("commitToSeed is sha256(tag || seed)", () => {
    const expected = createHash("sha256")
      .update(Buffer.concat([Buffer.from("three-vanity/seed-commit/v1"), serverSeed]))
      .digest("hex");
    expect(commitToSeed(serverSeed)).toBe(expected);
  });

  it("deriveMasterSeed is HKDF-SHA256 with the tagged salt and info", () => {
    const salt = createHash("sha256").update("three-vanity/mix-salt/v1").digest();
    const ikm = Buffer.concat([serverSeed, clientSeed, requestNonce]);
    const expected = Buffer.from(
      hkdfSync("sha256", ikm, salt, Buffer.from("three-vanity/master/v1"), 32),
    );
    expect(hex(deriveMasterSeed({ serverSeed, clientSeed, requestNonce }))).toBe(hex(expected));
  });

  it("candidateSeed is HMAC-SHA256 over tag || uint64be(index)", () => {
    const master = deriveMasterSeed({ serverSeed, clientSeed, requestNonce });
    const index = 4242;
    const idx = Buffer.alloc(8);
    idx.writeBigUInt64BE(BigInt(index));
    const expected = createHmac("sha256", master)
      .update(Buffer.concat([Buffer.from("three-vanity/candidate/v1"), idx]))
      .digest();
    expect(hex(candidateSeed(master, index))).toBe(hex(expected));
  });
});

describe("sealed envelopes open with the recipient key", () => {
  // Seals with Node's AES-256-GCM and HKDF (an independent implementation of
  // the x25519-hkdf-sha256-aes256gcm/v1 scheme), then opens with the SDK.
  function seal(plaintext: Uint8Array, recipientPublic: Uint8Array) {
    const esk = x25519.utils.randomSecretKey();
    const epk = x25519.getPublicKey(esk);
    const shared = x25519.getSharedSecret(esk, recipientPublic);
    const salt = Buffer.concat([epk, recipientPublic]);
    const key = Buffer.from(
      hkdfSync("sha256", shared, salt, Buffer.from("three.ws sealed-envelope v1"), 32),
    );
    const nonce = Buffer.from(Uint8Array.from({ length: 12 }, (_, i) => 255 - i));
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(Buffer.from(epk));
    const ct = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
    return {
      scheme: SEALED_ENVELOPE_SCHEME,
      epk: b64url(epk),
      nonce: b64url(nonce),
      ciphertext: b64url(ct),
    };
  }

  it("round-trips JSON through a generated recipient keypair", () => {
    const kp = generateRecipientKeypair();
    const envelope = seal(
      enc.encode(JSON.stringify({ address: "abc", n: 7 })),
      bs58.decode(kp.publicKey),
    );
    expect(openSealedJson(envelope, kp.secretKey)).toEqual({ address: "abc", n: 7 });
  });

  it("rejects an envelope opened with the wrong key", () => {
    const kp = generateRecipientKeypair();
    const other = generateRecipientKeypair();
    const envelope = seal(enc.encode("secret"), bs58.decode(kp.publicKey));
    expect(() => openSealed(envelope, other.secretKey)).toThrow();
  });
});
