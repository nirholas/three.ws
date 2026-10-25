import { describe, it, expect, vi } from "vitest";
import {
  buildPumpAgentRequirements,
  createResourceServer,
} from "./facilitator";
import { encodePaymentPayload } from "./headers";
import type {
  FacilitatorClient,
  PaymentPayload,
  PumpAgentPaymentRequirements,
} from "./types";

const AGENT_MINT = "11111111111111111111111111111112";
const PAY_TO = "11111111111111111111111111111113";
const SECRET = "test-invoice-secret-not-for-production";

function stubFacilitator() {
  const verify = vi.fn(async () => ({ isValid: true }));
  const settle = vi.fn(async () => ({
    success: true,
    transaction: "sig",
    network: "solana",
    payer: "payer",
  }));
  return {
    verify,
    settle,
    client: { verify, settle, getSupported: async () => ({ kinds: [] }) } as unknown as FacilitatorClient,
  };
}

function gateFor(invoiceSecret: string | undefined, facilitator: FacilitatorClient) {
  return createResourceServer({
    facilitator,
    invoiceSecret,
    requirements: [
      buildPumpAgentRequirements({
        agentMint: AGENT_MINT,
        payTo: PAY_TO,
        amount: "1000000",
        invoiceSecret,
      }),
    ],
    resource: { url: "/api/x", description: "x" },
  });
}

async function mintedInvoice(gate: ReturnType<typeof gateFor>) {
  const res = await gate(new Request("https://x.test/api/x"), () => new Response("ok"));
  const body = (await res.json()) as { accepts: PumpAgentPaymentRequirements[] };
  return body.accepts[0];
}

function pay(accepted: PumpAgentPaymentRequirements) {
  const payload: PaymentPayload = {
    x402Version: 2,
    scheme: "pump-agent",
    network: accepted.network,
    accepted,
    payload: {},
  };
  return new Request("https://x.test/api/x", {
    headers: { "X-PAYMENT": encodePaymentPayload(payload) },
  });
}

describe("resource server invoice binding", () => {
  it("accepts an invoice this server minted", async () => {
    const f = stubFacilitator();
    const gate = gateFor(SECRET, f.client);
    const res = await gate(pay(await mintedInvoice(gate)), () => new Response("ok"));
    expect(res.status).toBe(200);
    expect(f.verify).toHaveBeenCalledOnce();
  });

  it("rejects a memo the server never issued before touching the chain", async () => {
    const f = stubFacilitator();
    const gate = gateFor(SECRET, f.client);
    const minted = await mintedInvoice(gate);
    const forged = { ...minted, extra: { ...minted.extra, memo: "1700000000000000001" } };
    const res = await gate(pay(forged), () => new Response("ok"));
    expect(res.status).toBe(400);
    expect(f.verify).not.toHaveBeenCalled();
  });

  it("rejects a minted memo moved onto a different invoice window", async () => {
    const f = stubFacilitator();
    const gate = gateFor(SECRET, f.client);
    const minted = await mintedInvoice(gate);
    const shifted = {
      ...minted,
      extra: { ...minted.extra, startTime: minted.extra.startTime - 10, endTime: minted.extra.endTime - 10 },
    };
    const res = await gate(pay(shifted), () => new Response("ok"));
    expect(res.status).toBe(400);
    expect(f.verify).not.toHaveBeenCalled();
  });

  it("rejects an invoice whose window has already closed", async () => {
    const f = stubFacilitator();
    const gate = gateFor(SECRET, f.client);
    vi.useFakeTimers();
    try {
      const minted = await mintedInvoice(gate);
      vi.setSystemTime(Date.now() + 3_600_000);
      const res = await gate(pay(minted), () => new Response("ok"));
      expect(res.status).toBe(400);
      expect(f.verify).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
