// The vanity client and verifier throw the SDK's typed errors, so a caller can
// tell a bad argument from a failed HTTP call from a receipt that does not verify.

import { afterEach, describe, it, expect, jest } from "@jest/globals";
import { commitToSeed, fetchServiceKey } from "../../src/vanity/verify.js";
import { openSealed, SEALED_ENVELOPE_SCHEME, type SealedEnvelope } from "../../src/vanity/sealed.js";
import { grindVerifiedVanity } from "../../src/vanity/client.js";
import {
  InvalidInputError,
  ReceiptVerificationError,
  RequestFailedError,
  SolanaAgentError,
} from "../../src/errors.js";

function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error("expected the call to throw");
}

async function rejection(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (err) {
    return err;
  }
  throw new Error("expected the promise to reject");
}

const jsonResponse = (status: number, body: unknown) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  }) as unknown as Response;

describe("vanity verifier input errors", () => {
  it("rejects a seed of the wrong length as InvalidInputError", () => {
    const err = thrown(() => commitToSeed(new Uint8Array(16)));
    expect(err).toBeInstanceOf(InvalidInputError);
    expect((err as InvalidInputError).param).toBe("serverSeed");
    expect((err as Error).message).toBe("serverSeed must be 32 bytes");
  });

  it("rejects a seed that is neither hex nor Base58 as InvalidInputError", () => {
    const err = thrown(() => commitToSeed("not base58: 0OIl"));
    expect(err).toBeInstanceOf(InvalidInputError);
    expect((err as InvalidInputError).param).toBe("serverSeed");
  });

  it("rejects a seed of the wrong type as InvalidInputError", () => {
    const err = thrown(() => commitToSeed(42 as unknown as string));
    expect(err).toBeInstanceOf(InvalidInputError);
  });
});

describe("sealed envelope input errors", () => {
  const key = "ab".repeat(32);

  it("rejects an unknown envelope scheme as InvalidInputError", () => {
    const env = { scheme: "rot13", epk: key, iv: "", ct: "" } as unknown as SealedEnvelope;
    const err = thrown(() => openSealed(env, key));
    expect(err).toBeInstanceOf(InvalidInputError);
    expect((err as InvalidInputError).param).toBe("envelope");
  });

  it("rejects a recipient key that is not 32 bytes as InvalidInputError", () => {
    const env = { scheme: SEALED_ENVELOPE_SCHEME, epk: key, iv: "", ct: "" } as unknown as SealedEnvelope;
    const err = thrown(() => openSealed(env, new Uint8Array(31)));
    expect(err).toBeInstanceOf(InvalidInputError);
    expect((err as Error).message).toContain("must be a 32-byte X25519 key (got 31)");
  });

  it("rejects an undecodable recipient key as InvalidInputError", () => {
    const env = { scheme: SEALED_ENVELOPE_SCHEME, epk: key, iv: "", ct: "" } as unknown as SealedEnvelope;
    const err = thrown(() => openSealed(env, "%%%"));
    expect(err).toBeInstanceOf(InvalidInputError);
  });
});

describe("fetchServiceKey", () => {
  const url = "https://three.ws/.well-known/three-vanity.json";
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("reports a non-2xx well-known response as RequestFailedError", async () => {
    globalThis.fetch = jest.fn(async () => jsonResponse(503, "busy")) as unknown as typeof fetch;
    const err = await rejection(fetchServiceKey(url));
    expect(err).toBeInstanceOf(RequestFailedError);
    expect([(err as RequestFailedError).url, (err as RequestFailedError).status]).toEqual([url, 503]);
  });

  it("reports a document without a service key as a SolanaAgentError", async () => {
    globalThis.fetch = jest.fn(async () => jsonResponse(200, { serviceKey: {} })) as unknown as typeof fetch;
    const err = await rejection(fetchServiceKey(url));
    expect(err).toBeInstanceOf(SolanaAgentError);
    expect((err as Error).message).toContain("serviceKey.publicKeyBase58");
  });

  it("returns the pinned key", async () => {
    globalThis.fetch = jest.fn(async () =>
      jsonResponse(200, { serviceKey: { publicKeyBase58: "ServiceKey111" } }),
    ) as unknown as typeof fetch;
    await expect(fetchServiceKey(url)).resolves.toBe("ServiceKey111");
  });
});

describe("grindVerifiedVanity", () => {
  const endpoint = "https://three.ws/api/vanity-verifiable";

  it("reports a failed paid request as RequestFailedError with the response detail", async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(402, "payment required")) as unknown as typeof fetch;
    const err = await rejection(grindVerifiedVanity({ fetchImpl, endpoint, prefix: "A" }));
    expect(err).toBeInstanceOf(RequestFailedError);
    expect((err as RequestFailedError).status).toBe(402);
    expect((err as RequestFailedError).detail).toBe("payment required");
    expect((err as RequestFailedError).url.startsWith(endpoint)).toBe(true);
  });

  it("reports a receipt with no secret as ReceiptVerificationError", async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(200, { address: "x" })) as unknown as typeof fetch;
    const err = await rejection(grindVerifiedVanity({ fetchImpl, endpoint, servicePublicKey: false }));
    expect(err).toBeInstanceOf(ReceiptVerificationError);
    expect((err as ReceiptVerificationError).failures).toEqual([
      "secret: receipt carried neither a sealed envelope nor a plaintext secret",
    ]);
  });

  it("reports a receipt that fails its checks as ReceiptVerificationError listing each failure", async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse(200, { address: "x", secretKeyBase58: "1111", secretKey: Array(64).fill(0) }),
    ) as unknown as typeof fetch;
    const err = await rejection(grindVerifiedVanity({ fetchImpl, endpoint, servicePublicKey: false }));
    expect(err).toBeInstanceOf(ReceiptVerificationError);
    const { failures, message } = err as ReceiptVerificationError;
    expect(failures.length).toBeGreaterThan(0);
    for (const f of failures) expect(f).toMatch(/^[\w-]+: /);
    expect(message).toBe(`Receipt failed verification: ${failures.join("; ")}`);
  });
});
