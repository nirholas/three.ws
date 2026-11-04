// agent-payments-sdk
// Copyright (c) 2026 nirholas | x.com/nichxbt | github.com/nirholas
// All rights reserved.

import { describe, it, expect, afterEach } from "vitest";
import { EvmAgentOffline } from "./EvmAgentOffline";
import {
  EVM_CHAINS,
  ZERO_ADDRESS,
  isAgentPaymentsDeployed,
  type EvmChainId,
} from "./addresses";

const AGENT_TOKEN = "0x0000000000000000000000000000000000007e57";
const DEPLOYED = "0xAAd35977753757071e019F548FcF803196380421";

describe("EvmAgentOffline deployment guard", () => {
  const original = new Map<EvmChainId, string>();

  function setAddress(chainId: EvmChainId, address: string) {
    if (!original.has(chainId)) original.set(chainId, EVM_CHAINS[chainId].agentPayments);
    EVM_CHAINS[chainId].agentPayments = address as typeof ZERO_ADDRESS;
  }

  afterEach(() => {
    for (const [id, address] of original) EVM_CHAINS[id].agentPayments = address as typeof ZERO_ADDRESS;
    original.clear();
  });

  it("throws while the chain's address is the zero placeholder", () => {
    setAddress(8453, ZERO_ADDRESS);
    expect(isAgentPaymentsDeployed(8453)).toBe(false);
    expect(() => new EvmAgentOffline(AGENT_TOKEN, 8453)).toThrow(/not deployed on chain 8453/);
  });

  it("stops throwing for a chain once its address is non-zero, and targets it", () => {
    setAddress(8453, DEPLOYED);
    expect(isAgentPaymentsDeployed(8453)).toBe(true);
    const agent = new EvmAgentOffline(AGENT_TOKEN, 8453);
    expect(agent.contractAddress).toBe(DEPLOYED);
    const tx = agent.buildCreateAgentTx({ agentToken: AGENT_TOKEN, agentAuthority: AGENT_TOKEN, buybackBps: 1000 });
    expect(tx.to).toBe(DEPLOYED);
  });

  it("keeps other chains guarded when one chain is wired", () => {
    setAddress(8453, DEPLOYED);
    setAddress(56, ZERO_ADDRESS);
    expect(() => new EvmAgentOffline(AGENT_TOKEN, 56)).toThrow(/not deployed on chain 56/);
  });
});
